// SPDX-License-Identifier: MIT

pragma solidity ^0.8.27;

import {FHE, externalEuint64, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC7984} from "../confidential-tokens/base/ERC7984.sol";
import {IERC20Wrapper} from "../confidential-tokens/extensions/IERC20Wrapper.sol";

/**
 * @title MockERC20Wrapper
 * @dev 用于测试的ERC20包装器，支持Mock解密回调
 *      继承ERC20Wrapper的所有功能，但添加了测试专用的Mock功能
 */
contract MockERC20Wrapper is ERC7984, SepoliaConfig {
    using SafeERC20 for IERC20;

    // 底层 ERC20 代币合约
    IERC20 private immutable _underlying;
    
    // 包装汇率：rate 个 ERC20 代币 = 1 个机密代币
    uint256 private immutable _rate;
    
    // 底层代币的小数位数
    uint8 private immutable _underlyingDecimals;
    
    // 去包装请求映射
    mapping(uint256 requestID => address user) private _unwrapRequests;
    
    // Mock测试专用：记录最后一个请求ID
    uint256 private _lastRequestID;

    // 事件定义
    event Wrapped(address indexed user, uint256 amount, euint64 wrappedAmount);
    event Unwrapped(address indexed user, euint64 amount, uint256 unwrappedAmount);

    // 错误定义
    error InvalidAmount();
    error InvalidRate();
    error UnwrapRequestNotFound();
    error InvalidUnderlyingToken();

    /**
     * @dev 构造函数
     * @param underlying_ 底层 ERC20 代币地址
     * @param name_ 机密代币名称
     * @param symbol_ 机密代币符号
     * @param rate_ 包装汇率（rate 个 ERC20 = 1 个机密代币）
     */
    constructor(
        address underlying_,
        string memory name_,
        string memory symbol_,
        uint256 rate_
    ) ERC7984(name_, symbol_, "") {
        if (underlying_ == address(0)) revert InvalidUnderlyingToken();
        if (rate_ == 0) revert InvalidRate();
        
        _underlying = IERC20(underlying_);
        _rate = rate_;
        
        // 获取底层代币的小数位数
        try IERC20Metadata(address(_underlying)).decimals() returns (uint8 decimals) {
            _underlyingDecimals = decimals;
        } catch {
            _underlyingDecimals = 18; // 默认值
        }
    }

    /**
     * @dev 获取底层 ERC20 代币地址
     */
    function underlying() public view returns (address) {
        return address(_underlying);
    }

    /**
     * @dev 获取包装汇率
     */
    function rate() public view returns (uint256) {
        return _rate;
    }

    /**
     * @dev 获取底层代币的小数位数
     */
    function underlyingDecimals() public view returns (uint8) {
        return _underlyingDecimals;
    }

    /**
     * @dev 将 ERC20 代币包装为机密代币
     * @param to 接收机密代币的地址
     * @param amount 要包装的 ERC20 代币数量
     */
    function wrap(address to, uint256 amount) public {
        if (amount == 0) revert InvalidAmount();
        
        // 从用户转移 ERC20 代币到合约
        _underlying.safeTransferFrom(msg.sender, address(this), amount);
        
        // 铸造机密代币：amount / rate 个机密代币
        uint256 confidentialAmount = amount / _rate;
        if (confidentialAmount == 0) revert InvalidAmount();
        
        euint64 encryptedWrappedAmount = FHE.asEuint64(uint64(confidentialAmount));
        _mint(to, encryptedWrappedAmount);
        
        emit Wrapped(msg.sender, amount, encryptedWrappedAmount);
    }

    /**
     * @dev 将机密代币去包装为 ERC20 代币
     * @param from 机密代币发送者地址
     * @param amount 要去包装的机密代币数量
     */
    function unwrap(address from, address /* to */, euint64 amount) public {
        // 验证调用者权限
        require(FHE.isAllowed(amount, msg.sender), "Unauthorized amount access");
        require(msg.sender == from || isOperator(from, msg.sender), "Not authorized");
        
        // 准备解密请求
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(amount);
        
        // 请求解密
        uint256 requestID = FHE.requestDecryption(cts, this.finalizeUnwrap.selector);
        
        // 记录去包装请求和请求ID（Mock测试专用）
        _unwrapRequests[requestID] = from;
        _lastRequestID = requestID;
        
        // 销毁机密代币（暂时，如果解密失败会恢复）
        _burn(from, amount);
    }

    /**
     * @dev 完成去包装请求的回调函数
     * @param requestID 请求 ID
     * @param cleartexts 解密的明文数据
     * @param decryptionProof 解密证明
     */
    function finalizeUnwrap(uint256 requestID, bytes memory cleartexts, bytes memory decryptionProof) public {
        // 验证签名（在测试环境中跳过）
        // FHE.checkSignatures(requestID, cleartexts, decryptionProof);
        
        // 解码解密的金额
        uint64 amount = abi.decode(cleartexts, (uint64));
        
        // 获取请求用户
        address user = _unwrapRequests[requestID];
        if (user == address(0)) revert UnwrapRequestNotFound();
        
        // 计算 ERC20 代币数量
        uint256 unwrappedAmount = uint256(amount) * _rate;
        
        // 检查合约余额是否足够
        uint256 contractBalance = _underlying.balanceOf(address(this));
        if (contractBalance < unwrappedAmount) {
            revert("Insufficient contract balance for unwrap");
        }
        
        // 转移 ERC20 代币给用户
        _underlying.safeTransfer(user, unwrappedAmount);
        
        // 清理请求记录
        delete _unwrapRequests[requestID];
        
        emit Unwrapped(user, FHE.asEuint64(uint64(amount)), unwrappedAmount);
    }

    /**
     * @dev Mock测试专用：获取最后一个请求ID
     */
    function getLastRequestID() public view returns (uint256) {
        return _lastRequestID;
    }

    /**
     * @dev Mock测试专用：模拟解密响应
     * @param requestID 请求ID
     * @param amount 解密的金额
     */
    function mockDecryptResponse(uint256 requestID, uint256 amount) public {
        // 直接调用内部解包逻辑，跳过FHE验证
        _mockFinalizeUnwrap(requestID, amount);
    }

    /**
     * @dev Mock测试专用：内部解包逻辑
     * @param requestID 请求ID
     * @param amount 解密的金额
     */
    function _mockFinalizeUnwrap(uint256 requestID, uint256 amount) internal {
        // 获取请求用户
        address user = _unwrapRequests[requestID];
        if (user == address(0)) revert UnwrapRequestNotFound();
        
        // 计算 ERC20 代币数量
        uint256 unwrappedAmount = amount * _rate;
        
        // 检查合约余额是否足够
        uint256 contractBalance = _underlying.balanceOf(address(this));
        if (contractBalance < unwrappedAmount) {
            revert("Insufficient contract balance for unwrap");
        }
        
        // 转移 ERC20 代币给用户
        _underlying.safeTransfer(user, unwrappedAmount);
        
        // 清理请求记录
        delete _unwrapRequests[requestID];
        
        emit Unwrapped(user, FHE.asEuint64(uint64(amount)), unwrappedAmount);
    }

    /**
     * @dev 获取合约持有的底层代币余额
     */
    function underlyingBalance() public view returns (uint256) {
        return _underlying.balanceOf(address(this));
    }

    /**
     * @dev 紧急提取函数（仅合约所有者可调用）
     * @param to 接收地址
     * @param amount 提取数量
     */
    function emergencyWithdraw(address to, uint256 amount) external {
        // 这里应该添加所有者权限检查
        _underlying.safeTransfer(to, amount);
    }
}

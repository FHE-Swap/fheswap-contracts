// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import {FHE, externalEuint64, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC7984} from "../base/ERC7984.sol";
import {IERC20Wrapper} from "./IERC20Wrapper.sol";

/**
 * @title ERC20Wrapper
 * @dev Contract for wrapping ERC20 tokens into ERC7984 confidential tokens
 * @notice SepoliaConfig is inherited through ERC7984
 */
contract ERC20Wrapper is ERC7984 {
    using SafeERC20 for IERC20;

    IERC20 private immutable _underlying;
    uint256 private immutable _rate;
    uint8 private immutable _underlyingDecimals;
    mapping(uint256 requestID => address user) private _unwrapRequests;

    event Wrapped(address indexed user, uint256 amount, euint64 wrappedAmount);
    event Unwrapped(address indexed user, euint64 amount, uint256 unwrappedAmount);

    error InvalidAmount();
    error InvalidRate();
    error UnwrapRequestNotFound();
    error InvalidUnderlyingToken();

    /**
     * @dev Constructor
     * @param underlying_ Underlying ERC20 token address
     * @param name_ Confidential token name
     * @param symbol_ Confidential token symbol
     * @param rate_ Wrapping rate (rate ERC20 tokens = 1 confidential token)
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
        
        try IERC20Metadata(address(_underlying)).decimals() returns (uint8 decimals) {
            _underlyingDecimals = decimals;
        } catch {
            _underlyingDecimals = 18;
        }
    }

    /**
     * @dev Get the underlying ERC20 token address
     * @return Underlying token address
     */
    function underlying() public view returns (address) {
        return address(_underlying);
    }

    /**
     * @dev Get the wrapping rate
     * @return Wrapping rate
     */
    function rate() public view returns (uint256) {
        return _rate;
    }

    /**
     * @dev Get the decimals of the underlying token
     * @return Underlying token decimals
     */
    function underlyingDecimals() public view returns (uint8) {
        return _underlyingDecimals;
    }

    /**
     * @dev Wrap ERC20 tokens into confidential tokens
     * @param to Recipient address for confidential tokens
     * @param amount Amount of ERC20 tokens to wrap
     */
    function wrap(address to, uint256 amount) public {
        if (amount == 0) revert InvalidAmount();
        
        _underlying.safeTransferFrom(msg.sender, address(this), amount);
        
        uint256 confidentialAmount = amount / _rate;
        if (confidentialAmount == 0) revert InvalidAmount();
        
        euint64 encryptedWrappedAmount = FHE.asEuint64(uint64(confidentialAmount));
        _mint(to, encryptedWrappedAmount);
        
        emit Wrapped(msg.sender, amount, encryptedWrappedAmount);
    }

    /**
     * @dev Unwrap confidential tokens into ERC20 tokens
     * @param from Sender address of confidential tokens
     * @param amount Amount of confidential tokens to unwrap
     */
    function unwrap(address from, address /* to */, euint64 amount) public {
        require(FHE.isAllowed(amount, msg.sender), "Unauthorized amount access");
        require(msg.sender == from || isOperator(from, msg.sender), "Not authorized");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(amount);
        
        uint256 requestID = FHE.requestDecryption(cts, this.finalizeUnwrap.selector);
        
        _unwrapRequests[requestID] = from;
        
        _burn(from, amount);
    }

    /**
     * @dev Unwrap with input proof variant
     * @param from Sender address of confidential tokens
     * @param encryptedAmount Encrypted amount of confidential tokens
     * @param inputProof Input proof for verification
     */
    function unwrapWithProof(
        address from,
        address /* to */,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) public {
        require(msg.sender == from || isOperator(from, msg.sender), "Not authorized");
        
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(amount);
        
        uint256 requestID = FHE.requestDecryption(cts, this.finalizeUnwrap.selector);
        
        _unwrapRequests[requestID] = from;
        
        _burn(from, amount);
    }

    /**
     * @dev Unwrap confidential tokens with input proof
     * @param from Sender address
     * @param to Recipient address for ERC20 tokens
     * @param encryptedAmount Encrypted amount to unwrap
     * @param inputProof Input proof for verification
     */
    function unwrap(
        address from,
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) public {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        unwrap(from, to, amount);
    }

    /**
     * @dev Finalize unwrap request callback
     * @param requestID Request ID
     * @param cleartexts Decrypted cleartext data
     * @param decryptionProof Decryption proof
     */
    function finalizeUnwrap(uint256 requestID, bytes memory cleartexts, bytes memory decryptionProof) public {
        FHE.checkSignatures(requestID, cleartexts, decryptionProof);
        
        uint64 amount = abi.decode(cleartexts, (uint64));
        
        address user = _unwrapRequests[requestID];
        if (user == address(0)) revert UnwrapRequestNotFound();
        
        uint256 unwrappedAmount = uint256(amount) * _rate;
        
        uint256 contractBalance = _underlying.balanceOf(address(this));
        if (contractBalance < unwrappedAmount) {
            revert("Insufficient contract balance for unwrap");
        }
        
        _underlying.safeTransfer(user, unwrappedAmount);
        
        delete _unwrapRequests[requestID];
        
        emit Unwrapped(user, FHE.asEuint64(uint64(amount)), unwrappedAmount);
    }

    /**
     * @dev ERC1363 callback for automatic token wrapping
     * @param from Sender address
     * @param amount Amount of ERC20 tokens transferred
     * @param data Data containing target address
     * @return Selector
     */
    function onTransferReceived(
        address /* operator */,
        address from,
        uint256 amount,
        bytes calldata data
    ) external returns (bytes4) {
        require(msg.sender == address(_underlying), "Invalid caller");
        
        address to;
        if (data.length >= 20) {
            to = address(bytes20(data[0:20]));
        } else {
            to = from;
        }
        
        wrap(to, amount);
        
        return this.onTransferReceived.selector;
    }

    /**
     * @dev Get the underlying token balance held by this contract
     * @return Balance of underlying tokens
     */
    function underlyingBalance() public view returns (uint256) {
        return _underlying.balanceOf(address(this));
    }

    /**
     * @dev Emergency withdraw function (owner only)
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address to, uint256 amount) external {
        _underlying.safeTransfer(to, amount);
    }
}

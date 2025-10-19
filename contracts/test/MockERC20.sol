// SPDX-License-Identifier: MIT

pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev 用于测试的模拟ERC20代币合约
 *      支持自定义小数位数和铸造功能
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    /**
     * @dev 构造函数
     * @param name_ 代币名称
     * @param symbol_ 代币符号
     * @param decimals_ 小数位数
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    /**
     * @dev 返回代币的小数位数
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev 铸造代币（仅用于测试）
     * @param to 接收者地址
     * @param amount 铸造数量
     */
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    /**
     * @dev 销毁代币（仅用于测试）
     * @param from 销毁者地址
     * @param amount 销毁数量
     */
    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }
}

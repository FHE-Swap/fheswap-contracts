// SPDX-License-Identifier: MIT

pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev Mock ERC20 token contract for testing
 *      Supports custom decimals and minting functionality
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    // Statistical tracking variables (for testing and monitoring)
    uint256 public totalMinted;        // Total amount minted
    uint256 public totalBurned;        // Total amount burned
    uint256 public mintCount;          // Number of mint operations
    uint256 public burnCount;          // Number of burn operations

    /**
     * @dev Constructor
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param decimals_ Decimal places
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    /**
     * @dev Returns the number of decimals for the token
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Mint tokens (for testing only)
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
        totalMinted += amount;
        mintCount++;
    }

    /**
     * @dev Burn tokens (for testing only)
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) public {
        _burn(from, amount);
        totalBurned += amount;
        burnCount++;
    }

    // ============ Utility Functions (For Testing) ============

    /**
     * @dev Batch mint to multiple addresses
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to mint
     */
    function batchMint(address[] calldata recipients, uint256[] calldata amounts) external {
        require(recipients.length == amounts.length, "Length mismatch");

        for (uint256 i = 0; i < recipients.length; i++) {
            mint(recipients[i], amounts[i]);
        }
    }

    /**
     * @dev Airdrop equal amounts to multiple addresses
     * @param recipients Array of recipient addresses
     * @param amount Amount to give each recipient
     */
    function airdrop(address[] calldata recipients, uint256 amount) external {
        for (uint256 i = 0; i < recipients.length; i++) {
            mint(recipients[i], amount);
        }
    }

    /**
     * @dev Faucet function for testing - mint fixed amount to caller
     * @param amount Amount to mint to caller
     */
    function faucet(uint256 amount) external {
        mint(msg.sender, amount);
    }

    /**
     * @dev Get token statistics
     * @return minted Total amount minted
     * @return burned Total amount burned
     * @return mints Number of mint operations
     * @return burns Number of burn operations
     */
    function getStats() external view returns (
        uint256 minted,
        uint256 burned,
        uint256 mints,
        uint256 burns
    ) {
        return (totalMinted, totalBurned, mintCount, burnCount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../core/FHEPairLib.sol";

/**
 * @title TestSqrt
 * @dev 
 */
contract TestSqrt {
    /**
     * @dev
     * @param y 
     * @return 
     */
    function testSqrt(uint256 y) external pure returns (uint256) {
        return FHEPairLib.sqrt(y);
    }
}

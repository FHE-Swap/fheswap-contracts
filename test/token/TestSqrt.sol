// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../core/libraries/PairMath.sol";

/**
 * @title TestSqrt
 * @dev Test contract for sqrt function from PairMath library
 */
contract TestSqrt {
    /**
     * @dev Test the sqrt function
     * @param y Input value
     * @return Square root of y
     */
    function testSqrt(uint256 y) external pure returns (uint256) {
        return PairMath.sqrt(y);
    }
}

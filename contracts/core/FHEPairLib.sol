// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, externalEuint64, ebool, euint16, euint32, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";

/**
 * @title FHEPairLib
 * @dev FHE pair library contract providing complex mathematical and cryptographic operation helper functions
 *      Including random number generation, obfuscated reserve calculation, liquidity calculation and swap calculation
 */
library FHEPairLib {
    /**
     * @dev Square root function (Babylonian method - Newton iteration)
     *      Equivalent to Uniswap V2 sqrt implementation
     * @param y Input value
     * @return z Square root result
     */
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
        // else z = 0 (default value)
    }

    /**
     * @dev Compute random number with optional minimum value
     * @param max Maximum value (0 means full range)
     * @param minAdd Minimum value to ensure (0 means no minimum)
     * @return randomNumber Encrypted random number
     *
     * Note: If minAdd > 0, ensures randomNumber >= minAdd
     *       If randomNumber < minAdd, adds minAdd; otherwise keeps original value
     */
    function computeRNG(uint16 max, uint16 minAdd) internal returns (euint16) {
        euint16 randomNumber = (max == 0) ? FHE.randEuint16() : FHE.randEuint16(max);
        if (minAdd != 0) {
            ebool tooSmall = FHE.lt(randomNumber, minAdd);
            euint16 addend = FHE.select(tooSmall, FHE.asEuint16(minAdd), FHE.asEuint16(0));
            randomNumber = FHE.add(randomNumber, addend);
        }
        return randomNumber;
    }

    /**
     * @dev Compute obfuscated reserves for privacy-preserving price queries
     * @param reserve0 Token 0 reserve (encrypted)
     * @param reserve1 Token 1 reserve (encrypted)
     * @param scalingFactor Scaling factor for obfuscation
     * @return _obfuscatedReserve0 Obfuscated reserve 0 (encrypted)
     * @return _obfuscatedReserve1 Obfuscated reserve 1 (encrypted)
     *
     * Note: Adds random noise (±7% variance) to reserves for privacy
     *       Lower bound calculation may underflow if scaledPercentage > scalingFactor,
     *       but FHE operations handle this gracefully
     */
    function computeObfuscatedReserves(
        euint64 reserve0,
        euint64 reserve1,
        uint64 scalingFactor
    ) external returns (euint128, euint128) {
        euint16 percentage = computeRNG(256, 70);
        euint16 scaledPercentage = FHE.mul(percentage, 100);
        euint32 upperBound = FHE.add(FHE.asEuint32(scaledPercentage), uint32(scalingFactor));
        euint32 lowerBound = FHE.sub(uint32(scalingFactor), FHE.asEuint32(scaledPercentage));

        ebool randomBool0 = FHE.randEbool();
        ebool randomBool1 = FHE.randEbool();

        euint32 reserve0Multiplier = FHE.select(randomBool0, upperBound, lowerBound);
        euint32 reserve1Multiplier = FHE.select(randomBool1, lowerBound, upperBound);

        euint16 rngMultiplier = computeRNG(0, 3);

        euint64 reserve0Factor = FHE.mul(FHE.asEuint64(reserve0Multiplier), rngMultiplier);
        euint64 reserve1Factor = FHE.mul(FHE.asEuint64(reserve1Multiplier), rngMultiplier);

        euint128 _obfuscatedReserve0 = FHE.mul(FHE.asEuint128(reserve0), reserve0Factor);
        euint128 _obfuscatedReserve1 = FHE.mul(FHE.asEuint128(reserve1), reserve1Factor);

        return (_obfuscatedReserve0, _obfuscatedReserve1);
    }

    /**
     * @dev Compute add liquidity operation variables
     * @param reserve0 Token 0 reserve (encrypted)
     * @param reserve1 Token 1 reserve (encrypted)
     * @param currentLPSupply Current LP token supply (encrypted)
     * @return divLowerPart0 Division lower part for token 0 (encrypted)
     * @return divLowerPart1 Division lower part for token 1 (encrypted)
     * @return partialUpperPart0 Partial upper part for token 0 (encrypted)
     * @return partialUpperPart1 Partial upper part for token 1 (encrypted)
     *
     * Note: Uses random multipliers to obfuscate division operations
     */
    function computeAddLiquidity(
        euint64 reserve0,
        euint64 reserve1,
        euint128 currentLPSupply
    ) external returns (euint128, euint128, euint128, euint128) {
        euint16 rng0 = computeRNG(0, 3);
        euint16 rng1 = computeRNG(0, 3);

        euint128 divLowerPart0 = FHE.mul(FHE.asEuint128(reserve0), FHE.asEuint128(rng0));
        euint128 divLowerPart1 = FHE.mul(FHE.asEuint128(reserve1), FHE.asEuint128(rng1));

        euint128 partialUpperPart0 = FHE.mul(currentLPSupply, FHE.asEuint128(rng0));
        euint128 partialUpperPart1 = FHE.mul(currentLPSupply, FHE.asEuint128(rng1));

        return (divLowerPart0, divLowerPart1, partialUpperPart0, partialUpperPart1);
    }

    /**
     * @dev Compute add liquidity callback - calculates actual amounts and LP tokens to mint
     * @param sentAmount0 Sent amount of token 0 (encrypted)
     * @param sentAmount1 Sent amount of token 1 (encrypted)
     * @param partialUpperPart0 Partial upper part for token 0 (encrypted)
     * @param partialUpperPart1 Partial upper part for token 1 (encrypted)
     * @param divLowerPart0 Division lower part for token 0 (decrypted)
     * @param divLowerPart1 Division lower part for token 1 (decrypted)
     * @param priceToken0 Price of token 0 (for ratio calculation)
     * @param priceToken1 Price of token 1 (for ratio calculation)
     * @param scalingFactor Scaling factor for price calculation
     * @return refundAmount0 Refund amount for token 0 (encrypted)
     * @return refundAmount1 Refund amount for token 1 (encrypted)
     * @return mintAmount LP tokens to mint (encrypted)
     * @return amount0 Actual amount of token 0 used (encrypted)
     * @return amount1 Actual amount of token 1 used (encrypted)
     *
     * Note: Adjusts amounts to match pool ratio, refunds excess
     *       Division by zero is prevented by ensuring divLowerPart > 0 in calling contract
     */
    function computeAddLiquidityCallback(
        euint64 sentAmount0,
        euint64 sentAmount1,
        euint128 partialUpperPart0,
        euint128 partialUpperPart1,
        uint128 divLowerPart0,
        uint128 divLowerPart1,
        uint128 priceToken0,
        uint128 priceToken1,
        uint64 scalingFactor
    ) external returns (euint64, euint64, euint64, euint64, euint64) {
        euint64 targetAmount0 = FHE.mul(FHE.div(sentAmount1, uint64(priceToken0)), scalingFactor);
        euint64 targetAmount1 = FHE.mul(FHE.div(sentAmount0, uint64(priceToken1)), scalingFactor);

        ebool isGoodTarget0 = FHE.ge(targetAmount0, sentAmount0);
        ebool isGoodTarget1 = FHE.ge(targetAmount1, sentAmount1);

        euint64 amount0 = FHE.select(isGoodTarget0, sentAmount0, targetAmount0);
        euint64 amount1 = FHE.select(isGoodTarget1, sentAmount1, targetAmount1);

        euint128 divUpperPart0 = FHE.mul(FHE.asEuint128(amount0), partialUpperPart0);
        euint128 divUpperPart1 = FHE.mul(FHE.asEuint128(amount1), partialUpperPart1);

        euint64 computedLPAmount0 = FHE.asEuint64(FHE.div(divUpperPart0, divLowerPart0));
        euint64 computedLPAmount1 = FHE.asEuint64(FHE.div(divUpperPart1, divLowerPart1));

        euint64 mintAmount = FHE.min(computedLPAmount0, computedLPAmount1);

        euint64 refundAmount0 = FHE.sub(sentAmount0, amount0);
        euint64 refundAmount1 = FHE.sub(sentAmount1, amount1);

        return (refundAmount0, refundAmount1, mintAmount, amount0, amount1);
    }

    /**
     * @dev Compute remove liquidity operation variables
     * @param reserve0 Token 0 reserve (encrypted)
     * @param reserve1 Token 1 reserve (encrypted)
     * @param sentLP LP tokens to burn (encrypted)
     * @param currentLPSupply128 Current LP token supply (encrypted)
     * @return divUpperPart0 Division upper part for token 0 (encrypted)
     * @return divUpperPart1 Division upper part for token 1 (encrypted)
     * @return divLowerPart0 Division lower part for token 0 (encrypted)
     * @return divLowerPart1 Division lower part for token 1 (encrypted)
     *
     * Note: Uses random multipliers to obfuscate division operations
     *       Division by zero is prevented by ensuring currentLPSupply128 > 0 in calling contract
     */
    function computeRemoveLiquidity(
        euint64 reserve0,
        euint64 reserve1,
        euint64 sentLP,
        euint128 currentLPSupply128
    ) external returns (euint128, euint128, euint128, euint128) {
        euint128 sentLP128 = FHE.asEuint128(sentLP);

        euint16 rng0 = computeRNG(0, 3);
        euint16 rng1 = computeRNG(0, 3);

        euint128 divUpperPart0 = FHE.mul(FHE.mul(sentLP128, FHE.asEuint128(reserve0)), FHE.asEuint128(rng0));
        euint128 divUpperPart1 = FHE.mul(FHE.mul(sentLP128, FHE.asEuint128(reserve1)), FHE.asEuint128(rng1));

        euint128 divLowerPart0 = FHE.mul(currentLPSupply128, FHE.asEuint128(rng0));
        euint128 divLowerPart1 = FHE.mul(currentLPSupply128, FHE.asEuint128(rng1));

        return (divUpperPart0, divUpperPart1, divLowerPart0, divLowerPart1);
    }

    /**
     * @dev Internal swap computation using constant product formula with 0.3% fee
     * @param sent0 Amount of token 0 sent (encrypted)
     * @param sent1 Amount of token 1 sent (encrypted)
     * @param reserve0 Token 0 reserve (encrypted)
     * @param reserve1 Token 1 reserve (encrypted)
     * @return divUpperPart0 Division upper part for token 0 output (encrypted)
     * @return divUpperPart1 Division upper part for token 1 output (encrypted)
     * @return divLowerPart0 Division lower part for token 0 output (encrypted)
     * @return divLowerPart1 Division lower part for token 1 output (encrypted)
     *
     * Formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
     * Note: Uses random multipliers to obfuscate division operations
     *       Division by zero is prevented by ensuring reserves > 0 in calling contract
     */
    function _computeSwapInternal(
        euint64 sent0,
        euint64 sent1,
        euint64 reserve0,
        euint64 reserve1
    ) internal returns (euint128, euint128, euint128, euint128) {
        euint16 rng0 = computeRNG(16384, 3);
        euint16 rng1 = computeRNG(16384, 3);

        euint64 amountInWithFee1 = FHE.mul(sent1, uint64(997));
        euint128 numerator0 = FHE.mul(FHE.asEuint128(amountInWithFee1), FHE.asEuint128(reserve0));
        euint64 reserveInScaled1 = FHE.mul(reserve1, uint64(1000));
        euint64 denominatorBase0 = FHE.add(reserveInScaled1, amountInWithFee1);
        euint128 divUpperPart0 = FHE.mul(numerator0, FHE.asEuint128(rng0));
        euint128 divLowerPart0 = FHE.mul(FHE.asEuint128(denominatorBase0), FHE.asEuint128(rng0));

        euint64 amountInWithFee0 = FHE.mul(sent0, uint64(997));
        euint128 numerator1 = FHE.mul(FHE.asEuint128(amountInWithFee0), FHE.asEuint128(reserve1));
        euint64 reserveInScaled0 = FHE.mul(reserve0, uint64(1000));
        euint64 denominatorBase1 = FHE.add(reserveInScaled0, amountInWithFee0);
        euint128 divUpperPart1 = FHE.mul(numerator1, FHE.asEuint128(rng1));
        euint128 divLowerPart1 = FHE.mul(FHE.asEuint128(denominatorBase1), FHE.asEuint128(rng1));

        return (divUpperPart0, divUpperPart1, divLowerPart0, divLowerPart1);
    }

    /**
     * @dev Compute swap operation variables (external wrapper, called by FHEPair)
     */
    function computeSwap(
        euint64 sent0,
        euint64 sent1,
        euint64 reserve0,
        euint64 reserve1
    ) external returns (euint128, euint128, euint128, euint128) {
        return _computeSwapInternal(sent0, sent1, reserve0, reserve1);
    }

    /**
     * @dev Calculate expected output parts (for slippage protection)
     *      This function is called by Router, uses current reserves to calculate expected output numerator and denominator
     *      Equivalent to Uniswap V2 Router getAmountOut logic
     * @param amountIn Input amount (ciphertext)
     * @param isToken0In Whether token0 is input
     * @param reserve0 Token 0 reserve amount
     * @param reserve1 Token 1 reserve amount
     * @return expectedDivUpperPart Expected output numerator (encrypted)
     * @return expectedDivLowerPart Expected output denominator (encrypted)
     */
    function calculateExpectedOutParts(
        euint64 amountIn,
        bool isToken0In,
        euint64 reserve0,
        euint64 reserve1
    ) external returns (euint128 expectedDivUpperPart, euint128 expectedDivLowerPart) {
        // Construct single-sided input
        euint64 sent0 = isToken0In ? amountIn : FHE.asEuint64(0);
        euint64 sent1 = isToken0In ? FHE.asEuint64(0) : amountIn;

        // Use current reserves to calculate (without input, equivalent to slippage protection logic)
        (euint128 divUpperPart0, euint128 divUpperPart1,
         euint128 divLowerPart0, euint128 divLowerPart1) =
            _computeSwapInternal(sent0, sent1, reserve0, reserve1);

        // Return corresponding output parts based on direction
        if (isToken0In) {
            // token0 → token1, return amount1Out calculation parts
            return (divUpperPart1, divLowerPart1);
        } else {
            // token1 → token0, return amount0Out calculation parts
            return (divUpperPart0, divLowerPart0);
        }
    }
}

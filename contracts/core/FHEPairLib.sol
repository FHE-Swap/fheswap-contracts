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
     * @dev Compute random number generator
     * @param max Maximum random number value, 0 means unbounded
     * @param minAdd Minimum increment value, 0 means no minimum requirement
     * @return Generated encrypted random number
     */
    // Logic
    // Generate random number in 0-max range, if randomNumber<minAdd, then randomNumber=current random number+minAdd, otherwise use random number directly
    function computeRNG(uint16 max /* 0 => unbounded */, uint16 minAdd /* 0 => none */) public returns (euint16) {
        // Generate bounded or unbounded random number based on max parameter
        euint16 randomNumber = (max == 0) ? FHE.randEuint16() : FHE.randEuint16(max);
        if (minAdd != 0) {
            // Check if random number is less than minimum value
            ebool tooSmall = FHE.lt(randomNumber, minAdd);
            // If too small, add minimum value, otherwise add 0
            euint16 addend = FHE.select(tooSmall, FHE.asEuint16(minAdd), FHE.asEuint16(0));
            randomNumber = FHE.add(randomNumber, addend);
        }
        return randomNumber;
    }

    /**
     * @dev Compute obfuscated reserves
     *      Obfuscate real reserves through random numbers for public price discovery
     * @param reserve0 Token 0 real reserve amount
     * @param reserve1 Token 1 real reserve amount
     * @param scalingFactor Scaling factor
     * @return Obfuscated reserve 0 and reserve 1
     */
    function computeObfuscatedReserves(
        euint64 reserve0,
        euint64 reserve1,
        uint64 scalingFactor
    ) external returns (euint128, euint128) {
        // Generate random percentage between 0-256, minimum value 70
        euint16 percentage = computeRNG(256, 70);

        // Never overflows, because max rng limit is 326, max euint16 is 65535
        euint16 scaledPercentage = FHE.mul(percentage, 100); // Scale percentage by 100x
        // Create a range [0-100] type interval
        // +
        euint32 upperBound = FHE.add(FHE.asEuint32(scaledPercentage), uint32(scalingFactor)); // Upper bound
        // -
        euint32 lowerBound = FHE.sub(uint32(scalingFactor), FHE.asEuint32(scaledPercentage)); // Lower bound

        // Generate random boolean values for selecting multipliers
        ebool randomBool0 = FHE.randEbool();//Randomly generate boolean value 0
        ebool randomBool1 = FHE.randEbool();//Randomly generate boolean value 1

        // Select different multipliers for two reserves (one upper bound, one lower bound), the two selections must be different
        euint32 reserve0Multiplier = FHE.select(randomBool0, upperBound, lowerBound);
        euint32 reserve1Multiplier = FHE.select(randomBool1, lowerBound, upperBound);

        // Generate additional random multiplier
        euint16 rngMultiplier = computeRNG(0, 3);

        // Need euint64, because max upperBound * max rngmultiplier > max euint32
        euint64 reserve0Factor = FHE.mul(FHE.asEuint64(reserve0Multiplier), rngMultiplier);
        euint64 reserve1Factor = FHE.mul(FHE.asEuint64(reserve1Multiplier), rngMultiplier);

        // Calculate obfuscated reserves
        euint128 _obfuscatedReserve0 = FHE.mul(FHE.asEuint128(reserve0), reserve0Factor);
        euint128 _obfuscatedReserve1 = FHE.mul(FHE.asEuint128(reserve1), reserve1Factor);

        return (_obfuscatedReserve0, _obfuscatedReserve1);
    }

    /**
     * @dev Compute add liquidity variables
     *      Prepare numerator and denominator parts for subsequent division operations
     * @param reserve0 Token 0 reserve amount
     * @param reserve1 Token 1 reserve amount
     * @param currentLPSupply Current LP total supply
     * @return Division denominator 0, division denominator 1, partial numerator 0, partial numerator 1
     */
    function computeAddLiquidity(
        euint64 reserve0,
        euint64 reserve1,
        euint128 currentLPSupply
    ) external returns (euint128, euint128, euint128, euint128) {
        euint16 rng0 = computeRNG(0, 3); // 184_000 HCU - Generate random number 0
        euint16 rng1 = computeRNG(0, 3); // 184_000 HCU - Generate random number 1

        // Calculate division denominator parts (reserve amount multiplied by random number)
        euint128 divLowerPart0 = FHE.mul(FHE.asEuint128(reserve0), FHE.asEuint128(rng0)); // 646_000 HCU
        euint128 divLowerPart1 = FHE.mul(FHE.asEuint128(reserve1), FHE.asEuint128(rng1)); // 646_000 HCU

        // Calculate partial numerator (LP supply multiplied by random number)
        euint128 partialUpperPart0 = FHE.mul(currentLPSupply, FHE.asEuint128(rng0)); // 646_000 HCU
        euint128 partialUpperPart1 = FHE.mul(currentLPSupply, FHE.asEuint128(rng1)); // 646_000 HCU

        return (divLowerPart0, divLowerPart1, partialUpperPart0, partialUpperPart1);
    }

    /**
     * @dev Compute add liquidity callback final result
     *      Calculate actual LP mint amount and refund after decryption completion
     * @param sentAmount0 Sent token 0 amount
     * @param sentAmount1 Sent token 1 amount
     * @param partialUpperPart0 Partial numerator 0
     * @param partialUpperPart1 Partial numerator 1
     * @param divLowerPart0 Division denominator 0 (decrypted)
     * @param divLowerPart1 Division denominator 1 (decrypted)
     * @param priceToken0 Token 0 price
     * @param priceToken1 Token 1 price
     * @param scalingFactor Scaling factor
     * @return Refund token 0, refund token 1, mint LP amount, actual token 0 amount, actual token 1 amount
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
        // Calculate target token amount based on price
        // If user sent sentAmount1 token 1, according to current price, how many token 0 should correspond?
        // P0=r1/r0 r0=r1/P0
        euint64 targetAmount0 = FHE.mul(FHE.div(sentAmount1, uint64(priceToken0)), scalingFactor); // 997_000 HCU
        euint64 targetAmount1 = FHE.mul(FHE.div(sentAmount0, uint64(priceToken1)), scalingFactor); // 997_000 HCU

        // Check if target amount is reasonable
        //Purpose: Prevent user input token amount from not meeting current exchange minimum ratio
        // If targetAmount0 >= sentAmount0, then isGoodTarget0 is true, otherwise false
        ebool isGoodTarget0 = FHE.ge(targetAmount0, sentAmount0);
        ebool isGoodTarget1 = FHE.ge(targetAmount1, sentAmount1);

        // Select actual token amount to use
        euint64 amount0 = FHE.select(isGoodTarget0, sentAmount0, targetAmount0);
        euint64 amount1 = FHE.select(isGoodTarget1, sentAmount1, targetAmount1);

        // Calculate complete division numerator
        euint128 divUpperPart0 = FHE.mul(FHE.asEuint128(amount0), partialUpperPart0); // 646_000 HCU
        euint128 divUpperPart1 = FHE.mul(FHE.asEuint128(amount1), partialUpperPart1); // 646_000 HCU

        // Calculate LP amount (using division invariance)
        euint64 computedLPAmount0 = FHE.asEuint64(FHE.div(divUpperPart0, divLowerPart0)); // 651_000 HCU
        euint64 computedLPAmount1 = FHE.asEuint64(FHE.div(divUpperPart1, divLowerPart1)); // 651_000 HCU

        // Take the smaller LP amount as actual mint amount
        euint64 mintAmount = FHE.min(computedLPAmount0, computedLPAmount1);

        // Calculate refund amount
        // User input amount - actual token amount used
        euint64 refundAmount0 = FHE.sub(sentAmount0, amount0);
        euint64 refundAmount1 = FHE.sub(sentAmount1, amount1);

        return (refundAmount0, refundAmount1, mintAmount, amount0, amount1);
    }

    /**
     * @dev Compute remove liquidity variables
     *      Prepare numerator and denominator parts for subsequent division operations
     * @param reserve0 Token 0 reserve amount
     * @param reserve1 Token 1 reserve amount
     * @param sentLP LP amount to remove
     * @param currentLPSupply128 Current LP total supply
     * @return Division numerator 0, division numerator 1, division denominator 0, division denominator 1
     */
    function computeRemoveLiquidity(
        euint64 reserve0,
        euint64 reserve1,
        euint64 sentLP,
        euint128 currentLPSupply128
    ) external returns (euint128, euint128, euint128, euint128) {
        euint128 sentLP128 = FHE.asEuint128(sentLP); // Convert to 128-bit

        euint16 rng0 = computeRNG(0, 3); // 184_000 HCU - Generate random number 0
        euint16 rng1 = computeRNG(0, 3); // 184_000 HCU - Generate random number 1

        // Calculate division numerator: LP amount * reserve amount * random number
        euint128 divUpperPart0 = FHE.mul(FHE.mul(sentLP128, FHE.asEuint128(reserve0)), FHE.asEuint128(rng0));
        euint128 divUpperPart1 = FHE.mul(FHE.mul(sentLP128, FHE.asEuint128(reserve1)), FHE.asEuint128(rng1));

        // Calculate division denominator: LP total supply * random number
        euint128 divLowerPart0 = FHE.mul(currentLPSupply128, FHE.asEuint128(rng0));
        euint128 divLowerPart1 = FHE.mul(currentLPSupply128, FHE.asEuint128(rng1));

        return (divUpperPart0, divUpperPart1, divLowerPart0, divLowerPart1);
    }

    /**
     * @dev Compute swap operation variables (internal implementation)
     *      Implement AMM swap logic with 0.3% fee
     *
     * Formula: amountOut = (amountIn × 997 × reserveOut) / (reserveIn × 1000 + amountIn × 997)
     *
     * ⚠️ Assumes single-sided input (sent0 == 0 || sent1 == 0):
     *    - If sent0 == 0: calculate amount0Out (user sends Token1, gets Token0)
     *    - If sent1 == 0: calculate amount1Out (user sends Token0, gets Token1)
     *    When one side is 0, corresponding output is also 0, conforming to single-sided swap semantics.
     *    Frontend and Router should ensure user only inputs one type of token.
     *
     * @param sent0 Sent token 0 amount
     * @param sent1 Sent token 1 amount
     * @param reserve0 Token 0 reserve amount (before trade)
     * @param reserve1 Token 1 reserve amount (before trade)
     * @return divUpperPart0 Division numerator 0 (encrypted)
     * @return divUpperPart1 Division numerator 1 (encrypted)
     * @return divLowerPart0 Division denominator 0 (encrypted, needs decryption)
     * @return divLowerPart1 Division denominator 1 (encrypted, needs decryption)
     */
    function _computeSwapInternal(
        euint64 sent0,
        euint64 sent1,
        euint64 reserve0,
        euint64 reserve1
    ) internal returns (euint128, euint128, euint128, euint128) {

        euint16 rng0 = computeRNG(16384, 3); // Generate random number 0 (max 16384)
        euint16 rng1 = computeRNG(16384, 3); // Generate random number 1 (max 16384)

        // ===== Calculate amount0Out (user sends sent1 Token1, gets Token0) =====
        // Formula: amount0Out = (sent1 × 997 × reserve0) / (reserve1 × 1000 + sent1 × 997)

        // Step 1: Calculate input after fee deduction amountInWithFee = sent1 × 997
        euint64 amountInWithFee1 = FHE.mul(sent1, uint64(997));

        // Step 2: Calculate numerator = (sent1 × 997) × reserve0
        euint128 numerator0 = FHE.mul(
            FHE.asEuint128(amountInWithFee1),
            FHE.asEuint128(reserve0)
        );

        // Step 3: Calculate denominator = reserve1 × 1000 + sent1 × 997
        euint64 reserveInScaled1 = FHE.mul(reserve1, uint64(1000));
        euint64 denominatorBase0 = FHE.add(reserveInScaled1, amountInWithFee1);

        // Step 4: Apply random number obfuscation (division invariance: (a × r) / (b × r) = a / b)
        euint128 divUpperPart0 = FHE.mul(numerator0, FHE.asEuint128(rng0));
        euint128 divLowerPart0 = FHE.mul(FHE.asEuint128(denominatorBase0), FHE.asEuint128(rng0));

        // ===== Calculate amount1Out (user sends sent0 Token0, gets Token1) =====
        // Formula: amount1Out = (sent0 × 997 × reserve1) / (reserve0 × 1000 + sent0 × 997)

        // Step 1: Calculate input after fee deduction amountInWithFee = sent0 × 997
        euint64 amountInWithFee0 = FHE.mul(sent0, uint64(997));

        // Step 2: Calculate numerator = (sent0 × 997) × reserve1
        euint128 numerator1 = FHE.mul(
            FHE.asEuint128(amountInWithFee0),
            FHE.asEuint128(reserve1)
        );

        // Step 3: Calculate denominator = reserve0 × 1000 + sent0 × 997
        euint64 reserveInScaled0 = FHE.mul(reserve0, uint64(1000));
        euint64 denominatorBase1 = FHE.add(reserveInScaled0, amountInWithFee0);

        // Step 4: Apply random number obfuscation
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

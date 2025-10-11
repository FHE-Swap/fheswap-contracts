
pragma solidity ^0.8.27; 

import {FHE, externalEuint32, euint32, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {
    IConfidentialFungibleToken
} from "@openzeppelin/confidential-contracts/interfaces/IConfidentialFungibleToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// Local interface for confidential token operations
interface ILocalConfidentialFungibleToken is IConfidentialFungibleToken {
    function confidentialTransferFrom(address sender, address recipient, euint64 amount) external returns (euint64);
    function confidentialTransfer(address recipient, euint64 amount) external returns (euint64);
    function setOperator(address operator, uint64 expiration) external;
    function confidentialBalanceOf(address account) external view returns (euint64);
}

// FHESwap: Confidential token swap logic similar to Uniswap V2
// Note: Division operations must be done off-chain due to FHE limitations
contract FHESwap is Ownable, SepoliaConfig {
    using FHE for *;

    // Token contract addresses
    ILocalConfidentialFungibleToken public immutable token0;
    ILocalConfidentialFungibleToken public immutable token1;

    // Encrypted reserves
    euint64 private _reserve0;
    euint64 private _reserve1;

    // Temporary encrypted numerator/denominator for getAmountOut
    // Users decrypt these off-chain, calculate division, then re-encrypt for swap
    euint64 private _lastNumerator;
    euint64 private _lastDenominator;

    constructor(address _token0, address _token1, address owner) Ownable(owner) {
        token0 = ILocalConfidentialFungibleToken(_token0);
        token1 = ILocalConfidentialFungibleToken(_token1);
    }

    // Add initial liquidity or add to existing liquidity
    // Users must authorize this contract as operator
    function mint(
        externalEuint64 amount0,
        bytes calldata amount0Proof,
        externalEuint64 amount1,
        bytes calldata amount1Proof
    ) public {
        // Decrypt liquidity amounts
        euint64 decryptedAmount0 = FHE.fromExternal(amount0, amount0Proof);
        euint64 decryptedAmount1 = FHE.fromExternal(amount1, amount1Proof);

        // Grant access permissions (self first, then transient)
        FHE.allowThis(decryptedAmount0);
        FHE.allowThis(decryptedAmount1);
        FHE.allowTransient(decryptedAmount0, address(this));
        FHE.allowTransient(decryptedAmount1, address(this));
        FHE.allowTransient(decryptedAmount0, address(token0));
        FHE.allowTransient(decryptedAmount1, address(token1));

        // Grant access to existing reserves if initialized
        if (FHE.isInitialized(_reserve0)) {
            FHE.allowThis(_reserve0);
            FHE.allowThis(_reserve1);
            FHE.allowTransient(_reserve0, address(this));
            FHE.allowTransient(_reserve1, address(this));
        }

        // Transfer tokens from sender to this contract
        token0.confidentialTransferFrom(msg.sender, address(this), decryptedAmount0);
        token1.confidentialTransferFrom(msg.sender, address(this), decryptedAmount1);

        // Update reserves
        if (!FHE.isInitialized(_reserve0)) {
            _reserve0 = decryptedAmount0;
            _reserve1 = decryptedAmount1;
        } else {
            _reserve0 = _reserve0.add(decryptedAmount0);
            _reserve1 = _reserve1.add(decryptedAmount1);
        }

        // Grant access to updated reserves
        FHE.allowThis(_reserve0);
        FHE.allowThis(_reserve1);
        FHE.allow(_reserve0, msg.sender);
        FHE.allow(_reserve1, msg.sender);
    }

    /// @notice Calculate output token amount (using encrypted computation)
    /// @param amountIn Encrypted input token amount
    /// @param amountInProof Encryption proof for input amount
    /// @param inputToken Whether it's token0 or token1
    function getAmountOut(externalEuint64 amountIn, bytes calldata amountInProof, address inputToken) external {
        // Verify reserves are set
        require(FHE.isInitialized(_reserve0), "Reserve0 not set");
        require(FHE.isInitialized(_reserve1), "Reserve1 not set");

        // Convert external encrypted input to internal encrypted value
        euint64 encryptedAmountIn = FHE.fromExternal(amountIn, amountInProof);

        euint64 reserveIn;
        euint64 reserveOut;

        if (inputToken == address(token0)) {
            reserveIn = _reserve0;
            reserveOut = _reserve1;
        } else if (inputToken == address(token1)) {
            reserveIn = _reserve1;
            reserveOut = _reserve0;
        } else {
            revert("Invalid input token");
        }

        // Calculate input amount with fee (0.3% fee, i.e., 997/1000)
        euint64 amountInWithFee = FHE.mul(encryptedAmountIn, 997);

        // Calculate numerator and denominator
        // numerator = amountInWithFee * reserveOut
        // denominator = reserveIn * 1000 + amountInWithFee
        _lastNumerator = FHE.mul(amountInWithFee, reserveOut);
        _lastDenominator = FHE.add(FHE.mul(reserveIn, 1000), amountInWithFee);

        // Allow decryption
        FHE.allowThis(_lastNumerator);
        FHE.allowThis(_lastDenominator);
        FHE.allow(_lastNumerator, msg.sender);
        FHE.allow(_lastDenominator, msg.sender);
    }

    /// @notice Get the last calculated encrypted numerator
    function getEncryptedNumerator() external view returns (euint64) {
        return _lastNumerator;
    }

    /// @notice Get the last calculated encrypted denominator
    function getEncryptedDenominator() external view returns (euint64) {
        return _lastDenominator;
    }

    // Execute token swap
    // Users need to get numerator/denominator off-chain via getAmountOut, decrypt to calculate amountOut, then re-encrypt and pass in
    function swap(
        externalEuint64 amountIn,
        bytes calldata amountInProof,
        externalEuint64 expectedAmountOut, // Expected output amount calculated off-chain and re-encrypted
        bytes calldata expectedAmountOutProof,
        externalEuint64 minAmountOut, // New parameter: minimum expected output amount calculated off-chain by user
        bytes calldata minAmountOutProof, // New parameter: proof for minimum expected output amount
        address inputToken, // Token address passed by user
        address to // Address to receive output tokens
    ) public {
        // Verify reserves are set
        require(FHE.isInitialized(_reserve0), "Reserve0 not set for swap");
        require(FHE.isInitialized(_reserve1), "Reserve1 not set for swap");

        // Convert external encrypted input to internal encrypted value
        euint64 decryptedAmountIn = FHE.fromExternal(amountIn, amountInProof); 
        // Grant transient access permission to input token contract for this amount
        FHE.allowTransient(decryptedAmountIn, address(token0));
        FHE.allowTransient(decryptedAmountIn, address(token1));
        euint64 decryptedExpectedAmountOut = FHE.fromExternal(expectedAmountOut, expectedAmountOutProof);
        euint64 decryptedMinAmountOut = FHE.fromExternal(minAmountOut, minAmountOutProof); // Decrypt minimum expected output

        ILocalConfidentialFungibleToken tokenIn;
        ILocalConfidentialFungibleToken tokenOut;
        euint64 reserveIn;
        euint64 reserveOut;

        if (inputToken == address(token0)) {
            tokenIn = token0;
            tokenOut = token1;
            reserveIn = _reserve0;
            reserveOut = _reserve1;
        } else if (inputToken == address(token1)) {
            tokenIn = token1;
            tokenOut = token0;
            reserveIn = _reserve1;
            reserveOut = _reserve0;
        } else {
            revert("Invalid input token for swap");
        }

        // Grant transient access permission to output token contract for expected output
        FHE.allowTransient(decryptedExpectedAmountOut, address(tokenOut));

        // Use FHE.select for conditional logic instead of require
        // Compare expectedAmountOut >= minAmountOut
        ebool isAmountSufficient = FHE.ge(decryptedExpectedAmountOut, decryptedMinAmountOut);
        
        // If amount is insufficient, select 0 as transfer amount; if sufficient, select expectedAmountOut
        euint64 actualTransferAmount = FHE.select(isAmountSufficient, decryptedExpectedAmountOut, FHE.asEuint64(0));
        
        // If amount is insufficient, select 0 as input transfer amount; if sufficient, select decryptedAmountIn
        euint64 actualInputAmount = FHE.select(isAmountSufficient, decryptedAmountIn, FHE.asEuint64(0));
        
        // Grant transient access permission to output token contract for actual transfer amount
        FHE.allowTransient(actualTransferAmount, address(tokenOut));
        FHE.allowTransient(actualInputAmount, address(tokenIn));

        // Transfer input tokens from msg.sender to this contract - use actual input amount
        tokenIn.confidentialTransferFrom(msg.sender, address(this), actualInputAmount);

        // Update reserves - use actual transfer amount instead of expected amount
        if (inputToken == address(token0)) {
            _reserve0 = _reserve0.add(actualInputAmount);
            _reserve1 = _reserve1.sub(actualTransferAmount);
        } else {
            _reserve1 = _reserve1.add(actualInputAmount);
            _reserve0 = _reserve0.sub(actualTransferAmount);
        }

        // Transfer output tokens to recipient - use actual transfer amount
        tokenOut.confidentialTransfer(to, actualTransferAmount);

        // Allow on-chain and 'to' access to updated reserves
        FHE.allowThis(_reserve0);
        FHE.allowThis(_reserve1);
        FHE.allow(_reserve0, to);
        FHE.allow(_reserve1, to);
        // Allow owner access to updated reserves for testing verification
        FHE.allow(_reserve0, owner());
        FHE.allow(_reserve1, owner());
    }

    // Get reserves (only owner can view, or calculate indirectly via getAmountOut)
    function getEncryptedReserve0() external view returns (euint64) {
        return _reserve0;
    }

    function getEncryptedReserve1() external view returns (euint64) {
        return _reserve1;
    }
}

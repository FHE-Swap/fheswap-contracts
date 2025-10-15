
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27; 

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
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

    // Events for logging important operations
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1);
    event SwapExecuted(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address to
    );
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event Paused(address account);
    event Unpaused(address account);
    event EmergencyWithdraw(address indexed token, uint256 amount);

    // Token contract addresses
    ILocalConfidentialFungibleToken public immutable token0;
    ILocalConfidentialFungibleToken public immutable token1;

    // Encrypted reserves
    euint64 private _reserve0;
    euint64 private _reserve1;

    // Pause functionality
    bool public paused = false;

    // Fee management (in basis points, 30 = 0.3%)
    uint256 public swapFee = 30; // 0.3% default fee
    uint256 public constant MAX_FEE = 1000; // 10% maximum fee
    uint256 public constant FEE_DENOMINATOR = 10000; // 100% in basis points

    // Temporary encrypted numerator/denominator for getAmountOut
    // Users decrypt these off-chain, calculate division, then re-encrypt for swap
    euint64 private _lastNumerator;
    euint64 private _lastDenominator;

    // Modifiers
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    modifier whenPaused() {
        require(paused, "Contract is not paused");
        _;
    }

    constructor(address _token0, address _token1, address owner) Ownable(owner) {
        token0 = ILocalConfidentialFungibleToken(_token0);
        token1 = ILocalConfidentialFungibleToken(_token1);
    }

    // Pause/Unpause functions
    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner whenPaused {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // Fee management functions
    function setSwapFee(uint256 _newFee) external onlyOwner {
        require(_newFee <= MAX_FEE, "Fee too high");
        uint256 oldFee = swapFee;
        swapFee = _newFee;
        emit FeeUpdated(oldFee, _newFee);
    }

    function getSwapFee() external view returns (uint256) {
        return swapFee;
    }

    // Add initial liquidity or add to existing liquidity
    // Users must authorize this contract as operator
    function mint(
        externalEuint64 amount0,
        bytes calldata amount0Proof,
        externalEuint64 amount1,
        bytes calldata amount1Proof
    ) public whenNotPaused {
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

        // Calculate input amount with fee (dynamic fee)
        uint256 feeMultiplier = FEE_DENOMINATOR - swapFee;
        euint64 amountInWithFee = FHE.mul(encryptedAmountIn, feeMultiplier);

        // Calculate numerator and denominator
        // numerator = amountInWithFee * reserveOut
        // denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee
        _lastNumerator = FHE.mul(amountInWithFee, reserveOut);
        _lastDenominator = FHE.add(FHE.mul(reserveIn, FEE_DENOMINATOR), amountInWithFee);

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
    // Users need to get numerator/denominator off-chain via getAmountOut, 
    // decrypt to calculate amountOut, then re-encrypt and pass in
    function swap(
        externalEuint64 amountIn,
        bytes calldata amountInProof,
        externalEuint64 expectedAmountOut, // Expected output amount calculated off-chain
        bytes calldata expectedAmountOutProof,
        externalEuint64 minAmountOut, // Minimum expected output amount calculated off-chain by user
        bytes calldata minAmountOutProof, // Proof for minimum expected output amount
        address inputToken, // Token address passed by user
        address to // Address to receive output tokens
    ) public whenNotPaused {
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

    // Remove liquidity function
    function burn(
        externalEuint64 liquidityAmount0,
        bytes calldata liquidityAmount0Proof,
        externalEuint64 liquidityAmount1,
        bytes calldata liquidityAmount1Proof,
        address to
    ) public whenNotPaused {
        // Verify reserves are set
        require(FHE.isInitialized(_reserve0), "Reserve0 not set");
        require(FHE.isInitialized(_reserve1), "Reserve1 not set");

        // Decrypt liquidity amounts
        euint64 decryptedAmount0 = FHE.fromExternal(liquidityAmount0, liquidityAmount0Proof);
        euint64 decryptedAmount1 = FHE.fromExternal(liquidityAmount1, liquidityAmount1Proof);

        // Grant access permissions
        FHE.allowThis(decryptedAmount0);
        FHE.allowThis(decryptedAmount1);
        FHE.allowTransient(decryptedAmount0, address(this));
        FHE.allowTransient(decryptedAmount1, address(this));
        FHE.allowTransient(decryptedAmount0, address(token0));
        FHE.allowTransient(decryptedAmount1, address(token1));

        // Grant access to reserves
        FHE.allowThis(_reserve0);
        FHE.allowThis(_reserve1);
        FHE.allowTransient(_reserve0, address(this));
        FHE.allowTransient(_reserve1, address(this));

        // Verify sufficient reserves
        ebool hasEnoughReserve0 = FHE.ge(_reserve0, decryptedAmount0);
        ebool hasEnoughReserve1 = FHE.ge(_reserve1, decryptedAmount1);
        ebool hasEnoughReserves = FHE.and(hasEnoughReserve0, hasEnoughReserve1);

        // Use FHE.select for conditional logic
        euint64 actualAmount0 = FHE.select(hasEnoughReserves, decryptedAmount0, FHE.asEuint64(0));
        euint64 actualAmount1 = FHE.select(hasEnoughReserves, decryptedAmount1, FHE.asEuint64(0));

        // Grant transient access for transfers
        FHE.allowTransient(actualAmount0, address(token0));
        FHE.allowTransient(actualAmount1, address(token1));

        // Transfer tokens to recipient
        token0.confidentialTransfer(to, actualAmount0);
        token1.confidentialTransfer(to, actualAmount1);

        // Update reserves
        _reserve0 = _reserve0.sub(actualAmount0);
        _reserve1 = _reserve1.sub(actualAmount1);

        // Grant access to updated reserves
        FHE.allowThis(_reserve0);
        FHE.allowThis(_reserve1);
        FHE.allow(_reserve0, to);
        FHE.allow(_reserve1, to);
        FHE.allow(_reserve0, owner());
        FHE.allow(_reserve1, owner());
    }

    // Emergency functions
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner whenPaused {
        require(token == address(token0) || token == address(token1), "Invalid token");
        // Note: This would need to be implemented based on the token's emergency withdraw functionality
        emit EmergencyWithdraw(token, amount);
    }

    // Additional view functions
    function getToken0() external view returns (address) {
        return address(token0);
    }

    function getToken1() external view returns (address) {
        return address(token1);
    }

    function isPaused() external view returns (bool) {
        return paused;
    }

    function getMaxFee() external pure returns (uint256) {
        return MAX_FEE;
    }

    function getFeeDenominator() external pure returns (uint256) {
        return FEE_DENOMINATOR;
    }

    // Function to check if reserves are initialized
    function areReservesInitialized() external view returns (bool) {
        return FHE.isInitialized(_reserve0) && FHE.isInitialized(_reserve1);
    }
}

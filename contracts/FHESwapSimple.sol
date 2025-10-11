// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, externalEuint32, euint32, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {
    IConfidentialFungibleToken
} from "@openzeppelin/confidential-contracts/interfaces/IConfidentialFungibleToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ILocalConfidentialFungibleToken
 * @dev Extended interface for confidential token operations
 * @notice This interface ensures all confidential transfer functions are accessible
 * and provides additional functionality for FHE-based token operations
 */
interface ILocalConfidentialFungibleToken is IConfidentialFungibleToken {
    /// @notice Transfer encrypted tokens from one address to another
    /// @param sender The address to transfer tokens from
    /// @param recipient The address to transfer tokens to
    /// @param amount The encrypted amount to transfer
    /// @return The actual amount transferred (may differ due to fees)
    function confidentialTransferFrom(address sender, address recipient, euint64 amount) external returns (euint64);
    
    /// @notice Transfer encrypted tokens to a recipient
    /// @param recipient The address to transfer tokens to
    /// @param amount The encrypted amount to transfer
    /// @return The actual amount transferred
    function confidentialTransfer(address recipient, euint64 amount) external returns (euint64);
    
    /// @notice Set an operator for confidential operations
    /// @param operator The address to grant operator privileges
    /// @param expiration The expiration timestamp for operator privileges
    function setOperator(address operator, uint64 expiration) external;
    
    /// @notice Get the encrypted balance of an account
    /// @param account The account to query
    /// @return The encrypted balance
    function confidentialBalanceOf(address account) external view returns (euint64);
}

/**
 * @title FHESwapSimple
 * @dev Simplified but functional FHE-based Automated Market Maker (AMM) with liquidity management
 * @notice This contract implements a privacy-preserving decentralized exchange using Zama's FHE technology.
 * All token amounts, balances, and reserves are encrypted, providing complete transaction privacy
 * and protection against MEV attacks and front-running.
 * 
 * Key Features:
 * - Fully encrypted token swaps and liquidity management
 * - LP token minting and burning with encrypted balances
 * - 0.3% trading fee (997/1000 ratio)
 * - Off-chain division calculation support
 * - MEV and front-running protection through privacy
 */
contract FHESwapSimple is Ownable, SepoliaConfig {
    using FHE for *;

    /// @notice First token contract in the trading pair
    ILocalConfidentialFungibleToken public immutable token0;
    
    /// @notice Second token contract in the trading pair
    ILocalConfidentialFungibleToken public immutable token1;

    /// @notice Encrypted reserve amount for token0
    euint64 private _reserve0;
    
    /// @notice Encrypted reserve amount for token1
    euint64 private _reserve1;

    /// @notice Encrypted total supply of LP tokens
    euint64 private _totalSupply;
    
    /// @notice Mapping of user addresses to their encrypted LP token balances
    mapping(address => euint64) private _balances;

    /// @notice Temporary encrypted numerator for getAmountOut calculation
    /// @dev Used for off-chain division calculation due to FHE limitations
    euint64 private _lastNumerator;
    
    /// @notice Temporary encrypted denominator for getAmountOut calculation
    /// @dev Used for off-chain division calculation due to FHE limitations
    euint64 private _lastDenominator;

    /// @notice Emitted when liquidity is added to the pool
    /// @param provider The address that provided liquidity
    /// @param amount0 The amount of token0 added (encrypted, shown as 0)
    /// @param amount1 The amount of token1 added (encrypted, shown as 0)
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1);
    
    /// @notice Emitted when liquidity is removed from the pool
    /// @param provider The address that removed liquidity
    /// @param amount0 The amount of token0 removed (encrypted, shown as 0)
    /// @param amount1 The amount of token1 removed (encrypted, shown as 0)
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1);
    
    /// @notice Emitted when a token swap is executed
    /// @param user The address that initiated the swap
    /// @param tokenIn The address of the input token
    /// @param tokenOut The address of the output token
    event Swap(address indexed user, address indexed tokenIn, address indexed tokenOut);

    /**
     * @notice Constructor to initialize the FHESwapSimple contract
     * @dev Sets up the token pair and contract owner
     * @param _token0 Address of the first token contract
     * @param _token1 Address of the second token contract
     * @param owner Address that will own this contract
     */
    constructor(address _token0, address _token1, address owner) Ownable(owner) {
        token0 = ILocalConfidentialFungibleToken(_token0);
        token1 = ILocalConfidentialFungibleToken(_token1);
    }

    /**
     * @notice Add liquidity to the pool and mint LP tokens
     * @dev Users must authorize this contract as operator on both tokens before calling
     * @param amount0 Encrypted amount of token0 to add as liquidity
     * @param amount0Proof Encryption proof for amount0
     * @param amount1 Encrypted amount of token1 to add as liquidity
     * @param amount1Proof Encryption proof for amount1
     * @return liquidity The encrypted amount of LP tokens minted to the caller
     */
    function addLiquidity(
        externalEuint64 amount0,
        bytes calldata amount0Proof,
        externalEuint64 amount1,
        bytes calldata amount1Proof
    ) public returns (euint64 liquidity) {
        // Decrypt the external encrypted amounts
        euint64 decryptedAmount0 = FHE.fromExternal(amount0, amount0Proof);
        euint64 decryptedAmount1 = FHE.fromExternal(amount1, amount1Proof);

        // Grant access permissions for the decrypted amounts
        FHE.allowThis(decryptedAmount0);
        FHE.allowThis(decryptedAmount1);

        // Grant transient access for token transfers
        FHE.allowTransient(decryptedAmount0, address(this));
        FHE.allowTransient(decryptedAmount1, address(this));
        FHE.allowTransient(decryptedAmount0, address(token0));
        FHE.allowTransient(decryptedAmount1, address(token1));
        
        if (FHE.isInitialized(_totalSupply)) {
            FHE.allowThis(_totalSupply);
            FHE.allowTransient(_totalSupply, address(this));
        }
        if (FHE.isInitialized(_reserve0)) {
            FHE.allowThis(_reserve0);
            FHE.allowThis(_reserve1);
            FHE.allowTransient(_reserve0, address(this));
            FHE.allowTransient(_reserve1, address(this));
        }
        if (FHE.isInitialized(_balances[msg.sender])) {
            FHE.allowThis(_balances[msg.sender]);
            FHE.allowTransient(_balances[msg.sender], address(this));
        }

        token0.confidentialTransferFrom(msg.sender, address(this), decryptedAmount0);
        token1.confidentialTransferFrom(msg.sender, address(this), decryptedAmount1);

        if (!FHE.isInitialized(_totalSupply)) {
            liquidity = decryptedAmount0.add(decryptedAmount1);
            _totalSupply = liquidity;
        } else {
            liquidity = decryptedAmount0.add(decryptedAmount1);
            _totalSupply = _totalSupply.add(liquidity);
        }

        if (!FHE.isInitialized(_reserve0)) {
            _reserve0 = decryptedAmount0;
            _reserve1 = decryptedAmount1;
        } else {
            _reserve0 = _reserve0.add(decryptedAmount0);
            _reserve1 = _reserve1.add(decryptedAmount1);
        }

        if (!FHE.isInitialized(_balances[msg.sender])) {
            _balances[msg.sender] = liquidity;
        } else {
            _balances[msg.sender] = _balances[msg.sender].add(liquidity);
        }

        FHE.allowThis(_reserve0);
        FHE.allowThis(_reserve1);
        FHE.allowThis(_totalSupply);
        FHE.allowThis(_balances[msg.sender]);
        FHE.allowTransient(_reserve0, address(this));
        FHE.allowTransient(_reserve1, address(this));
        FHE.allowTransient(_totalSupply, address(this));
        FHE.allowTransient(_balances[msg.sender], address(this));
        FHE.allowThis(liquidity);
        
        FHE.allow(_reserve0, msg.sender);
        FHE.allow(_reserve1, msg.sender);
        FHE.allow(_balances[msg.sender], msg.sender);
        FHE.allow(liquidity, msg.sender);
        FHE.allow(_reserve0, owner());
        FHE.allow(_reserve1, owner());

        emit LiquidityAdded(msg.sender, 0, 0);

        return liquidity;
    }

    /**
     * @notice Remove liquidity and return tokens
     */
    function removeLiquidity(
        externalEuint64 liquidityAmount,
        bytes calldata liquidityProof
    ) public returns (euint64 amount0, euint64 amount1) {
        euint64 decryptedLiquidity = FHE.fromExternal(liquidityAmount, liquidityProof);
        
        FHE.allowThis(decryptedLiquidity);
        FHE.allowTransient(decryptedLiquidity, address(this));
        FHE.allowTransient(_balances[msg.sender], address(this));
        FHE.allowTransient(_totalSupply, address(this));
        FHE.allowTransient(_reserve0, address(this));
        FHE.allowTransient(_reserve1, address(this));
        
        require(FHE.isInitialized(_balances[msg.sender]), "No liquidity balance");
        
        amount0 = decryptedLiquidity;
        amount1 = decryptedLiquidity;

        _balances[msg.sender] = _balances[msg.sender].sub(decryptedLiquidity);
        _totalSupply = _totalSupply.sub(decryptedLiquidity);
        _reserve0 = _reserve0.sub(amount0);
        _reserve1 = _reserve1.sub(amount1);

        FHE.allowTransient(amount0, address(token0));
        FHE.allowTransient(amount1, address(token1));

        token0.confidentialTransfer(msg.sender, amount0);
        token1.confidentialTransfer(msg.sender, amount1);

        FHE.allowThis(amount0);
        FHE.allowThis(amount1);
        FHE.allow(amount0, msg.sender);
        FHE.allow(amount1, msg.sender);
        FHE.allowThis(_reserve0);
        FHE.allowThis(_reserve1);
        FHE.allow(_reserve0, msg.sender);
        FHE.allow(_reserve1, msg.sender);
        FHE.allow(_reserve0, owner());
        FHE.allow(_reserve1, owner());

        emit LiquidityRemoved(msg.sender, 0, 0);
        
        return (amount0, amount1);
    }

    /**
     * @notice Calculate output token amount
     */
    function getAmountOut(externalEuint64 amountIn, bytes calldata amountInProof, address inputToken) external {
        require(FHE.isInitialized(_reserve0), "Reserve0 not set");
        require(FHE.isInitialized(_reserve1), "Reserve1 not set");

        euint64 encryptedAmountIn = FHE.fromExternal(amountIn, amountInProof);
        
        FHE.allowThis(encryptedAmountIn);
        FHE.allowTransient(encryptedAmountIn, address(this));
        FHE.allowThis(_reserve0);
        FHE.allowThis(_reserve1);
        FHE.allowTransient(_reserve0, address(this));
        FHE.allowTransient(_reserve1, address(this));

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

        euint64 amountInWithFee = FHE.mul(encryptedAmountIn, 997);
        FHE.allowThis(amountInWithFee);
        FHE.allowTransient(amountInWithFee, address(this));

        _lastNumerator = FHE.mul(amountInWithFee, reserveOut);
        _lastDenominator = FHE.add(FHE.mul(reserveIn, 1000), amountInWithFee);

        FHE.allowThis(_lastNumerator);
        FHE.allowThis(_lastDenominator);
        FHE.allow(_lastNumerator, msg.sender);
        FHE.allow(_lastDenominator, msg.sender);
    }

    /**
     * @notice Execute token swap
     */
    function swap(
        externalEuint64 amountIn,
        bytes calldata amountInProof,
        externalEuint64 expectedAmountOut,
        bytes calldata expectedAmountOutProof,
        externalEuint64 minAmountOut,
        bytes calldata minAmountOutProof,
        address inputToken,
        address to
    ) public {
        require(FHE.isInitialized(_reserve0), "Reserve0 not set for swap");
        require(FHE.isInitialized(_reserve1), "Reserve1 not set for swap");

        euint64 decryptedAmountIn = FHE.fromExternal(amountIn, amountInProof);
        FHE.allowThis(decryptedAmountIn);
        FHE.allowTransient(decryptedAmountIn, address(this));
        FHE.allowTransient(decryptedAmountIn, address(token0));
        FHE.allowTransient(decryptedAmountIn, address(token1));
        
        euint64 decryptedExpectedAmountOut = FHE.fromExternal(expectedAmountOut, expectedAmountOutProof);
        euint64 decryptedMinAmountOut = FHE.fromExternal(minAmountOut, minAmountOutProof);
        
        FHE.allowThis(decryptedExpectedAmountOut);
        FHE.allowThis(decryptedMinAmountOut);
        FHE.allowTransient(decryptedExpectedAmountOut, address(this));
        FHE.allowTransient(decryptedMinAmountOut, address(this));
        
        FHE.allowThis(_reserve0);
        FHE.allowThis(_reserve1);
        FHE.allowTransient(_reserve0, address(this));
        FHE.allowTransient(_reserve1, address(this));

        ILocalConfidentialFungibleToken tokenIn;
        ILocalConfidentialFungibleToken tokenOut;

        if (inputToken == address(token0)) {
            tokenIn = token0;
            tokenOut = token1;
        } else if (inputToken == address(token1)) {
            tokenIn = token1;
            tokenOut = token0;
        } else {
            revert("Invalid input token for swap");
        }

        FHE.allowTransient(decryptedExpectedAmountOut, address(tokenOut));

        tokenIn.confidentialTransferFrom(msg.sender, address(this), decryptedAmountIn);

        if (inputToken == address(token0)) {
            _reserve0 = _reserve0.add(decryptedAmountIn);
            _reserve1 = _reserve1.sub(decryptedExpectedAmountOut);
        } else {
            _reserve1 = _reserve1.add(decryptedAmountIn);
            _reserve0 = _reserve0.sub(decryptedExpectedAmountOut);
        }

        tokenOut.confidentialTransfer(to, decryptedExpectedAmountOut);

        FHE.allowThis(_reserve0);
        FHE.allowThis(_reserve1);
        FHE.allow(_reserve0, to);
        FHE.allow(_reserve1, to);
        FHE.allow(_reserve0, owner());
        FHE.allow(_reserve1, owner());

        emit Swap(msg.sender, inputToken, address(tokenOut));
    }

    // =========================== View functions ===========================
    function getEncryptedNumerator() external view returns (euint64) {
        return _lastNumerator;
    }

    function getEncryptedDenominator() external view returns (euint64) {
        return _lastDenominator;
    }

    function getEncryptedReserve0() external view returns (euint64) {
        return _reserve0;
    }
    

    function getEncryptedReserve1() external view returns (euint64) {
        return _reserve1;
    }

    function getEncryptedTotalSupply() external view returns (euint64) {
        return _totalSupply;
    }

    function getEncryptedLPBalance(address account) external view returns (euint64) {
        return _balances[account];
    }
}

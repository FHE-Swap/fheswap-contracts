// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, externalEuint32, euint32, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {
    IConfidentialFungibleToken
} from "@openzeppelin/confidential-contracts/interfaces/IConfidentialFungibleToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// Local interface to ensure confidential transfer functions are accessible
interface ILocalConfidentialFungibleToken is IConfidentialFungibleToken {
    function confidentialTransferFrom(address sender, address recipient, euint64 amount) external returns (euint64);
    function confidentialTransfer(address recipient, euint64 amount) external returns (euint64);
    function setOperator(address operator, uint64 expiration) external;
    function confidentialBalanceOf(address account) external view returns (euint64);
}

/**
 * @title FHESwapSimple
 * @dev Simplified but functional FHE-based AMM with liquidity management
 */
contract FHESwapSimple is Ownable, SepoliaConfig {
    using FHE for *;

    // Token contracts
    ILocalConfidentialFungibleToken public immutable token0;
    ILocalConfidentialFungibleToken public immutable token1;

    // Encrypted reserves
    euint64 private _reserve0;
    euint64 private _reserve1;

    // Encrypted total LP supply
    euint64 private _totalSupply;
    
    // Encrypted LP balances
    mapping(address => euint64) private _balances;

    // Temporary encrypted numerator & denominator for getAmountOut
    euint64 private _lastNumerator;
    euint64 private _lastDenominator;

    // Events
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1);
    event Swap(address indexed user, address indexed tokenIn, address indexed tokenOut);

    constructor(address _token0, address _token1, address owner) Ownable(owner) {
        token0 = ILocalConfidentialFungibleToken(_token0);
        token1 = ILocalConfidentialFungibleToken(_token1);
    }

    /**
     * @notice Add liquidity and mint LP tokens
     */
    function addLiquidity(
        externalEuint64 amount0,
        bytes calldata amount0Proof,
        externalEuint64 amount1,
        bytes calldata amount1Proof
    ) public returns (euint64 liquidity) {
        euint64 decryptedAmount0 = FHE.fromExternal(amount0, amount0Proof);
        euint64 decryptedAmount1 = FHE.fromExternal(amount1, amount1Proof);

        FHE.allowThis(decryptedAmount0);
        FHE.allowThis(decryptedAmount1);

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

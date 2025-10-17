// SPDX-License-Identifier: MIT
  
pragma solidity ^0.8.27;
  

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
  
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
  
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
  
import {
    IConfidentialFungibleToken
} from "@openzeppelin/confidential-contracts/interfaces/IConfidentialFungibleToken.sol";
  

interface ILocalConfidentialFungibleToken is IConfidentialFungibleToken {
      
    function confidentialTransferFrom(address sender, address recipient, euint64 amount) external returns (euint64);
      
    function confidentialTransfer(address recipient, euint64 amount) external returns (euint64);
      
    function setOperator(address operator, uint64 expiration) external;
      
    function confidentialBalanceOf(address account) external view returns (euint64);
      
}

/**
 * @title FHESwapSimpleGuarded
 * @dev Enhanced version of FHESwapSimple with ZK proof-based signature verification for swapWithProof.
 *      Retains quote numerator/denominator logic in another contract, focusing on signature verification and transfer execution.
 */
contract FHESwapSimpleGuarded is Ownable, SepoliaConfig {
      
    using FHE for *;
      

    ILocalConfidentialFungibleToken public immutable token0;
      
    ILocalConfidentialFungibleToken public immutable token1;
      

    // Encrypted reserves
    euint64 private _reserve0;
      
    euint64 private _reserve1;
      

    // Encrypted total LP supply & balances
    euint64 private _totalSupply;
      
    mapping(address => euint64) private _balances;
      

    // Temporary encrypted numerator & denominator for getAmountOut
    euint64 private _lastNumerator;
      
    euint64 private _lastDenominator;
      

    // Liquidity calculation related state
    euint64 private _liquidityNumerator0;
      
    euint64 private _liquidityNumerator1;
      
    euint64 private _currentReserve0;
      
    euint64 private _currentReserve1;
      
    euint64 private _currentTotalSupply;
      
    bool private _isFirstAdd;
      

    // Fee management
    address public feeTo;                      
      
    bool public feeEnabled;                    
      
    address public feeToSetter;                
      
    uint256 public protocolFeeBps = 5;         
      
    
    // Fee accumulation tracking
    euint64 private _lastK;                    
      

    // Trusted verifier for signatures
    address public trustedVerifier;
      
    mapping(bytes32 => bool) public consumedProofs;
      

      
    struct LiquidityParams {
          
        externalEuint64 amount0;
          
        bytes amount0Proof;
        // Encryption proof for amount0, used to verify correctness of encrypted data
        externalEuint64 amount1;
          
        bytes amount1Proof;
        // Encryption proof for amount1, used to verify correctness of encrypted data
        externalEuint64 liquidityMinted;  
          
        bytes liquidityMintedProof;
        // Encryption proof for liquidityMinted
        externalEuint64 protocolFeeLP;  
          
        bytes protocolFeeLPProof;
        // Encryption proof for protocolFeeLP
        
          
        externalEuint64 minAmount0;
          
        bytes minAmount0Proof;
        // Encryption proof for minAmount0
        externalEuint64 minAmount1;
          
        bytes minAmount1Proof;
        // Encryption proof for minAmount1
        externalEuint64 minLiquidity;
          
        bytes minLiquidityProof;
        // Encryption proof for minLiquidity
        
        uint64 expiry;
          
        bytes32 proofHash;
          
        uint8 v;
        // ECDSA signature v value
        bytes32 r;
        // ECDSA signature r value
        bytes32 s;
        // ECDSA signature s value
    }

    struct RemoveLiquidityParams {
          
        externalEuint64 liquidity;
          
        bytes liquidityProof;
        // Encryption proof for liquidity
        externalEuint64 amount0Out;
          
        bytes amount0OutProof;
        // Encryption proof for amount0Out
        externalEuint64 amount1Out;
          
        bytes amount1OutProof;
        // Encryption proof for amount1Out
        externalEuint64 protocolFeeLP;
          
        bytes protocolFeeLPProof;
        // Encryption proof for protocolFeeLP
        
          
        externalEuint64 minAmount0Out;
          
        bytes minAmount0OutProof;
        // Encryption proof for minAmount0Out
        externalEuint64 minAmount1Out;
          
        bytes minAmount1OutProof;
        // Encryption proof for minAmount1Out
        
        uint64 expiry;
          
        bytes32 proofHash;
          
        uint8 v;
        // ECDSA signature v value
        bytes32 r;
        // ECDSA signature r value
        bytes32 s;
        // ECDSA signature s value
    }

    event SwapWithProof(address indexed user, address indexed tokenIn, address indexed to, bytes32 proofHash);
      
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1);
      
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1);
      
    event LiquidityAddedWithProof(address indexed provider, bytes32 proofHash);
      
    event LiquidityNumeratorsCalculated(address indexed user);
      
    
      
    event DebugLastK(uint64 lastK);
      
    event DebugPermissionCheck(string operation, bool hasPermission);
      
    
    // Fee related events
    event FeeToSet(address indexed feeTo);
      
    event FeeToSetterSet(address indexed feeToSetter);
      
    event FeeEnabledSet(bool enabled);
      
    event ProtocolFeeBpsSet(uint256 protocolFeeBps);
      
    event ProtocolFeeDistributed(address indexed feeTo, uint256 amount);
      

    constructor(address _token0, address _token1, address owner, address _trustedVerifier) Ownable(owner) {
          
        token0 = ILocalConfidentialFungibleToken(_token0);
          
        token1 = ILocalConfidentialFungibleToken(_token1);
          
        trustedVerifier = _trustedVerifier;
          
        
          
        feeToSetter = owner;    
          
        feeEnabled = false;     
          
        feeTo = address(0);     
          
    }

    function setTrustedVerifier(address _verifier) external onlyOwner {
          
        trustedVerifier = _verifier;
          
    }

    // ==================== Fee Control Functions ====================
    
    modifier onlyFeeToSetter() {
          
        require(msg.sender == feeToSetter, "Not authorized to set fee");
          
        _;
          
    }

    function setFeeTo(address _feeTo) external onlyFeeToSetter {
          
        feeTo = _feeTo;
          
        emit FeeToSet(_feeTo);
          
    }

    function setFeeToSetter(address _feeToSetter) external onlyFeeToSetter {
          
        feeToSetter = _feeToSetter;
          
        emit FeeToSetterSet(_feeToSetter);
          
    }

    function setFeeEnabled(bool _enabled) external onlyFeeToSetter {
          
        feeEnabled = _enabled;
          
        emit FeeEnabledSet(_enabled);
          
    }
    
      
    function setProtocolFeeBps(uint256 _protocolFeeBps) external onlyFeeToSetter {
          
        require(_protocolFeeBps <= 1000, "Protocol fee too high");   
          
        protocolFeeBps = _protocolFeeBps;
          
        emit ProtocolFeeBpsSet(_protocolFeeBps);
          
    }

    function _recover(bytes32 proofHash, uint8 v, bytes32 r, bytes32 s) internal pure returns (address) {
          
        bytes32 ethSigned = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", proofHash));
          
        return ecrecover(ethSigned, v, r, s);
          
    }

    /// @notice Calculate output token amount on-chain using encrypted computation
    /// @param amountIn Encrypted input token amount
    /// @param amountInProof Encryption proof for input amount
    /// @param inputToken Token0 or token1 address
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
          

          
        // numerator = amountInWithFee * reserveOut
        // denominator = reserveIn * 1000 + amountInWithFee
        _lastNumerator = FHE.mul(amountInWithFee, reserveOut);
          
        _lastDenominator = FHE.add(FHE.mul(reserveIn, 1000), amountInWithFee);
          

          
        FHE.allowThis(_lastNumerator);
          
        FHE.allowThis(_lastDenominator);
          
        FHE.allow(_lastNumerator, msg.sender);
          
        FHE.allow(_lastDenominator, msg.sender);
          
    }

    /// @notice Execute on-chain swap with proof hash and signature
    /// @param amountIn Encrypted input
    /// @param amountInProof Encryption proof for input
    /// @param expectedAmountOut Encrypted expected output (calculated off-chain from quote numerator/denominator)
    /// @param expectedAmountOutProof Proof for expected output
    /// @param inputToken Input token address (token0 or token1)
    /// @param to Recipient address
    /// @param expiry Expiry timestamp
    /// @param proofHash keccak256 calculated by RISC Zero host based on journal
    /// @param v ecrecover v
    /// @param r ecrecover r
    /// @param s ecrecover s
    function swapWithProof(
        externalEuint64 amountIn,
        bytes calldata amountInProof,
        externalEuint64 expectedAmountOut,
        bytes calldata expectedAmountOutProof,
        address inputToken,
        address to,
        uint64 expiry,
        bytes32 proofHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
          
        require(block.timestamp <= expiry, "expired");
          
        require(!consumedProofs[proofHash], "consumed");
          
        require(trustedVerifier != address(0), "no verifier");
          

        address signer = _recover(proofHash, v, r, s);
          
        require(signer == trustedVerifier, "bad signature");
          

          
        euint64 decryptedAmountIn = FHE.fromExternal(amountIn, amountInProof);
          
        euint64 decryptedExpectedAmountOut = FHE.fromExternal(expectedAmountOut, expectedAmountOutProof);
          

        ILocalConfidentialFungibleToken tokenIn;
          
        ILocalConfidentialFungibleToken tokenOut;
          

        if (inputToken == address(token0)) {
              
            tokenIn = token0;
              
            tokenOut = token1;
              
        } else if (inputToken == address(token1)) {
              
            tokenIn = token1;
              
            tokenOut = token0;
              
        } else {
            revert("invalid token");
              
        }

          
        FHE.allowTransient(decryptedAmountIn, address(tokenIn));
          
        FHE.allowTransient(decryptedExpectedAmountOut, address(tokenOut));
          

          
        tokenIn.confidentialTransferFrom(msg.sender, address(this), decryptedAmountIn);
          

          
        if (inputToken == address(token0)) {
              
            _reserve0 = _reserve0.add(decryptedAmountIn);
              
            FHE.allowThis(_reserve0);   
              
            _reserve1 = _reserve1.sub(decryptedExpectedAmountOut);
              
            FHE.allowThis(_reserve1);   
              
        } else {
              
            _reserve1 = _reserve1.add(decryptedAmountIn);
              
            FHE.allowThis(_reserve1);   
              
            _reserve0 = _reserve0.sub(decryptedExpectedAmountOut);
              
            FHE.allowThis(_reserve0);   
              
        }

          
        if (FHE.isInitialized(_reserve0) && FHE.isInitialized(_reserve1)) {
              
            _lastK = FHE.mul(_reserve0, _reserve1);
              
            FHE.allowThis(_lastK);   
              
              
            // emit DebugLastK(FHE.decrypt(_lastK));   
        }

          
        FHE.allowThis(_reserve0);
          
        FHE.allowThis(_reserve1);
          
        FHE.allow(_reserve0, owner());
          
        FHE.allow(_reserve1, owner());
          
        FHE.allow(_reserve0, msg.sender);
          
        FHE.allow(_reserve1, msg.sender);
          
        if (FHE.isInitialized(_lastK)) {
              
            FHE.allowThis(_lastK);
              
            FHE.allowTransient(_lastK, address(this));
              
            FHE.allow(_lastK, owner());
              
            FHE.allow(_lastK, msg.sender);
              
        }

        tokenOut.confidentialTransfer(to, decryptedExpectedAmountOut);
          

          
        consumedProofs[proofHash] = true;
          
        emit SwapWithProof(msg.sender, inputToken, to, proofHash);
          
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
    
    /// @notice Get the last calculated encrypted numerator
    function getEncryptedNumerator() external view returns (euint64) {
          
        return _lastNumerator;
          
    }

    /// @notice Get the last calculated encrypted denominator
    function getEncryptedDenominator() external view returns (euint64) {
          
        return _lastDenominator;
          
    }

    /// @notice Read-only signature verification for external pre-check
    function isValidProof(bytes32 proofHash, uint8 v, bytes32 r, bytes32 s) external view returns (bool) {
          
        if (trustedVerifier == address(0)) return false;
          
        address signer = _recover(proofHash, v, r, s);
          
        return signer == trustedVerifier && !consumedProofs[proofHash];
          
    }

    // ==================== Liquidity Related Functions ====================

    /// @notice Calculate add liquidity numerator (callable by project)
    /// @param user User address
    /// @param amount0 Encrypted token0 amount
    /// @param amount0Proof Encryption proof for amount0
    /// @param amount1 Encrypted token1 amount
    /// @param amount1Proof Encryption proof for amount1
    function calculateAddLiquidityNumerators(
        address user,
        externalEuint64 amount0,
        bytes calldata amount0Proof,
        externalEuint64 amount1,
        bytes calldata amount1Proof
    ) external {
          
        // 1. Decrypt input parameters
        euint64 decryptedAmount0 = FHE.fromExternal(amount0, amount0Proof);
          
        euint64 decryptedAmount1 = FHE.fromExternal(amount1, amount1Proof);
          
        
        // 2. Set permissions (selective decryption)
        FHE.allowThis(decryptedAmount0);
          
        FHE.allowThis(decryptedAmount1);
          
        FHE.allowTransient(decryptedAmount0, address(this));
          
        FHE.allowTransient(decryptedAmount1, address(this));
          
        
        // 3. Note: No permission setting here as contract may not have permission to set permissions
          
        
        // 4. Store current state
        _currentReserve0 = _reserve0;
          
        _currentReserve1 = _reserve1;
          
        _currentTotalSupply = _totalSupply;
          
        _isFirstAdd = !FHE.isInitialized(_totalSupply);
          
        
        // 5. Calculate numerator (based on whether it's first add)
        if (_isFirstAdd) {
              
            _liquidityNumerator0 = decryptedAmount0;
              
            _liquidityNumerator1 = decryptedAmount1;
              
        } else {
              
            _liquidityNumerator0 = FHE.mul(decryptedAmount0, _totalSupply);
              
            _liquidityNumerator1 = FHE.mul(decryptedAmount1, _totalSupply);
              
        }
        
        // 6. Set user data permissions (for user themselves)
        FHE.allowThis(_liquidityNumerator0);
          
        FHE.allowThis(_liquidityNumerator1);
          
        FHE.allow(_liquidityNumerator0, user);
          
        FHE.allow(_liquidityNumerator1, user);
          
        
        emit LiquidityNumeratorsCalculated(user);
          
    }

    /// @notice Calculate remove liquidity numerator (callable by project)
    /// @param user User address
    /// @param liquidity Encrypted LP amount
    /// @param liquidityProof Encryption proof for liquidity
    function calculateRemoveLiquidityNumerators(
        address user,
        externalEuint64 liquidity,
        bytes calldata liquidityProof
    ) external {
          
        // 1. Decrypt input parameters
        euint64 decryptedLiquidity = FHE.fromExternal(liquidity, liquidityProof);
          
        
        // 2. Set permissions (selective decryption)
        FHE.allowThis(decryptedLiquidity);
          
        FHE.allowTransient(decryptedLiquidity, address(this));
          
        
        // 3. Note: No permission setting here as contract may not have permission to set permissions
          
        
        // 4. Store current state
        _currentReserve0 = _reserve0;
          
        _currentReserve1 = _reserve1;
          
        _currentTotalSupply = _totalSupply;
          
        _isFirstAdd = false;   
          
        
        // 5. Calculate numerator (liquidity * reserve0, liquidity * reserve1)
        _liquidityNumerator0 = FHE.mul(decryptedLiquidity, _reserve0);
          
        _liquidityNumerator1 = FHE.mul(decryptedLiquidity, _reserve1);
          
        
        // 6. Set user data permissions (for user themselves)
        FHE.allowThis(_liquidityNumerator0);
          
        FHE.allowThis(_liquidityNumerator1);
          
        FHE.allow(_liquidityNumerator0, user);
          
        FHE.allow(_liquidityNumerator1, user);
          
        
        emit LiquidityNumeratorsCalculated(user);
          
    }

    /// @notice Add liquidity based on RISC Zero proof
    /// @param params Struct containing all necessary parameters
    function addLiquidityWithProof(LiquidityParams calldata params) external {
          
        // 1. Verify proof
        require(block.timestamp <= params.expiry, "expired");
          
        require(!consumedProofs[params.proofHash], "consumed");
          
        require(trustedVerifier != address(0), "no verifier");
          
        
        address signer = _recover(params.proofHash, params.v, params.r, params.s);
          
        require(signer == trustedVerifier, "bad signature");
          
        
        // 1.1 Set transient permissions for existing state (avoid calling allowThis on unpermitted handles)
        if (FHE.isInitialized(_reserve0)) {
              
            FHE.allowTransient(_reserve0, address(this));
              
        }
        if (FHE.isInitialized(_reserve1)) {
              
            FHE.allowTransient(_reserve1, address(this));
              
        }
        if (FHE.isInitialized(_totalSupply)) {
              
            FHE.allowTransient(_totalSupply, address(this));
              
        }
        if (FHE.isInitialized(_balances[msg.sender])) {
              
            FHE.allowTransient(_balances[msg.sender], address(this));
              
        }
        if (FHE.isInitialized(_lastK)) {
              
            FHE.allowTransient(_lastK, address(this));
              
        }
        
        // 2. Decrypt parameters
        euint64 decryptedAmount0 = FHE.fromExternal(params.amount0, params.amount0Proof);
          
        euint64 decryptedAmount1 = FHE.fromExternal(params.amount1, params.amount1Proof);
          
        euint64 decryptedLiquidityMinted = FHE.fromExternal(params.liquidityMinted, params.liquidityMintedProof);
          
        euint64 decryptedProtocolFeeLP = FHE.fromExternal(params.protocolFeeLP, params.protocolFeeLPProof);
          
        
        // 2.1 Set permissions for all decrypted inputs (before any FHE operations)
        FHE.allowThis(decryptedAmount0);
          
        FHE.allowThis(decryptedAmount1);
          
        FHE.allowThis(decryptedLiquidityMinted);
          
        FHE.allowThis(decryptedProtocolFeeLP);
          
        FHE.allowTransient(decryptedAmount0, address(this));
          
        FHE.allowTransient(decryptedAmount1, address(this));
          
        FHE.allowTransient(decryptedLiquidityMinted, address(this));
          
        FHE.allowTransient(decryptedProtocolFeeLP, address(this));
          
        
        // 3. Execute token transfers
        FHE.allowTransient(decryptedAmount0, address(token0));
          
        FHE.allowTransient(decryptedAmount1, address(token1));
          
        token0.confidentialTransferFrom(msg.sender, address(this), decryptedAmount0);
          
        token1.confidentialTransferFrom(msg.sender, address(this), decryptedAmount1);
          
        
        // 4. Update reserves (state after deposit)
        if (!FHE.isInitialized(_reserve0)) {
              
            _reserve0 = decryptedAmount0;
              
            _reserve1 = decryptedAmount1;
              
        } else {
              
              
            if (FHE.isInitialized(_reserve0)) {
                  
                FHE.allowThis(_reserve0);
                  
            }
            if (FHE.isInitialized(_reserve1)) {
                  
                FHE.allowThis(_reserve1);
                  
            }
            FHE.allowThis(decryptedAmount0);
              
            FHE.allowThis(decryptedAmount1);
              

            _reserve0 = _reserve0.add(decryptedAmount0);
              
            _reserve1 = _reserve1.add(decryptedAmount1);
              
        }
        
        // 4.1 Immediately set permissions to ensure contract can access updated reserves
        FHE.allowThis(_reserve0);
          
        FHE.allowThis(_reserve1);
          
        
        // 5. Check if it's first add (before distributing protocol fees)
        bool isFirstAdd = !FHE.isInitialized(_totalSupply);
          
        
        // 6. First distribute protocol fees (based on current totalSupply)
        if (feeEnabled && feeTo != address(0)) {
              
              
            if (FHE.isInitialized(_totalSupply)) {
                  
                FHE.allowThis(_totalSupply);
                  
            }
            if (FHE.isInitialized(_balances[feeTo])) {
                  
                FHE.allowThis(_balances[feeTo]);
                  
            }
            FHE.allowThis(decryptedProtocolFeeLP);
              

            if (FHE.isInitialized(_totalSupply)) {
                  
                _totalSupply = _totalSupply.add(decryptedProtocolFeeLP);
                  
            } else {
                  
                _totalSupply = decryptedProtocolFeeLP;
                  
            }

            if (FHE.isInitialized(_balances[feeTo])) {
                  
                _balances[feeTo] = _balances[feeTo].add(decryptedProtocolFeeLP);
                  
            } else {
                  
                _balances[feeTo] = decryptedProtocolFeeLP;
                  
            }
        }

        if (isFirstAdd) {
              
              
            euint64 lockedLP = FHE.asEuint64(1000);
              
              
            FHE.allowThis(lockedLP);
              
            FHE.allowTransient(lockedLP, address(this));
              
            
              
            FHE.allowThis(decryptedLiquidityMinted);
              
            FHE.allowThis(lockedLP);
              
            
            _totalSupply = decryptedLiquidityMinted.add(lockedLP);   
              
            _balances[msg.sender] = decryptedLiquidityMinted;   
              
            _balances[address(0)] = lockedLP;   
              
        } else {
              
              
            if (FHE.isInitialized(_totalSupply)) {
                  
                FHE.allowThis(_totalSupply);
                  
            }
            FHE.allowThis(decryptedLiquidityMinted);
              

            if (FHE.isInitialized(_totalSupply)) {
                  
                _totalSupply = _totalSupply.add(decryptedLiquidityMinted);
                  
            } else {
                  
                _totalSupply = decryptedLiquidityMinted;
                  
            }

            if (!FHE.isInitialized(_balances[msg.sender])) {
                  
                _balances[msg.sender] = decryptedLiquidityMinted;
                  
            } else {
                  
                  
                FHE.allowThis(_balances[msg.sender]);
                  
                FHE.allowThis(decryptedLiquidityMinted);
                  
                FHE.allowTransient(_balances[msg.sender], address(this));
                  
                _balances[msg.sender] = _balances[msg.sender].add(decryptedLiquidityMinted);
                  
            }
        }
        

        if (FHE.isInitialized(_reserve0) && FHE.isInitialized(_reserve1)) {
              
            _lastK = FHE.mul(_reserve0, _reserve1);
              
        }
        
        // 8. Set permissions for all updated state (following FHESwapSimple pattern)
        if (FHE.isInitialized(_reserve0)) {
              
            FHE.allowThis(_reserve0);
              
            FHE.allowTransient(_reserve0, address(this));
              
            FHE.allow(_reserve0, msg.sender);
              
            FHE.allow(_reserve0, owner());
              
        }
        if (FHE.isInitialized(_reserve1)) {
              
            FHE.allowThis(_reserve1);
              
            FHE.allowTransient(_reserve1, address(this));
              
            FHE.allow(_reserve1, msg.sender);
              
            FHE.allow(_reserve1, owner());
              
        }
        if (FHE.isInitialized(_totalSupply)) {
              
            FHE.allowThis(_totalSupply);
              
            FHE.allowTransient(_totalSupply, address(this));
              
            FHE.allow(_totalSupply, msg.sender);
              
            FHE.allow(_totalSupply, owner());
              
        }
        if (FHE.isInitialized(_balances[msg.sender])) {
              
            FHE.allowThis(_balances[msg.sender]);
              
            FHE.allowTransient(_balances[msg.sender], address(this));
              
            FHE.allow(_balances[msg.sender], msg.sender);
              
        }
        if (FHE.isInitialized(_lastK)) {
              
            FHE.allowThis(_lastK);
              
            FHE.allowTransient(_lastK, address(this));
              
        }
        
        
        consumedProofs[params.proofHash] = true;
          
        emit LiquidityAddedWithProof(msg.sender, params.proofHash);
          
    }

    /// @notice 
    /// @param params 
    function removeLiquidityWithProof(RemoveLiquidityParams calldata params) external {
          
        // 1. Verify proof
        require(block.timestamp <= params.expiry, "expired");
          
        require(!consumedProofs[params.proofHash], "consumed");
          
        require(trustedVerifier != address(0), "no verifier");
          
        
        address signer = _recover(params.proofHash, params.v, params.r, params.s);
          
        require(signer == trustedVerifier, "bad signature");
          
        
       
        if (FHE.isInitialized(_reserve0) && FHE.isSenderAllowed(_reserve0)) {
              
            FHE.allowTransient(_reserve0, address(this));
              
        }
        if (FHE.isInitialized(_reserve1) && FHE.isSenderAllowed(_reserve1)) {
              
            FHE.allowTransient(_reserve1, address(this));
              
        }
        if (FHE.isInitialized(_totalSupply) && FHE.isSenderAllowed(_totalSupply)) {
              
            FHE.allowTransient(_totalSupply, address(this));
              
        }
        if (FHE.isInitialized(_balances[msg.sender]) && FHE.isSenderAllowed(_balances[msg.sender])) {
              
            FHE.allowTransient(_balances[msg.sender], address(this));
              
        }
        if (FHE.isInitialized(_lastK) && FHE.isSenderAllowed(_lastK)) {
              
            FHE.allowTransient(_lastK, address(this));
              
        }
        
        // 2. Decrypt parameters
        euint64 decryptedLiquidity = FHE.fromExternal(params.liquidity, params.liquidityProof);
          
        euint64 decryptedAmount0Out = FHE.fromExternal(params.amount0Out, params.amount0OutProof);
          
        euint64 decryptedAmount1Out = FHE.fromExternal(params.amount1Out, params.amount1OutProof);
          
        euint64 decryptedProtocolFeeLP = FHE.fromExternal(params.protocolFeeLP, params.protocolFeeLPProof);
          
        
       
        FHE.allowThis(decryptedLiquidity);
          
        FHE.allowThis(decryptedAmount0Out);
          
        FHE.allowThis(decryptedAmount1Out);
          
        FHE.allowThis(decryptedProtocolFeeLP);
          
        
        FHE.allowTransient(decryptedLiquidity, address(this));
          
        FHE.allowTransient(decryptedAmount0Out, address(this));
          
        FHE.allowTransient(decryptedAmount1Out, address(this));
          
        FHE.allowTransient(decryptedProtocolFeeLP, address(this));
          
        
       
        FHE.allowTransient(decryptedAmount0Out, address(token0));
          
        FHE.allowTransient(decryptedAmount1Out, address(token1));
          
        
        
        require(FHE.isInitialized(_balances[msg.sender]), "no LP");
          
        
       
        bool _feeUpdated = false;
          
        if (feeEnabled && feeTo != address(0)) {
              
              
            if (FHE.isInitialized(_totalSupply) && FHE.isSenderAllowed(_totalSupply)) {
                  
                FHE.allowTransient(_totalSupply, address(this));
                  
                _totalSupply = _totalSupply.add(decryptedProtocolFeeLP);
                  
            } else if (FHE.isInitialized(_totalSupply)) {
                  
                  
                _totalSupply = decryptedProtocolFeeLP;
                  
            } else {
                  
                _totalSupply = decryptedProtocolFeeLP;
                  
            }

            if (FHE.isInitialized(_balances[feeTo]) && FHE.isSenderAllowed(_balances[feeTo])) {
                  
                FHE.allowTransient(_balances[feeTo], address(this));
                  
                _balances[feeTo] = _balances[feeTo].add(decryptedProtocolFeeLP);
                  
            } else if (FHE.isInitialized(_balances[feeTo])) {
                  
                  
                _balances[feeTo] = decryptedProtocolFeeLP;
                  
            } else {
                  
                _balances[feeTo] = decryptedProtocolFeeLP;
                  
            }
            _feeUpdated = true;
              
        }
        
      
        
          

        _balances[msg.sender] = _balances[msg.sender].sub(decryptedLiquidity);
          
          
        _totalSupply = _totalSupply.sub(decryptedLiquidity);
          
          
    
        if (FHE.isInitialized(_reserve0) && FHE.isInitialized(_reserve1)) {
              
            _reserve0 = _reserve0.sub(decryptedAmount0Out);
              
              
            _reserve1 = _reserve1.sub(decryptedAmount1Out);
              
              

            // 7. Update k value
            _lastK = FHE.mul(_reserve0, _reserve1);
              
              
        }
 
          
        token0.confidentialTransfer(msg.sender, decryptedAmount0Out);
          
        token1.confidentialTransfer(msg.sender, decryptedAmount1Out);
          

        // 8. Set user decryption permissions for updated state (ensure contract has permissions first)
        if (FHE.isInitialized(_balances[msg.sender])) {
              
            FHE.allowThis(_balances[msg.sender]);
              
            FHE.allow(_balances[msg.sender], msg.sender);
              
        }
        if (FHE.isInitialized(_reserve0)) {
              
            FHE.allowThis(_reserve0);
              
            FHE.allow(_reserve0, owner());
              
            FHE.allow(_reserve0, msg.sender);
              
        }
        if (FHE.isInitialized(_reserve1)) {
              
            FHE.allowThis(_reserve1);
              
            FHE.allow(_reserve1, owner());
              
            FHE.allow(_reserve1, msg.sender);
              
        }
        if (FHE.isInitialized(_totalSupply)) {
              
            FHE.allowThis(_totalSupply);
              
            FHE.allow(_totalSupply, owner());
              
            FHE.allow(_totalSupply, msg.sender);
              
        }

    
        consumedProofs[params.proofHash] = true;
          
        emit LiquidityRemoved(msg.sender, 0, 0);
          
    }

    // ==================== Liquidity Related Read-Only Functions ====================

    /// @notice 
    function getLiquidityNumerator0() external view returns (euint64) {
          
        return _liquidityNumerator0;
          
    }

    /// @notice 
    function getLiquidityNumerator1() external view returns (euint64) {
          
        return _liquidityNumerator1;
          
    }

    /// @notice 
    function getCurrentReserve0() external view returns (euint64) {
          
        return _currentReserve0;
          
    }

    /// @notice
    function getCurrentReserve1() external view returns (euint64) {
          
        return _currentReserve1;
          
    }

    /// @notice 
    function getCurrentTotalSupply() external view returns (euint64) {
          
        return _currentTotalSupply;
          
    }

    /// @notice 
    function getIsFirstAdd() external view returns (bool) {
          
        return _isFirstAdd;
          
    }

    /// @notice 
    function getEncryptedLastK() external view returns (euint64) {
          
        return _lastK;
          
    }

 
    /// @notice 
    /// @param lpAmount 
    /// @param lpAmountProof
    /// @param expectedAmount0Out 
    /// @param expectedAmount0OutProof 
    /// @param expectedAmount1Out 
    /// @param expectedAmount1OutProof 
    /// @param expiry 
    /// @param proofHash 
    /// @param v 
    /// @param r 
    /// @param s 
    function withdrawProtocolFees(
        externalEuint64 lpAmount,
        bytes calldata lpAmountProof,
        externalEuint64 expectedAmount0Out,
        bytes calldata expectedAmount0OutProof,
        externalEuint64 expectedAmount1Out,
        bytes calldata expectedAmount1OutProof,
        uint256 expiry,
        bytes32 proofHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
          
        require(msg.sender == feeTo, "Only feeTo can withdraw");
          
        require(feeTo != address(0), "FeeTo not set");
          
        require(block.timestamp <= expiry, "expired");
          
        require(!consumedProofs[proofHash], "consumed");
          
        require(trustedVerifier != address(0), "no verifier");
          
        
        address signer = _recover(proofHash, v, r, s);
          
        require(signer == trustedVerifier, "bad signature");
          
        
        consumedProofs[proofHash] = true;
          
        
          
        euint64 decryptedLpAmount = FHE.fromExternal(lpAmount, lpAmountProof);
          
        euint64 decryptedExpectedAmount0Out = FHE.fromExternal(expectedAmount0Out, expectedAmount0OutProof);
          
        euint64 decryptedExpectedAmount1Out = FHE.fromExternal(expectedAmount1Out, expectedAmount1OutProof);
          
        
          
        require(FHE.isInitialized(_balances[feeTo]), "FeeTo has no LP balance");
          
        require(FHE.isInitialized(_totalSupply), "Total supply not initialized");
          
        require(FHE.isInitialized(_reserve0), "Reserve0 not initialized");
          
        require(FHE.isInitialized(_reserve1), "Reserve1 not initialized");
          
        
          
        FHE.allowThis(decryptedLpAmount);
          
        FHE.allowThis(decryptedExpectedAmount0Out);
          
        FHE.allowThis(decryptedExpectedAmount1Out);
          
        FHE.allowThis(_balances[feeTo]);
          
        FHE.allowThis(_totalSupply);
          
        FHE.allowThis(_reserve0);
          
        FHE.allowThis(_reserve1);
          
        
          
        
          
        euint64 amount0Out = decryptedExpectedAmount0Out;
          
        euint64 amount1Out = decryptedExpectedAmount1Out;
          
        
          
        _balances[feeTo] = _balances[feeTo].sub(decryptedLpAmount);
          
        _totalSupply = _totalSupply.sub(decryptedLpAmount);
          
        
          
        _reserve0 = _reserve0.sub(amount0Out);
          
        _reserve1 = _reserve1.sub(amount1Out);
          
        
          
        FHE.allowTransient(amount0Out, address(this));
          
        FHE.allowTransient(amount1Out, address(this));
          
        FHE.allowTransient(amount0Out, address(token0));
          
        FHE.allowTransient(amount1Out, address(token1));
          
        
          
        token0.confidentialTransfer(feeTo, amount0Out);
          
        token1.confidentialTransfer(feeTo, amount1Out);
          
        
        emit ProtocolFeeDistributed(feeTo, 0);   
          
    }
    
    /// @notice 
    function getFeeToLPBalance() external view returns (euint64) {
          
        return _balances[feeTo];
          
    }

 
    
    /// @notice 
    function debugIsAllowed(euint64 value) external view returns (bool) {
          
        return FHE.isAllowed(value, address(this));
          
    }
    
    /// @notice 
    function debugIsSenderAllowed(euint64 value) external view returns (bool) {
          
        return FHE.isSenderAllowed(value);
          
    }
}



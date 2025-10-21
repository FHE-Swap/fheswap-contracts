// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import {FHEPair} from "./FHEPair.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/**
 * @title FHEFactory
 * @dev FHE factory contract for creating trading pairs
 * Users can interact with this factory contract to create confidential token pairs
 * This contract tracks all created pairs
 * Inspired by UniswapV2: https://docs.uniswap.org/contracts/v2/overview
 */

contract FHEFactory {
    // ============ State Variables ============
    
    // Pair implementation address for minimal proxy
    address public immutable PAIR_IMPLEMENTATION;
    
    // ============ Enums ============
    
    /**
     * @dev Token type enumeration
     * PROJECT_WRAPPED: Project-wrapped confidential tokens (wrapped via WrapperFactory)
     * OFFICIAL_FHE: Official Zama FHE tokens (for future compatibility)
     * PLAIN_ERC20: Plain ERC20 tokens (should not appear here, Router handles it first)
     */
    enum TokenType {
        PROJECT_WRAPPED,  // 0: Project-wrapped confidential token
        OFFICIAL_FHE,     // 1: Official FHE token (reserved)
        PLAIN_ERC20      // 2: Plain ERC20 token
    }
    
    // ============ Structs ============
    
    /**
     * @dev Pair token information structure
     */
    struct PairTokenInfo {
        address tokenAddress;      // Token address used in the pair (processed/wrapped)
        address originalAddress;   // Original token address (user input)
        TokenType tokenType;       // Token type
    }
    
    // ============ Constructor ============
    
    constructor(address _pairImplementation) {
        PAIR_IMPLEMENTATION = _pairImplementation;
    }
    
    // ============ State Variables ============
    
    // Basic mapping (keeps original functionality)
    // Mapping tracks created pairs: token address A => token address B => pair address
    mapping(address tokenA => mapping(address tokenB => address pair)) public getPair;

    // Track all pair addresses
    address[] public allPairs;
    
    // New: Pair token information
    mapping(address pair => PairTokenInfo info) public pairToken0Info;
    mapping(address pair => PairTokenInfo info) public pairToken1Info;
    
    // New: Query pairs by original tokens (optional, for convenience)
    mapping(address originalA => mapping(address originalB => address pair)) public getPairByOriginal;
    

    // ============ Events ============
    
    /**
     * @dev Emitted when a pair is created
     * @param token0 Token0 address
     * @param token1 Token1 address
     * @param pair Created pair address
     * @param allPairsLength Number of pairs created so far (length of allPairs array)
     */
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairsLength);
    
    /**
     * @dev Emitted when a pair is created with detailed information
     * @param pair Created pair address
     * @param token0 Processed token0 address (used in pair)
     * @param originalToken0 Original token0 address (user input)
     * @param type0 Token0 type
     * @param token1 Processed token1 address (used in pair)
     * @param originalToken1 Original token1 address (user input)
     * @param type1 Token1 type
     */
    event PairCreatedWithInfo(
        address indexed pair,
        address token0,
        address originalToken0,
        TokenType type0,
        address token1,
        address originalToken1,
        TokenType type1
    );
    
    // ============ Errors ============
    
    error FactoryError(uint8 code);
    
    // Error codes
    uint8 public constant ERROR_IDENTICAL_TOKENS = 1;
    uint8 public constant ERROR_ZERO_ADDRESS = 2;
    uint8 public constant ERROR_PAIR_EXISTS = 3;
    uint8 public constant ERROR_PAIR_CREATION_FAILED = 4;

    // ============ Core Functions ============
    
    /**
     * @dev Returns the total number of pairs created by the factory
     * @return Number of pairs created
     */
    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }
    
    /**
     * @dev Internal function to create pair and record basic mappings
     * @param token0 Token0 address
     * @param token1 Token1 address
     * @param priceScanner Price scanner address
     * @return pair Created pair address
     */
    function _createPairInternal(
        address token0,
        address token1,
        address priceScanner
    ) internal returns (address pair) {
        // Create unique salt for deterministic deployment
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        
        // Deploy new FHEPair contract using minimal proxy
        pair = Clones.cloneDeterministic(PAIR_IMPLEMENTATION, salt);
        if (pair == address(0)) revert FactoryError(ERROR_PAIR_CREATION_FAILED);
        
        // Initialize pair contract with token addresses
        FHEPair(pair).initialize(token0, token1, address(this));
        
        // Store pair address in getPair mapping (bidirectional)
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        
        // Add pair address to all pairs list
        allPairs.push(pair);
        
        // Emit PairCreated event
        emit PairCreated(token0, token1, pair, allPairs.length);
        
        return pair;
    }

    /**
     * @dev Create a new FHEPair for the given token addresses (legacy function, for backward compatibility)
     * Both tokenA and tokenB should be confidential token contracts
     * @param tokenA Address of the first token in the pair
     * @param tokenB Address of the second token in the pair
     * @param priceScanner Price scanner address for decrypting obfuscated reserves
     * @return pair Address of the newly created pair
     */
    function createPair(address tokenA, address tokenB, address priceScanner) external returns (address pair) {
        // Ensure tokens are not identical
        if (tokenA == tokenB) revert FactoryError(ERROR_IDENTICAL_TOKENS);

        // Determine token order based on address value (ensure token0 < token1)
        (address token0, address token1) = uint160(tokenA) < uint160(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        // Ensure token address is not zero
        if (token0 == address(0)) revert FactoryError(ERROR_ZERO_ADDRESS);

        // Ensure pair doesn't exist
        if (getPair[token0][token1] != address(0)) revert FactoryError(ERROR_PAIR_EXISTS);

        // Create pair using internal function
        pair = _createPairInternal(token0, token1, priceScanner);
    }
    
    /**
     * @dev Create a pair with detailed information (called by Router)
     * @param tokenA Processed tokenA address (already a confidential token)
     * @param tokenB Processed tokenB address (already a confidential token)
     * @param originalTokenA Original tokenA address (user input)
     * @param originalTokenB Original tokenB address (user input)
     * @param typeA TokenA type
     * @param typeB TokenB type
     * @param priceScanner Price scanner address
     * @return pair Address of the created pair
     */
    function createPairWithInfo(
        address tokenA,
        address tokenB,
        address originalTokenA,
        address originalTokenB,
        TokenType typeA,
        TokenType typeB,
        address priceScanner
    ) external returns (address pair) {
        // Validation
        if (tokenA == tokenB) revert FactoryError(ERROR_IDENTICAL_TOKENS);
        if (tokenA == address(0)) revert FactoryError(ERROR_ZERO_ADDRESS);
        
        // Determine token order based on address value (ensure token0 < token1)
        (address token0, address token1) = uint160(tokenA) < uint160(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);
        (address originalToken0, address originalToken1) =
         uint160(tokenA) < uint160(tokenB) ? (originalTokenA, originalTokenB) : (originalTokenB, originalTokenA);
        (TokenType type0, TokenType type1) = uint160(tokenA) < uint160(tokenB) ? (typeA, typeB) : (typeB, typeA);
        
        if (getPair[token0][token1] != address(0)) revert FactoryError(ERROR_PAIR_EXISTS);
        
        // Create pair using internal function
        pair = _createPairInternal(token0, token1, priceScanner);
        
        // Record original token mappings
        getPairByOriginal[originalToken0][originalToken1] = pair;
        getPairByOriginal[originalToken1][originalToken0] = pair;
        
        // Record token information
        pairToken0Info[pair] = PairTokenInfo({
            tokenAddress: token0,
            originalAddress: originalToken0,
            tokenType: type0
        });
        
        pairToken1Info[pair] = PairTokenInfo({
            tokenAddress: token1,
            originalAddress: originalToken1,
            tokenType: type1
        });
        
        
        // Emit additional event
        emit PairCreatedWithInfo(pair, token0, originalToken0, type0, token1, originalToken1, type1);
        
        return pair;
    }
    
    // ============ Query Functions ============
    
    /**
     * @dev Get complete information for a pair
     * @param pair Pair address
     * @return token0Info Token0 information
     * @return token1Info Token1 information
     */
    function getPairFullInfo(address pair) external view returns (
        PairTokenInfo memory token0Info,
        PairTokenInfo memory token1Info
    ) {
        return (pairToken0Info[pair], pairToken1Info[pair]);
    }
    
    /**
     * @dev Query pair by original token addresses
     * @param origToken0 Original token0 address
     * @param origToken1 Original token1 address
     * @return Pair address
     */
    function getPairByOriginalTokens(address origToken0, address origToken1) 
        external 
        view 
        returns (address) 
    {
        return getPairByOriginal[origToken0][origToken1];
    }
    
    /**
     * @dev Get token0 information for a pair
     * @param pair Pair address
     * @return Token0 information
     */
    function getToken0Info(address pair) external view returns (PairTokenInfo memory) {
        return pairToken0Info[pair];
    }
    
    /**
     * @dev Get token1 information for a pair
     * @param pair Pair address
     * @return Token1 information
     */
    function getToken1Info(address pair) external view returns (PairTokenInfo memory) {
        return pairToken1Info[pair];
    }
    
    /**
     * @dev Check if a pair has extended information
     * @param pair Pair address
     * @return True if pair has token info recorded
     */
    function hasTokenInfo(address pair) external view returns (bool) {
        return pairToken0Info[pair].tokenAddress != address(0);
    }
    
}

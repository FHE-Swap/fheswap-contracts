// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import {ERC20Wrapper} from "./ERC20Wrapper.sol";
import {IERC20Wrapper} from "./IERC20Wrapper.sol";

/**
 * @title WrapperFactory
 * @dev Factory contract for creating and managing ERC20 to ERC7984 wrapper tokens
 */
contract WrapperFactory {
    // ============ Enums ============
    
    /**
     * @dev Token type enumeration
     * PROJECT_WRAPPED: Project-wrapped confidential tokens (wrapped via WrapperFactory)
     * OFFICIAL_FHE: Official Zama FHE tokens (for future compatibility)
     * PLAIN_ERC20: Plain ERC20 tokens
     */
    enum TokenType {
        PROJECT_WRAPPED,  // 0: Project-wrapped confidential token
        OFFICIAL_FHE,     // 1: Official FHE token (reserved)
        PLAIN_ERC20      // 2: Plain ERC20 token
    }
    
    // ============ State Variables ============
    
    mapping(address => address) public originalToWrapped;
    mapping(address => address) public wrappedToOriginal;
    mapping(address => bool) public isWrappedToken;
    mapping(address => TokenType) public tokenTypes;  // Track token types
    address[] public allWrappers;
    uint256 public constant DEFAULT_RATE = 1;
    
    event WrapperCreated(
        address indexed originalToken,
        address indexed wrappedToken,
        string name,
        string symbol,
        uint256 rate
    );
    
    event WrapperUpdated(
        address indexed originalToken,
        address indexed wrappedToken,
        uint256 newRate
    );
    
    error TokenAlreadyWrapped();
    error InvalidToken();
    error WrapperNotFound();
    error Unauthorized();

    /**
     * @dev Create a wrapper token for the specified ERC20 token
     * @param originalToken Original ERC20 token address
     * @param name Wrapper token name
     * @param symbol Wrapper token symbol
     * @param rate Wrapping rate
     * @param tokenType Token type
     * @return wrappedToken Newly created wrapper token address
     */
    function createWrapper(
        address originalToken,
        string memory name,
        string memory symbol,
        uint256 rate,
        TokenType tokenType
    ) external returns (address wrappedToken) {
        if (originalToken == address(0)) revert InvalidToken();
        if (originalToWrapped[originalToken] != address(0)) revert TokenAlreadyWrapped();
        if (rate == 0) rate = DEFAULT_RATE;
        
        wrappedToken = address(new ERC20Wrapper(
            originalToken,
            name,
            symbol,
            rate
        ));
        
        originalToWrapped[originalToken] = wrappedToken;
        wrappedToOriginal[wrappedToken] = originalToken;
        isWrappedToken[wrappedToken] = true;
        tokenTypes[originalToken] = tokenType;  // Record token type
        allWrappers.push(wrappedToken);
        
        emit WrapperCreated(originalToken, wrappedToken, name, symbol, rate);
        
        return wrappedToken;
    }

    /**
     * @dev Create a wrapper token with default rate
     * @param originalToken Original ERC20 token address
     * @param name Wrapper token name
     * @param symbol Wrapper token symbol
     * @param tokenType Token type
     * @return wrappedToken Newly created wrapper token address
     */
    function createWrapperWithDefaultRate(
        address originalToken,
        string memory name,
        string memory symbol,
        TokenType tokenType
    ) external returns (address wrappedToken) {
        if (originalToken == address(0)) revert InvalidToken();
        if (originalToWrapped[originalToken] != address(0)) revert TokenAlreadyWrapped();
        
        wrappedToken = address(new ERC20Wrapper(
            originalToken,
            name,
            symbol,
            DEFAULT_RATE
        ));
        
        originalToWrapped[originalToken] = wrappedToken;
        wrappedToOriginal[wrappedToken] = originalToken;
        isWrappedToken[wrappedToken] = true;
        tokenTypes[originalToken] = tokenType;  // Record token type
        allWrappers.push(wrappedToken);
        
        emit WrapperCreated(originalToken, wrappedToken, name, symbol, DEFAULT_RATE);
        
        return wrappedToken;
    }

    /**
     * @dev Get wrapper token address for specified original token
     * @param originalToken Original token address
     * @return Wrapper token address
     */
    function getWrapper(address originalToken) external view returns (address) {
        return originalToWrapped[originalToken];
    }

    /**
     * @dev Get original token address for specified wrapper token
     * @param wrappedToken Wrapper token address
     * @return Original token address
     */
    function getOriginal(address wrappedToken) external view returns (address) {
        return wrappedToOriginal[wrappedToken];
    }

    /**
     * @dev Check if specified token is a wrapper token
     * @param token Token address
     * @return True if token is a wrapper token
     */
    function isWrapper(address token) external view returns (bool) {
        return isWrappedToken[token];
    }
    
    /**
     * @dev Get token type for a given token address
     * @param token Token address (can be original or wrapped)
     * @return Token type
     */
    function getTokenType(address token) external view returns (TokenType) {
        // If it's a wrapped token, get the original and return its type
        if (isWrappedToken[token]) {
            address original = wrappedToOriginal[token];
            return tokenTypes[original];
        }
        // If it's an original token that has been wrapped before, return its recorded type
        if (originalToWrapped[token] != address(0)) {
            return tokenTypes[token];
        }
        // If it's never been wrapped, it's a plain ERC20
        return TokenType.PLAIN_ERC20;
    }
    
    /**
     * @dev Get wrapped token info including type
     * @param wrappedToken Wrapped token address
     * @return originalToken Original token address
     * @return tokenType Token type
     */
    function getWrappedTokenInfo(address wrappedToken) external view returns (
        address originalToken,
        TokenType tokenType
    ) {
        if (!isWrappedToken[wrappedToken]) revert WrapperNotFound();
        
        originalToken = wrappedToOriginal[wrappedToken];
        tokenType = tokenTypes[originalToken];
        
        return (originalToken, tokenType);
    }
    
    /**
     * @dev Get or create wrapper token (convenience function for Router)
     * @param originalToken Original token address
     * @param name Wrapper token name
     * @param symbol Wrapper token symbol
     * @param tokenType Token type
     * @return wrappedToken Wrapper token address
     */
    function getOrCreateWrapper(
        address originalToken,
        string memory name,
        string memory symbol,
        TokenType tokenType
    ) external returns (address wrappedToken) {
        // Check if wrapper already exists
        wrappedToken = originalToWrapped[originalToken];
        if (wrappedToken != address(0)) {
            return wrappedToken;
        }
        
        // Create new wrapper
        return this.createWrapperWithDefaultRate(
            originalToken, name, symbol, tokenType);
    }

    /**
     * @dev Get total number of wrapper tokens
     * @return Number of wrapper tokens
     */
    function allWrappersLength() external view returns (uint256) {
        return allWrappers.length;
    }
    
    /**
     * @dev Get wrapper token at specified index
     * @param index Index of wrapper token
     * @return Wrapper token address
     */
    function getWrapperByIndex(uint256 index) external view returns (address) {
        require(index < allWrappers.length, "Index out of bounds");
        return allWrappers[index];
    }

    /**
     * @dev Batch query wrapper tokens for multiple original tokens
     * @param originalTokens Array of original token addresses
     * @return wrappedTokens Array of corresponding wrapper token addresses
     */
    function getWrappers(address[] calldata originalTokens) 
        external 
        view 
        returns (address[] memory wrappedTokens) 
    {
        wrappedTokens = new address[](originalTokens.length);
        for (uint256 i = 0; i < originalTokens.length; i++) {
            wrappedTokens[i] = originalToWrapped[originalTokens[i]];
        }
        return wrappedTokens;
    }

    /**
     * @dev Get detailed information for wrapper token
     * @param wrappedToken Wrapper token address
     * @return originalToken Original token address
     * @return name Wrapper token name
     * @return symbol Wrapper token symbol
     * @return rate Wrapping rate
     * @return underlyingBalance Underlying token balance
     * @return createdAt Creation timestamp
     */
    function getWrapperInfo(address wrappedToken) 
        external 
        view 
        returns (
            address originalToken,
            string memory name,
            string memory symbol,
            uint256 rate,
            uint256 underlyingBalance,
            uint256 createdAt
        ) 
    {
        if (!isWrappedToken[wrappedToken]) revert WrapperNotFound();
        
        originalToken = wrappedToOriginal[wrappedToken];
        IERC20Wrapper wrapper = IERC20Wrapper(wrappedToken);
        
        name = wrapper.name();
        symbol = wrapper.symbol();
        rate = wrapper.rate();
        underlyingBalance = wrapper.underlyingBalance();
        createdAt = block.timestamp;
    }

    /**
     * @dev Get wrapper token information for original token
     * @param originalToken Original token address
     * @return wrappedToken Wrapper token address
     * @return name Wrapper token name
     * @return symbol Wrapper token symbol
     * @return rate Wrapping rate
     * @return underlyingBalance Underlying token balance
     */
    function getOriginalTokenInfo(address originalToken) 
        external 
        view 
        returns (
            address wrappedToken,
            string memory name,
            string memory symbol,
            uint256 rate,
            uint256 underlyingBalance
        ) 
    {
        wrappedToken = originalToWrapped[originalToken];
        if (wrappedToken == address(0)) revert WrapperNotFound()    ;
        
        IERC20Wrapper wrapper = IERC20Wrapper(wrappedToken);
        
        name = wrapper.name();
        symbol = wrapper.symbol();
        rate = wrapper.rate();
        underlyingBalance = wrapper.underlyingBalance();
    }
}

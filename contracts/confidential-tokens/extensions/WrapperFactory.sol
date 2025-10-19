// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import {ERC20Wrapper} from "./ERC20Wrapper.sol";
import {IERC20Wrapper} from "./IERC20Wrapper.sol";

/**
 * @title WrapperFactory
 * @dev Factory contract for creating and managing ERC20 to ERC7984 wrapper tokens
 */
contract WrapperFactory {
    mapping(address => address) public originalToWrapped;
    mapping(address => address) public wrappedToOriginal;
    mapping(address => bool) public isWrappedToken;
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
     * @return wrappedToken Newly created wrapper token address
     */
    function createWrapper(
        address originalToken,
        string memory name,
        string memory symbol,
        uint256 rate
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
        allWrappers.push(wrappedToken);
        
        emit WrapperCreated(originalToken, wrappedToken, name, symbol, rate);
        
        return wrappedToken;
    }

    /**
     * @dev Create a wrapper token with default rate
     * @param originalToken Original ERC20 token address
     * @param name Wrapper token name
     * @param symbol Wrapper token symbol
     * @return wrappedToken Newly created wrapper token address
     */
    function createWrapperWithDefaultRate(
        address originalToken,
        string memory name,
        string memory symbol
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

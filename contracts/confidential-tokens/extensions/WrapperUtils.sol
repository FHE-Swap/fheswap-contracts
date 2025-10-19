// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import {WrapperFactory} from "./WrapperFactory.sol";
import {IERC20Wrapper} from "./IERC20Wrapper.sol";

/**
 * @title WrapperUtils
 * @dev Wrapper token utility library providing common query and operation functions
 */
library WrapperUtils {
    // Error definitions
    error InvalidWrapperFactory();
    error TokenNotWrapped();
    error InvalidTokenAddress();

    /**
     * @dev Check if a token is a wrapped token
     * @param factory Wrapper factory address
     * @param token Token address
     * @return Whether it is a wrapped token
     */
    function isWrappedToken(address factory, address token) internal view returns (bool) {
        if (factory == address(0) || token == address(0)) return false;
        return WrapperFactory(factory).isWrapper(token);
    }

    /**
     * @dev Get original token address
     * @param factory Wrapper factory address
     * @param wrappedToken Wrapped token address
     * @return Original token address
     */
    function getOriginalToken(address factory, address wrappedToken) 
        internal 
        view 
        returns (address) 
    {
        if (factory == address(0)) revert InvalidWrapperFactory();
        if (wrappedToken == address(0)) revert InvalidTokenAddress();
        
        return WrapperFactory(factory).getOriginal(wrappedToken);
    }

    /**
     * @dev Get wrapped token address
     * @param factory Wrapper factory address
     * @param originalToken Original token address
     * @return Wrapped token address
     */
    function getWrappedToken(address factory, address originalToken) 
        internal 
        view 
        returns (address) 
    {
        if (factory == address(0)) revert InvalidWrapperFactory();
        if (originalToken == address(0)) revert InvalidTokenAddress();
        
        return WrapperFactory(factory).getWrapper(originalToken);
    }

    /**
     * @dev Parse token pair and return original token addresses
     * @param factory Wrapper factory address
     * @param token0 Token0 address
     * @param token1 Token1 address
     * @return originalToken0 Original token0 address
     * @return originalToken1 Original token1 address
     */
    function resolveTokenPair(
        address factory,
        address token0,
        address token1
    ) internal view returns (address originalToken0, address originalToken1) {
        // Check if token0 is a wrapped token
        if (isWrappedToken(factory, token0)) {
            originalToken0 = getOriginalToken(factory, token0);
        } else {
            originalToken0 = token0;
        }
        
        // Check if token1 is a wrapped token
        if (isWrappedToken(factory, token1)) {
            originalToken1 = getOriginalToken(factory, token1);
        } else {
            originalToken1 = token1;
        }
    }

    /**
     * @dev Get token display name
     * @param factory Wrapper factory address
     * @param token Token address
     * @return Token display name
     */
    function getTokenDisplayName(address factory, address token) 
        internal 
        view 
        returns (string memory) 
    {
        if (isWrappedToken(factory, token)) {
            try IERC20Wrapper(token).name() returns (string memory name) {
                return string(abi.encodePacked("Wrapped ", name));
            } catch {
                return "Wrapped Token";
            }
        } else {
            // For original tokens, try to call the name() function
            try IERC20Wrapper(token).name() returns (string memory name) {
                return name;
            } catch {
                return "Unknown Token";
            }
        }
    }

    /**
     * @dev Get token display symbol
     * @param factory Wrapper factory address
     * @param token Token address
     * @return Token display symbol
     */
    function getTokenDisplaySymbol(address factory, address token) 
        internal 
        view 
        returns (string memory) 
    {
        if (isWrappedToken(factory, token)) {
            try IERC20Wrapper(token).symbol() returns (string memory symbol) {
                return string(abi.encodePacked("w", symbol));
            } catch {
                return "wTOKEN";
            }
        } else {
            // For original tokens, try to call the symbol() function
            try IERC20Wrapper(token).symbol() returns (string memory symbol) {
                return symbol;
            } catch {
                return "TOKEN";
            }
        }
    }

    /**
     * @dev Check if two tokens are different forms of the same underlying token
     * @param factory Wrapper factory address
     * @param tokenA TokenA address
     * @param tokenB TokenB address
     * @return Whether they are the same underlying token
     */
    function isSameUnderlyingToken(
        address factory,
        address tokenA,
        address tokenB
    ) internal view returns (bool) {
        if (tokenA == tokenB) return true;
        
        address originalA = isWrappedToken(factory, tokenA) 
            ? getOriginalToken(factory, tokenA) 
            : tokenA;
        
        address originalB = isWrappedToken(factory, tokenB) 
            ? getOriginalToken(factory, tokenB) 
            : tokenB;
        
        return originalA == originalB;
    }

    /**
     * @dev Get token wrapping rate
     * @param factory Wrapper factory address
     * @param token Token address
     * @return Wrapping rate, returns 1 if not a wrapped token
     */
    function getTokenRate(address factory, address token) 
        internal 
        view 
        returns (uint256) 
    {
        if (isWrappedToken(factory, token)) {
            try IERC20Wrapper(token).rate() returns (uint256 rate) {
                return rate;
            } catch {
                return 1;
            }
        }
        return 1;
    }

    /**
     * @dev Batch check if tokens are wrapped tokens
     * @param factory Wrapper factory address
     * @param tokens Array of token addresses
     * @return Boolean array indicating whether tokens are wrapped
     */
    function batchIsWrappedToken(address factory, address[] calldata tokens) 
        internal 
        view 
        returns (bool[] memory) 
    {
        bool[] memory results = new bool[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            results[i] = isWrappedToken(factory, tokens[i]);
        }
        return results;
    }

    /**
     * @dev Batch get original token addresses
     * @param factory Wrapper factory address
     * @param wrappedTokens Array of wrapped token addresses
     * @return Array of original token addresses
     */
    function batchGetOriginalTokens(address factory, address[] calldata wrappedTokens) 
        internal 
        view 
        returns (address[] memory) 
    {
        address[] memory originalTokens = new address[](wrappedTokens.length);
        for (uint256 i = 0; i < wrappedTokens.length; i++) {
            originalTokens[i] = getOriginalToken(factory, wrappedTokens[i]);
        }
        return originalTokens;
    }
}

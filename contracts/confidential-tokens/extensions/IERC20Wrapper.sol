// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import {euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

/**
 * @title IERC20Wrapper
 * @dev Interface for ERC20 to ERC7984 wrapper contracts
 */
interface IERC20Wrapper {
    /**
     * @dev Get the name of the token
     * @return Token name
     */
    function name() external view returns (string memory);
    
    /**
     * @dev Get the symbol of the token
     * @return Token symbol
     */
    function symbol() external view returns (string memory);
    
    /**
     * @dev Get the decimals of the token
     * @return Token decimals
     */
    function decimals() external view returns (uint8);
    
    /**
     * @dev Emitted when ERC20 tokens are wrapped into confidential tokens
     * @param user User address
     * @param amount Amount of ERC20 tokens wrapped
     * @param wrappedAmount Amount of confidential tokens minted
     */
    event Wrapped(address indexed user, uint256 amount, euint64 wrappedAmount);
    
    /**
     * @dev Emitted when confidential tokens are unwrapped into ERC20 tokens
     * @param user User address
     * @param amount Amount of confidential tokens unwrapped
     * @param unwrappedAmount Amount of ERC20 tokens returned
     */
    event Unwrapped(address indexed user, euint64 amount, uint256 unwrappedAmount);

    /**
     * @dev Get the underlying ERC20 token address
     * @return Underlying token address
     */
    function underlying() external view returns (address);
    
    /**
     * @dev Get the wrapping rate
     * @return Wrapping rate
     */
    function rate() external view returns (uint256);
    
    /**
     * @dev Wrap ERC20 tokens into confidential tokens
     * @param to Recipient address
     * @param amount Amount of ERC20 tokens to wrap
     */
    function wrap(address to, uint256 amount) external;
    
    /**
     * @dev Unwrap confidential tokens into ERC20 tokens
     * @param from Sender address
     * @param to Recipient address
     * @param amount Amount of confidential tokens to unwrap
     */
    function unwrap(address from, address to, euint64 amount) external;
    
    /**
     * @dev Unwrap confidential tokens with input proof
     * @param from Sender address
     * @param to Recipient address
     * @param encryptedAmount Encrypted amount to unwrap
     * @param inputProof Input proof for verification
     */
    function unwrap(
        address from,
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external;
    
    /**
     * @dev Finalize unwrap request callback
     * @param requestID Request ID
     * @param amount Decrypted amount
     * @param signatures Decryption signatures
     */
    function finalizeUnwrap(uint256 requestID, uint64 amount, bytes[] memory signatures) external;
    
    /**
     * @dev Get the underlying token balance held by this contract
     * @return Balance of underlying tokens
     */
    function underlyingBalance() external view returns (uint256);
}

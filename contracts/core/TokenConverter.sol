// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {IERC7984} from "../confidential-tokens/base/IERC7984.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Wrapper} from "../confidential-tokens/extensions/IERC20Wrapper.sol";
import {WrapperFactory} from "../confidential-tokens/extensions/WrapperFactory.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenConverter
 * @dev Handles conversion between official FHE tokens and project wrapped tokens (reserved architecture)
 *
 * ⚠️ Important Notes:
 * - Zama has not yet released official FHE tokens
 * - This contract reserves architecture for future expansion
 * - Core logic marked as TODO, to be implemented when official FHE is released
 *
 * Expected workflow (future):
 * 1. Receive official FHE tokens
 * 2. Call official wrapper's unwrap (async decryption)
 * 3. After unwrap completion, wrap into project wrapped tokens
 * 4. Call target contract (usually FHEPair)
 *
 * Design principles:
 * - Keep Router simple (thin interface)
 * - Handle async logic for official FHE conversion
 * - Support whitelist management for official FHE tokens
 */
contract TokenConverter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @dev Router address, only Router can initiate conversion
    address public immutable ROUTER;

    /// @dev WrapperFactory address, used to create/get project wrapped tokens
    address public immutable WRAPPER_FACTORY;

    /// @dev Official FHE token → underlying ERC20 token mapping
    mapping(address officialFHE => address underlyingERC20) public officialFHEToUnderlying;

    /// @dev Official FHE token → official wrapper contract mapping
    mapping(address officialFHE => address officialWrapper) public officialFHEToWrapper;

    /// @dev Pending conversion requests
    mapping(uint256 requestID => ConversionRequest request) public pendingConversions;

    /// @dev Request ID counter
    uint256 private nextRequestID;

    // ============ Structs ============

    /**
     * @dev Conversion request structure
     */
    struct ConversionRequest {
        address user;              // User who initiated conversion
        address officialToken;     // Official FHE token address
        address underlyingToken;   // Underlying ERC20 address
        euint64 encryptedAmount;   // Encrypted amount
        address targetContract;    // Target contract to call after conversion (Pair)
        bytes targetCalldata;      // Calldata for target call
        uint256 timestamp;         // Request timestamp
        bool completed;            // Whether completed
    }

    // ============ Events ============

    event OfficialFHERegistered(
        address indexed officialFHE,
        address indexed underlying,
        address indexed officialWrapper,
        uint256 timestamp
    );

    event OfficialFHERemoved(
        address indexed officialFHE,
        uint256 timestamp
    );

    event ConversionRequested(
        uint256 indexed requestID,
        address indexed user,
        address indexed officialFHE,
        address targetContract,
        uint256 timestamp
    );

    event ConversionCompleted(
        uint256 indexed requestID,
        address indexed user,
        address projectWrapped,
        uint256 wrappedAmount,
        uint256 timestamp
    );

    event ConversionFailed(
        uint256 indexed requestID,
        string reason,
        uint256 timestamp
    );

    // ============ Errors ============

    error OnlyRouter();
    error OfficialFHENotRegistered(address token);
    error OfficialFHENotAvailable();  // Official FHE not yet released
    error ConversionAlreadyCompleted(uint256 requestID);
    error ConversionNotFound(uint256 requestID);
    error InvalidAddress();
    error InvalidAmount();
    error TargetCallFailed();
    error ArrayLengthMismatch();
    error AlreadyRegistered(address token);
    error NotRegistered(address token);

    // ============ Modifiers ============

    modifier onlyRouter() {
        if (msg.sender != ROUTER) revert OnlyRouter();
        _;
    }

    // ============ Constructor ============

    /**
     * @dev Constructor
     * @param _router Router contract address
     * @param _wrapperFactory WrapperFactory contract address
     */
    constructor(address _router, address _wrapperFactory) Ownable(msg.sender) {
        if (_router == address(0) || _wrapperFactory == address(0)) {
            revert InvalidAddress();
        }
        ROUTER = _router;
        WRAPPER_FACTORY = _wrapperFactory;
    }

    // ============ Admin Functions ============

    /**
     * @dev Register official FHE token information
     * @param officialFHE Official FHE token address
     * @param underlying Underlying ERC20 token address
     * @param officialWrapper Official wrapper contract address
     *
     * Requirements:
     * - All addresses must be non-zero
     * - Token must not be already registered
     */
    function registerOfficialFHE(
        address officialFHE,
        address underlying,
        address officialWrapper
    ) external onlyOwner {
        if (officialFHE == address(0) || underlying == address(0) || officialWrapper == address(0)) {
            revert InvalidAddress();
        }

        if (officialFHEToUnderlying[officialFHE] != address(0)) {
            revert AlreadyRegistered(officialFHE);
        }

        officialFHEToUnderlying[officialFHE] = underlying;
        officialFHEToWrapper[officialFHE] = officialWrapper;

        emit OfficialFHERegistered(officialFHE, underlying, officialWrapper, block.timestamp);
    }

    /**
     * @dev Batch register official FHE tokens
     * @param officialFHEs Official FHE token address array
     * @param underlyings Underlying ERC20 token address array
     * @param officialWrappers Official wrapper contract address array
     *
     * Requirements:
     * - All arrays must have the same length
     * - All addresses must be non-zero
     * - Tokens must not be already registered
     */
    function registerOfficialFHEBatch(
        address[] calldata officialFHEs,
        address[] calldata underlyings,
        address[] calldata officialWrappers
    ) external onlyOwner {
        uint256 length = officialFHEs.length;
        if (length != underlyings.length || length != officialWrappers.length) {
            revert ArrayLengthMismatch();
        }

        if (length == 0) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < length; i++) {
            if (officialFHEs[i] == address(0) || underlyings[i] == address(0) || officialWrappers[i] == address(0)) {
                revert InvalidAddress();
            }

            if (officialFHEToUnderlying[officialFHEs[i]] != address(0)) {
                revert AlreadyRegistered(officialFHEs[i]);
            }

            officialFHEToUnderlying[officialFHEs[i]] = underlyings[i];
            officialFHEToWrapper[officialFHEs[i]] = officialWrappers[i];

            emit OfficialFHERegistered(officialFHEs[i], underlyings[i], officialWrappers[i], block.timestamp);
        }
    }

    /**
     * @dev Remove official FHE token registration
     * @param officialFHE Official FHE token address
     *
     * Requirements:
     * - Token must be registered
     */
    function removeOfficialFHE(address officialFHE) external onlyOwner {
        if (officialFHEToUnderlying[officialFHE] == address(0)) {
            revert NotRegistered(officialFHE);
        }

        delete officialFHEToUnderlying[officialFHE];
        delete officialFHEToWrapper[officialFHE];

        emit OfficialFHERemoved(officialFHE, block.timestamp);
    }

    // ============ Core Functions ============

    /**
     * @dev Convert official FHE to project wrapped tokens and call target contract
     * @param officialFHEToken Official FHE token address
     * @param amount Encrypted amount
     * @param targetContract Target contract to call after conversion (usually Pair)
     * @param targetCalldata Calldata for target call
     * @return requestID Conversion request ID
     *
     * ⚠️ TODO: To be implemented when Zama official FHE tokens are released
     * Need to complete:
     * 1. Official wrapper interface integration
     * 2. Async unwrap process
     * 3. Callback mechanism (off-chain monitoring or contract callback)
     */
    function convertAndCall(
        address officialFHEToken,
        euint64 amount,
        address targetContract,
        bytes calldata targetCalldata
    ) external onlyRouter returns (uint256 requestID) {
        // Official FHE currently unavailable
        revert OfficialFHENotAvailable();

        // TODO: Future implementation logic:
        // 1. Verify official FHE is registered
        // 2. Receive official FHE from Router
        // 3. Call official wrapper.unwrap (async)
        // 4. Record pending request
        // 5. Wait for off-chain service to monitor unwrap completion event
        // 6. Off-chain service calls finalizeConversion
    }

    /**
     * @dev Complete conversion (callback after unwrap completion)
     * @param requestID Conversion request ID
     * @param underlyingAmount Decrypted underlying token amount
     *
     * ⚠️ TODO: To be implemented when Zama official FHE tokens are released
     * Expected calling method:
     * - Off-chain service monitors official wrapper's UnwrapCompleted event
     * - Off-chain service calls this function to complete conversion
     *
     * Need to implement:
     * 1. Access control (only allow authorized off-chain services to call)
     * 2. Wrap into project tokens
     * 3. Call target contract (Pair)
     * 4. Error handling and refund mechanism
     */
    function finalizeConversion(
        uint256 requestID,
        uint256 underlyingAmount
    ) external {
        // Official FHE currently unavailable
        revert OfficialFHENotAvailable();

        // TODO: Future implementation logic:
        // 1. Verify request exists
        // 2. Verify caller permissions
        // 3. Wrap into project wrapped tokens
        // 4. Set target contract as operator
        // 5. Call target contract
        // 6. Mark as completed
    }

    // ============ View Functions ============

    /**
     * @dev Check if official FHE is registered
     * @param officialFHE Official FHE token address
     * @return Whether registered
     */
    function isOfficialFHERegistered(address officialFHE) external view returns (bool) {
        return officialFHEToUnderlying[officialFHE] != address(0);
    }

    /**
     * @dev Get conversion request information
     * @param requestID Request ID
     * @return request Conversion request details
     */
    function getConversionRequest(uint256 requestID) external view returns (ConversionRequest memory) {
        return pendingConversions[requestID];
    }

    /**
     * @dev Get complete information for official FHE
     * @param officialFHE Official FHE token address
     * @return underlying Underlying ERC20 address
     * @return officialWrapper Official wrapper address
     */
    function getOfficialFHEInfo(address officialFHE) external view returns (
        address underlying,
        address officialWrapper
    ) {
        return (
            officialFHEToUnderlying[officialFHE],
            officialFHEToWrapper[officialFHE]
        );
    }

    // ============ Emergency Functions ============

    /**
     * @dev Emergency token withdrawal (owner only)
     * @param token Token address
     * @param to Recipient address
     * @param amount Amount to withdraw (0 means withdraw all balance)
     *
     * Security:
     * - Only owner can call
     * - Reentrancy protection
     * - Uses SafeERC20 for safe token transfers
     */
    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (token == address(0)) revert InvalidAddress();
        if (to == address(0)) revert InvalidAddress();

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert InvalidAmount();

        uint256 withdrawAmount = (amount == 0) ? balance : amount;
        if (withdrawAmount > balance) revert InvalidAmount();

        IERC20(token).safeTransfer(to, withdrawAmount);
    }

    /**
     * @dev Get contract token balance
     * @param token Token address
     * @return balance Token balance
     */
    function getTokenBalance(address token) external view returns (uint256 balance) {
        if (token == address(0)) revert InvalidAddress();
        return IERC20(token).balanceOf(address(this));
    }
}

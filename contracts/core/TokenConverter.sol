// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {IERC7984} from "../confidential-tokens/base/IERC7984.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Wrapper} from "../confidential-tokens/extensions/IERC20Wrapper.sol";
import {WrapperFactory} from "../confidential-tokens/extensions/WrapperFactory.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

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
contract TokenConverter is Ownable {
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
        address indexed officialWrapper
    );

    event OfficialFHERemoved(address indexed officialFHE);

    event ConversionRequested(
        uint256 indexed requestID,
        address indexed user,
        address indexed officialFHE,
        address targetContract
    );

    event ConversionCompleted(
        uint256 indexed requestID,
        address indexed user,
        address projectWrapped,
        uint256 wrappedAmount
    );

    event ConversionFailed(
        uint256 indexed requestID,
        string reason
    );

    // ============ Errors ============

    error OnlyRouter();
    error OfficialFHENotRegistered(address token);
    error OfficialFHENotAvailable();  // Official FHE not yet released
    error ConversionAlreadyCompleted(uint256 requestID);
    error ConversionNotFound(uint256 requestID);
    error InvalidAddress();
    error TargetCallFailed();
    error ArrayLengthMismatch();

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
     */
    function registerOfficialFHE(
        address officialFHE,
        address underlying,
        address officialWrapper
    ) external onlyOwner {
        if (officialFHE == address(0) || underlying == address(0) || officialWrapper == address(0)) {
            revert InvalidAddress();
        }

        officialFHEToUnderlying[officialFHE] = underlying;
        officialFHEToWrapper[officialFHE] = officialWrapper;

        emit OfficialFHERegistered(officialFHE, underlying, officialWrapper);
    }

    /**
     * @dev Batch register official FHE tokens
     * @param officialFHEs Official FHE token address array
     * @param underlyings Underlying ERC20 token address array
     * @param officialWrappers Official wrapper contract address array
     */
    function registerOfficialFHEBatch(
        address[] calldata officialFHEs,
        address[] calldata underlyings,
        address[] calldata officialWrappers
    ) external onlyOwner {
        if (
            officialFHEs.length != underlyings.length ||
            underlyings.length != officialWrappers.length
        ) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < officialFHEs.length; i++) {
            if (officialFHEs[i] == address(0) || underlyings[i] == address(0) || officialWrappers[i] == address(0)) {
                revert InvalidAddress();
            }

            officialFHEToUnderlying[officialFHEs[i]] = underlyings[i];
            officialFHEToWrapper[officialFHEs[i]] = officialWrappers[i];

            emit OfficialFHERegistered(officialFHEs[i], underlyings[i], officialWrappers[i]);
        }
    }

    /**
     * @dev Remove official FHE token registration
     * @param officialFHE Official FHE token address
     */
    function removeOfficialFHE(address officialFHE) external onlyOwner {
        delete officialFHEToUnderlying[officialFHE];
        delete officialFHEToWrapper[officialFHE];

        emit OfficialFHERemoved(officialFHE);
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
     * @param amount Amount
     */
    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        IERC20(token).transfer(to, amount);
    }
}

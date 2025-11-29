// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {WrapperFactory} from "../confidential-tokens/extensions/WrapperFactory.sol";
import {IERC20Wrapper} from "../confidential-tokens/extensions/IERC20Wrapper.sol";
import {FHEFactory} from "./FHEFactory.sol";
import {FHEPair} from "./FHEPair.sol";
import {FHEPairLib} from "./FHEPairLib.sol";
import {IERC7984} from "../confidential-tokens/base/IERC7984.sol";
import {FHE, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

/**
 * @title FHERouter
 * @dev Router contract for FHESwap (Confidential Automated Market Maker)
 *
 * Core functionality:
 * - Provides unified interface for plaintext and encrypted versions
 * - Handles ERC20 wrapping to ERC7984
 * - Manages pair creation and liquidity
 * - Supports official FHE tokens (reserved)
 * - Rejects external ERC7984 tokens
 */
contract FHERouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @dev WrapperFactory contract address
    address public immutable WRAPPER_FACTORY;

    /// @dev FHEFactory contract address
    address public immutable FHE_FACTORY;

    /// @dev TokenConverter contract address (for official FHE conversion)
    address public immutable TOKEN_CONVERTER;

    /// @dev Recommended deadline buffer in seconds (5 minutes, for reference only)
    /// @notice This is not enforced by the contract, users can set any valid future deadline
    uint256 public deadlineBuffer = 300;

    /// @dev Emergency pause flag
    bool public paused = false;

    /// @dev Official FHE tokens whitelist (reserved for future)
    mapping(address => bool) public officialFHETokens;

    // ============ Enums ============

    enum TokenType {
        PROJECT_WRAPPED, // 0: Project wrapped ERC7984
        OFFICIAL_FHE, // 1: Zama official FHE (reserved)
        PLAIN_ERC20 // 2: Plain ERC20
    }

    enum RefundType {
        LIQUIDITY_ADD, // 0: Add liquidity refund
        LIQUIDITY_REMOVE, // 1: Remove liquidity refund
        SWAP // 2: Swap refund
    }

    enum OperationType {
        ADD_LIQUIDITY, // 0: Add liquidity
        REMOVE_LIQUIDITY, // 1: Remove liquidity
        SWAP // 2: Swap
    }

    // ============ Events ============

    event LiquidityAdded(
        address indexed user,
        address indexed pair,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity,
        uint256 requestID,
        uint256 timestamp
    );

    event LiquidityRemoved(
        address indexed user,
        address indexed pair,
        uint256 liquidity,
        uint256 amount0,
        uint256 amount1,
        uint256 requestID,
        uint256 timestamp
    );

    event TokensSwapped(
        address indexed user,
        address indexed pair,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 requestID,
        uint256 timestamp
    );

    event TokenWrapped(
        address indexed user,
        address indexed originalToken,
        address indexed wrappedToken,
        uint256 amount
    );

    event OfficialFHETokenUpdated(address indexed token, bool isOfficial);

    event TokensRescued(address indexed token, address indexed to, uint256 amount, uint256 timestamp);

    event PausedStateChanged(bool indexed newState, uint256 timestamp);

    event DeadlineBufferUpdated(uint256 oldBuffer, uint256 newBuffer, uint256 timestamp);

    // ============ Errors ============

    error InvalidToken();
    error InvalidAmount();
    error InvalidDeadline();
    error PairNotFound();
    error RouterPaused();
    error PairCreationFailed();
    error UnsupportedToken(address token); // Unsupported external ERC7984
    error MustUseEncryptedVersion(); // Must use encrypted version
    error OnlyProjectWrappedToken(); // Only project wrapped tokens supported
    error OfficialFHENotSupported(); // Official FHE not supported yet
    error OperatorNotSet(address token, address user, address operator);
    error InvalidRefundType();
    error InvalidOutputToken();
    error InsufficientLiquidity();
    error NoRescueNeeded();
    error InvalidSlippage();
    error ExcessiveSlippage();
    error AmountTooSmall();
    error AmountTooLarge();
    error InvalidBuffer();

    // ============ Constructor ============

    constructor(address _wrapperFactory, address _fheFactory, address _tokenConverter) Ownable(msg.sender) {
        if (_wrapperFactory == address(0)) revert InvalidToken();
        if (_fheFactory == address(0)) revert InvalidToken();
        if (_tokenConverter == address(0)) revert InvalidToken();
        if (_wrapperFactory == _fheFactory || _wrapperFactory == _tokenConverter || _fheFactory == _tokenConverter) {
            revert InvalidToken();
        }

        WRAPPER_FACTORY = _wrapperFactory;
        FHE_FACTORY = _fheFactory;
        TOKEN_CONVERTER = _tokenConverter;
    }

    // ============ Modifiers ============

    modifier notPaused() {
        if (paused) revert RouterPaused();
        _;
    }

    modifier validDeadline(uint256 deadline) {
        if (block.timestamp >= deadline) revert InvalidDeadline();
        _;
    }

    // ============================================
    // ============ Core Functions ============
    // ============================================

    /**
     * @dev Add liquidity (plaintext version) - for ERC20 tokens
     * @param tokenA Token A address
     * @param tokenB Token B address
     * @param amountA Token A amount (plaintext)
     * @param amountB Token B amount (plaintext)
     * @param to LP token recipient address
     * @param deadline Deadline timestamp
     * @return requestID Request ID
     *
     * User prerequisites:
     * - tokenA.approve(router, amountA)
     * - tokenB.approve(router, amountB)
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        address to,
        uint256 deadline
    ) external nonReentrant notPaused validDeadline(deadline) returns (uint256 requestID) {
        // Step 1: Validate inputs
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (tokenA == tokenB) revert InvalidToken();
        if (amountA == 0 || amountB == 0) revert InvalidAmount();
        if (amountA > type(uint64).max || amountB > type(uint64).max) revert AmountTooLarge();
        if (to == address(0)) revert InvalidToken();
        if (to == address(this)) revert InvalidToken();

        // Step 2: Strictly verify token types (must both be PLAIN_ERC20)
        TokenType typeA = _determineTokenType(tokenA);
        TokenType typeB = _determineTokenType(tokenB);

        if (typeA != TokenType.PLAIN_ERC20 || typeB != TokenType.PLAIN_ERC20) {
            revert MustUseEncryptedVersion();
        }

        // Step 3: Process tokenA (ERC20 → wrap)
        address wrappedTokenA = wrapToken(tokenA, amountA);

        // Step 4: Process tokenB (ERC20 → wrap)
        address wrappedTokenB = wrapToken(tokenB, amountB);

        // Step 5: Ensure Pair exists
        address pair = _ensurePairExists(wrappedTokenA, wrappedTokenB, tokenA, tokenB);

        // Step 6: Router sets Pair as operator for both wrapped tokens
        // This allows Pair to call confidentialTransferFrom(Router, Pair, amount)
        IERC7984(wrappedTokenA).setOperator(pair, uint48(deadline));
        IERC7984(wrappedTokenB).setOperator(pair, uint48(deadline));

        // Step 7: Convert plaintext to encrypted
        // In Mock environment, FHE.asEuint64() generates deterministic pseudo-handles
        // This internally does: bytes32 handle = keccak256(abi.encodePacked("asEuint64", amountA));
        euint64 encryptedAmountA = FHE.asEuint64(uint64(amountA));
        euint64 encryptedAmountB = FHE.asEuint64(uint64(amountB));

        // Determine token order in pair (token0 < token1)
        (euint64 amount0, euint64 amount1) = uint160(wrappedTokenA) < uint160(wrappedTokenB)
            ? (encryptedAmountA, encryptedAmountB)
            : (encryptedAmountB, encryptedAmountA);

        // Step 8: Allow Pair to access encrypted amounts
        FHE.allowTransient(amount0, pair);
        FHE.allowTransient(amount1, pair);

        // Step 9: Call Pair.addLiquidity
        // Note: Pair will transfer tokens from Router and mint LP tokens directly to 'to'
        FHEPair(pair).addLiquidity(amount0, amount1, to, deadline);

        // Emit detailed event
        emit LiquidityAdded(
            msg.sender,
            pair,
            wrappedTokenA,
            wrappedTokenB,
            amountA,
            amountB,
            0, // liquidity amount (not tracked in sync mode)
            0, // requestID
            block.timestamp
        );

        return 0; // Synchronous operation, no requestID needed
    }

    /**
     * @dev Add liquidity (encrypted version) - for ERC7984 tokens
     * @param tokenA Token A address
     * @param tokenB Token B address
     * @param encryptedAmountA Encrypted token A amount
     * @param encryptedAmountB Encrypted token B amount
     * @param inputProof Input proof
     * @param to LP token recipient address
     * @param deadline Deadline timestamp
     * @return requestID Request ID
     *
     * User prerequisites:
     * - tokenA.setOperator(router, deadline)  // if ERC7984
     * - tokenB.setOperator(router, deadline)  // if ERC7984
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        externalEuint64 encryptedAmountA,
        externalEuint64 encryptedAmountB,
        bytes calldata inputProof,
        address to,
        uint256 deadline
    ) external nonReentrant notPaused validDeadline(deadline) returns (uint256 requestID) {
        // Step 1: Validate inputs
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (tokenA == tokenB) revert InvalidToken();
        if (to == address(0)) revert InvalidToken();
        if (to == address(this)) revert InvalidToken();

        // Step 2: Import encrypted data
        euint64 amountA = FHE.fromExternal(encryptedAmountA, inputProof);
        euint64 amountB = FHE.fromExternal(encryptedAmountB, inputProof);

        // Step 3: Determine token types
        TokenType typeA = _determineTokenType(tokenA);
        TokenType typeB = _determineTokenType(tokenB);

        // Step 4: Process tokenA based on type
        address processedTokenA;
        euint64 processedAmountA;

        if (typeA == TokenType.PROJECT_WRAPPED) {
            // 4.1: PROJECT_WRAPPED → use directly
            processedTokenA = tokenA;
            processedAmountA = amountA;
            // Check user has set Router as operator
            _checkOperatorPermission(msg.sender, tokenA);
        } else if (typeA == TokenType.OFFICIAL_FHE) {
            // 4.2: OFFICIAL_FHE → not supported yet, will delegate to TokenConverter
            revert OfficialFHENotSupported();
            // TODO: Implement official FHE conversion via TokenConverter
        } else {
            // 4.3: PLAIN_ERC20 → must use plaintext version
            revert MustUseEncryptedVersion();
        }

        // Step 5: Process tokenB (same logic as tokenA)
        address processedTokenB;
        euint64 processedAmountB;

        if (typeB == TokenType.PROJECT_WRAPPED) {
            processedTokenB = tokenB;
            processedAmountB = amountB;
            _checkOperatorPermission(msg.sender, tokenB);
        } else if (typeB == TokenType.OFFICIAL_FHE) {
            revert OfficialFHENotSupported();
            // TODO: Implement official FHE conversion via TokenConverter
        } else {
            revert MustUseEncryptedVersion();
        }

        // Step 6: Synchronous flow (both tokens are PROJECT_WRAPPED)

        // 6.1: Ensure Pair exists
        address pair = _ensurePairExists(processedTokenA, processedTokenB, tokenA, tokenB);

        // 6.2: Transfer tokens from user to Router first
        // (Pair will later pull from Router)
        IERC7984(processedTokenA).confidentialTransferFrom(msg.sender, address(this), processedAmountA);
        IERC7984(processedTokenB).confidentialTransferFrom(msg.sender, address(this), processedAmountB);

        // 6.3: Router sets Pair as operator
        IERC7984(processedTokenA).setOperator(pair, uint48(deadline));
        IERC7984(processedTokenB).setOperator(pair, uint48(deadline));

        // Determine token order in pair (token0 < token1)
        (euint64 amount0, euint64 amount1) = uint160(processedTokenA) < uint160(processedTokenB)
            ? (processedAmountA, processedAmountB)
            : (processedAmountB, processedAmountA);

        // 6.4: Allow Pair to access encrypted amounts
        FHE.allowTransient(amount0, pair);
        FHE.allowTransient(amount1, pair);

        // 6.5: Call Pair.addLiquidity
        // Pair will mint LP tokens directly to 'to'
        FHEPair(pair).addLiquidity(amount0, amount1, to, deadline);

        emit LiquidityAdded(
            msg.sender,
            pair,
            processedTokenA,
            processedTokenB,
            0, // amount0 (encrypted, cannot emit)
            0, // amount1 (encrypted, cannot emit)
            0, // liquidity (not tracked)
            0, // requestID
            block.timestamp
        );

        return 0; // Synchronous operation, no requestID needed

        // Step 7: Asynchronous flow for official FHE conversion
        // TODO: Implement when official FHE tokens are available
        // Will delegate to TokenConverter.convertAndCall()
    }

    /**
     * @dev Remove liquidity (encrypted version only) - LP tokens are always ERC7984
     * @param tokenA Token A address
     * @param tokenB Token B address
     * @param encryptedLpAmount Encrypted LP token amount
     * @param inputProof Input proof
     * @param to Token recipient address
     * @param deadline Deadline timestamp
     * @return requestID Request ID
     *
     * User prerequisites:
     * - pair.setOperator(router, deadline)
     */
    function removeLiquidity(
        address tokenA,
        address tokenB,
        externalEuint64 encryptedLpAmount,
        bytes calldata inputProof,
        address to,
        uint256 deadline
    ) external nonReentrant notPaused validDeadline(deadline) returns (uint256 requestID) {
        // Step 1: Validate inputs
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (tokenA == tokenB) revert InvalidToken();
        if (to == address(0)) revert InvalidToken();
        if (to == address(this)) revert InvalidToken();

        // Step 2: Import encrypted LP amount
        euint64 lpAmount = FHE.fromExternal(encryptedLpAmount, inputProof);

        // Step 3: Get processed token addresses
        address processedTokenA = _getProcessedTokenAddress(tokenA);
        address processedTokenB = _getProcessedTokenAddress(tokenB);

        // Step 4: Get Pair address
        address pair = FHEFactory(FHE_FACTORY).getPair(processedTokenA, processedTokenB);
        if (pair == address(0)) revert PairNotFound();

        // Step 5: Check user has set Router as operator for the Pair (LP token)
        _checkOperatorPermission(msg.sender, pair);

        // Step 6: Transfer LP tokens from user to Router
        // Pair will later pull LP tokens from Router
        IERC7984(pair).confidentialTransferFrom(msg.sender, address(this), lpAmount);

        // Step 7: Router sets Pair as operator
        // This allows Pair to call confidentialTransferFrom(Router, Pair, lpAmount)
        IERC7984(pair).setOperator(pair, uint48(deadline));

        // Step 8: Allow Pair to access encrypted LP amount
        FHE.allowTransient(lpAmount, pair);

        // Step 9: Call Pair.removeLiquidity
        // Pair will pull LP tokens from Router and send tokenA/tokenB to 'to' address
        FHEPair(pair).removeLiquidity(lpAmount, to, deadline);

        emit LiquidityRemoved(
            msg.sender,
            pair,
            0, // liquidity (encrypted, cannot emit)
            0, // amount0 (encrypted)
            0, // amount1 (encrypted)
            0, // requestID
            block.timestamp
        );

        return 0; // Synchronous operation, no requestID needed
    }

    /**
     * @dev Token swap (plaintext version) - for ERC20 input
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount (plaintext)
     * @param slippageBps Slippage tolerance in basis points (e.g., 50 = 0.5%)
     * @param to Recipient address: receives output tokens on success, or refund on slippage failure
     * @param deadline Deadline timestamp
     * @return requestID Request ID
     *
     * User prerequisites:
     * - tokenIn.approve(router, amountIn)
     */
    function swapTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint16 slippageBps,
        address to,
        uint256 deadline
    ) external nonReentrant notPaused validDeadline(deadline) returns (uint256 requestID) {
        // Step 1: Validate inputs
        if (tokenIn == address(0) || tokenOut == address(0)) revert InvalidToken();
        if (tokenIn == tokenOut) revert InvalidToken();
        if (amountIn == 0) revert InvalidAmount();
        if (amountIn > type(uint64).max) revert AmountTooLarge();
        if (slippageBps > 10000) revert ExcessiveSlippage();
        if (to == address(0)) revert InvalidToken();
        if (to == address(this)) revert InvalidToken();

        // Step 2: Strictly verify tokenIn type (must be PLAIN_ERC20)
        TokenType typeIn = _determineTokenType(tokenIn);
        if (typeIn != TokenType.PLAIN_ERC20) {
            revert MustUseEncryptedVersion();
        }

        // Step 3: Process tokenIn (ERC20 → wrap)
        address wrappedTokenIn = wrapToken(tokenIn, amountIn);

        // Step 4: Get and verify tokenOut address (should be wrapped or FHE)
        address processedTokenOut = _getProcessedTokenAddress(tokenOut);
        if (processedTokenOut == address(0)) revert InvalidOutputToken();

        // Step 5: Verify Pair exists
        address pair = FHEFactory(FHE_FACTORY).getPair(wrappedTokenIn, processedTokenOut);
        if (pair == address(0)) revert PairNotFound();

        // Step 6: Router sets Pair as operator for input token
        IERC7984(wrappedTokenIn).setOperator(pair, uint48(deadline));

        // Step 7: Determine token order and swap direction
        address token0 = FHEPair(pair).token0Address();
        address token1 = FHEPair(pair).token1Address();

        // Verify tokens are in the pair
        if (
            !((wrappedTokenIn == token0 && processedTokenOut == token1) ||
                (wrappedTokenIn == token1 && processedTokenOut == token0))
        ) {
            revert InvalidToken();
        }

        // Step 8: Convert plaintext to encrypted
        euint64 encryptedAmountIn = FHE.asEuint64(uint64(amountIn));

        // Determine swap direction
        bool isToken0In = (wrappedTokenIn == token0);

        // Determine amount0In and amount1In based on which token is being swapped
        euint64 amount0In;
        euint64 amount1In;

        if (isToken0In) {
            // Swapping token0 → token1
            amount0In = encryptedAmountIn;
            amount1In = FHE.asEuint64(0);
        } else {
            // Swapping token1 → token0
            amount0In = FHE.asEuint64(0);
            amount1In = encryptedAmountIn;
        }

        // Step 9: Calculate expected output parts for slippage protection
        // Get current reserves from pair
        (euint64 reserve0, euint64 reserve1) = FHEPair(pair).getReserves();

        // Calculate expected output using FHEPairLib
        (euint128 expectedDivUpperPart, euint128 expectedDivLowerPart) = FHEPairLib.calculateExpectedOutParts(
            encryptedAmountIn,
            isToken0In,
            reserve0,
            reserve1
        );

        // Step 10: Allow Pair to access encrypted data
        FHE.allowTransient(amount0In, pair);
        FHE.allowTransient(amount1In, pair);
        FHE.allowTransient(expectedDivUpperPart, pair);
        FHE.allowTransient(expectedDivLowerPart, pair);

        // Step 11: Call Pair.swapTokens with slippage protection
        FHEPair(pair).swapTokens(
            amount0In,
            amount1In,
            expectedDivUpperPart,
            expectedDivLowerPart,
            slippageBps,
            isToken0In,
            to,
            deadline
        );

        // Emit detailed event
        emit TokensSwapped(
            msg.sender,
            pair,
            wrappedTokenIn,
            processedTokenOut,
            amountIn,
            0, // amountOut (encrypted, cannot emit)
            0, // requestID
            block.timestamp
        );

        return 0; // Synchronous operation, no requestID needed
    }

    /**
     * @dev Token swap (encrypted version) - for ERC7984 input
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param encryptedAmountIn Encrypted input amount
     * @param inputProof Input proof
     * @param slippageBps Slippage tolerance in basis points (e.g., 50 = 0.5%)
     * @param to Recipient address: receives output tokens on success, or refund on slippage failure
     * @param deadline Deadline timestamp
     * @return requestID Request ID
     *
     * User prerequisites:
     * - tokenIn.setOperator(router, deadline)  // if ERC7984
     */
    function swapTokens(
        address tokenIn,
        address tokenOut,
        externalEuint64 encryptedAmountIn,
        bytes calldata inputProof,
        uint16 slippageBps,
        address to,
        uint256 deadline
    ) external nonReentrant notPaused validDeadline(deadline) returns (uint256 requestID) {
        // Step 1: Validate inputs
        if (tokenIn == address(0) || tokenOut == address(0)) revert InvalidToken();
        if (tokenIn == tokenOut) revert InvalidToken();
        if (slippageBps > 10000) revert ExcessiveSlippage();
        if (to == address(0)) revert InvalidToken();
        if (to == address(this)) revert InvalidToken();

        // Step 2: Import encrypted data
        euint64 amountIn = FHE.fromExternal(encryptedAmountIn, inputProof);

        // Step 3: Determine token types
        TokenType typeIn = _determineTokenType(tokenIn);
        // Note: typeOut is determined later when processing tokenOut

        // Step 4: Process tokenIn based on type
        address processedTokenIn;
        euint64 processedAmountIn;

        if (typeIn == TokenType.PROJECT_WRAPPED) {
            // 4.1: PROJECT_WRAPPED → use directly
            processedTokenIn = tokenIn;
            processedAmountIn = amountIn;
            // Check user has set Router as operator
            _checkOperatorPermission(msg.sender, tokenIn);
        } else if (typeIn == TokenType.OFFICIAL_FHE) {
            // 4.2: OFFICIAL_FHE → not supported yet
            revert OfficialFHENotSupported();
            // TODO: Implement official FHE conversion via TokenConverter
        } else {
            // 4.3: PLAIN_ERC20 → must use plaintext version
            revert MustUseEncryptedVersion();
        }

        // Step 5: Synchronous flow (tokenIn is PROJECT_WRAPPED)

        // 5.1: Get and verify tokenOut address
        address processedTokenOut = _getProcessedTokenAddress(tokenOut);
        if (processedTokenOut == address(0)) revert InvalidOutputToken();

        // 5.2: Verify Pair exists
        address pair = FHEFactory(FHE_FACTORY).getPair(processedTokenIn, processedTokenOut);
        if (pair == address(0)) revert PairNotFound();

        // 5.3: Transfer input token from user to Router, then set Pair as operator
        IERC7984(processedTokenIn).confidentialTransferFrom(msg.sender, address(this), processedAmountIn);
        IERC7984(processedTokenIn).setOperator(pair, uint48(deadline));

        // 5.4: Verify tokens are in the pair and determine direction
        address token0 = FHEPair(pair).token0Address();
        address token1 = FHEPair(pair).token1Address();

        if (
            !((processedTokenIn == token0 && processedTokenOut == token1) ||
                (processedTokenIn == token1 && processedTokenOut == token0))
        ) {
            revert InvalidToken();
        }

        // 5.5: Determine swap direction
        bool isToken0In = (processedTokenIn == token0);

        // 5.6: Construct amount0In and amount1In based on swap direction
        euint64 amount0In;
        euint64 amount1In;

        if (isToken0In) {
            // Swapping token0 → token1
            amount0In = processedAmountIn;
            amount1In = FHE.asEuint64(0);
        } else {
            // Swapping token1 → token0
            amount0In = FHE.asEuint64(0);
            amount1In = processedAmountIn;
        }

        // 5.7: Calculate expected output parts for slippage protection
        // Get current reserves from pair
        (euint64 reserve0, euint64 reserve1) = FHEPair(pair).getReserves();

        // Calculate expected output using FHEPairLib
        (euint128 expectedDivUpperPart, euint128 expectedDivLowerPart) = FHEPairLib.calculateExpectedOutParts(
            processedAmountIn,
            isToken0In,
            reserve0,
            reserve1
        );

        // 5.8: Allow Pair to access encrypted data
        FHE.allowTransient(amount0In, pair);
        FHE.allowTransient(amount1In, pair);
        FHE.allowTransient(expectedDivUpperPart, pair);
        FHE.allowTransient(expectedDivLowerPart, pair);

        // 5.9: Call Pair.swapTokens with slippage protection
        FHEPair(pair).swapTokens(
            amount0In,
            amount1In,
            expectedDivUpperPart,
            expectedDivLowerPart,
            slippageBps,
            isToken0In,
            to,
            deadline
        );

        emit TokensSwapped(
            msg.sender,
            pair,
            processedTokenIn,
            processedTokenOut,
            0, // amountIn (encrypted, cannot emit)
            0, // amountOut (encrypted, cannot emit)
            0, // requestID
            block.timestamp
        );

        return 0; // Synchronous operation, no requestID needed

        // Step 6: Asynchronous flow for official FHE conversion
        // TODO: Implement when official FHE tokens are available
        // Will delegate to TokenConverter.convertAndCall()
    }

    /**
     * @dev Wrap ERC20 tokens to project ERC7984 (direct wrapper call)
     * @param originalToken Original ERC20 token address (e.g., USDC address)
     * @param amount Amount to wrap
     * @param to ERC7984 recipient address
     * @return wrappedToken Address of the wrapped token
     *
     * User prerequisites:
     * - originalToken.approve(router, amount)
     *
     * Process:
     * - Router gets wrapper address
     * - Router approves wrapper to spend ERC20
     * - Router calls wrapper.wrap() directly
     * - Wrapper handles the wrapping and sends tokens to 'to'
     */
    function wrapToken(
        address originalToken,
        uint256 amount,
        address to
    ) external nonReentrant notPaused returns (address wrappedToken) {
        // Step 1: Validate inputs
        if (originalToken == address(0) || to == address(0)) revert InvalidToken();
        if (to == address(this)) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();
        if (amount > type(uint64).max) revert AmountTooLarge();

        // Step 2: Get or create wrapper
        string memory name;
        string memory symbol;

        try IERC20Metadata(originalToken).name() returns (string memory n) {
            name = n;
        } catch {
            name = "Unknown";
        }

        try IERC20Metadata(originalToken).symbol() returns (string memory s) {
            symbol = s;
        } catch {
            symbol = "UNK";
        }

        wrappedToken = WrapperFactory(WRAPPER_FACTORY).getOrCreateWrapper(
            originalToken,
            string(abi.encodePacked("Confidential ", name)),
            string(abi.encodePacked("c", symbol)),
            WrapperFactory.TokenType.PLAIN_ERC20
        );

        // Step 3: Transfer ERC20 from user to Router first
        IERC20(originalToken).safeTransferFrom(msg.sender, address(this), amount);

        // Step 4: Approve wrapper to spend ERC20 from Router
        IERC20(originalToken).approve(wrappedToken, amount);

        // Step 5: Call wrapper.wrap() directly - wrapper will transfer from Router
        IERC20Wrapper(wrappedToken).wrap(to, amount);

        emit TokenWrapped(msg.sender, originalToken, wrappedToken, amount);

        return wrappedToken;
    }

    // ============================================
    // Note: For unwrapping tokens, users should directly call the wrapper contract
    //
    // Steps:
    // 1. Get wrapper address: wrapper = WrapperFactory(WRAPPER_FACTORY).getWrapper(originalToken)
    // 2. Call wrapper.unwrap(from, to, encryptedAmount, inputProof)
    //    - No setOperator needed when msg.sender == from
    //    - Wrapper will decrypt and send ERC20 to 'to' address
    //
    // Rationale: Direct unwrapping is simpler, cheaper (no intermediate transfer),
    // and doesn't require additional operator permissions.
    // ============================================

    /**
     * @dev Request refund (for failed or timed out async operations)
     * @param tokenA Token A address (original address, not processed)
     * @param tokenB Token B address (original address, not processed)
     * @param requestID Request ID of pending operation
     * @param refundType Refund type (LIQUIDITY_ADD, LIQUIDITY_REMOVE, SWAP)
     *
     * Use cases:
     * - addLiquidity returned requestID decryption timeout/failure
     * - removeLiquidity returned requestID decryption timeout/failure
     * - swapTokens returned requestID decryption timeout/failure
     *
     * Notes:
     * - Each requestID can only be refunded once
     * - Can only refund after decryption request, before callback execution
     * - Refunded tokens are in ERC7984 format
     */
    function requestRefund(
        address tokenA,
        address tokenB,
        uint256 requestID,
        RefundType refundType
    ) external nonReentrant {
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (tokenA == tokenB) revert InvalidToken();

        // Step 1: Get processed token addresses
        address processedTokenA = _getProcessedTokenAddress(tokenA);
        address processedTokenB = _getProcessedTokenAddress(tokenB);

        // Step 2: Get Pair address
        address pair = FHEFactory(FHE_FACTORY).getPair(processedTokenA, processedTokenB);
        if (pair == address(0)) revert PairNotFound();

        // Step 3: Call appropriate FHEPair refund function based on refundType
        if (refundType == RefundType.LIQUIDITY_ADD) {
            // User receives previously sent token0 and token1
            FHEPair(pair).requestLiquidityAddingRefund(requestID);
        } else if (refundType == RefundType.LIQUIDITY_REMOVE) {
            // User receives previously burned LP tokens
            FHEPair(pair).requestLiquidityRemovalRefund(requestID);
        } else if (refundType == RefundType.SWAP) {
            // User receives previously sent input tokens
            FHEPair(pair).requestSwapRefund(requestID);
        } else {
            revert InvalidRefundType();
        }

        // Note: FHEPair functions will handle the actual token transfers and validations
        // FHEPair checks:
        // - refund data exists (FHE.isInitialized)
        // - msg.sender matches the original user
        // - refund hasn't been claimed yet
    }

    /**
     * @dev Validate user permissions completeness (for frontend calls)
     * @param user User address
     * @param tokenA Token A address
     * @param tokenB Token B address
     * @param operationType Operation type (ADD_LIQUIDITY, REMOVE_LIQUIDITY, SWAP)
     * @return isValid Whether permissions are complete
     * @return missingPermissions Array of missing permission descriptions
     *
     * Use cases:
     * - Frontend checks user permission settings before executing operations
     * - Provides detailed error information to guide users
     */
    function validateUserPermissions(
        address user,
        address tokenA,
        address tokenB,
        OperationType operationType
    ) external view returns (bool isValid, string[] memory missingPermissions) {
        if (user == address(0)) revert InvalidToken();
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (tokenA == tokenB) revert InvalidToken();

        // Initialize missing permissions array (max 3 items)
        string[] memory tempMissing = new string[](3);
        uint256 missingCount = 0;

        if (operationType == OperationType.ADD_LIQUIDITY) {
            // Check if tokenA and tokenB are ERC7984
            TokenType typeA = _determineTokenType(tokenA);
            TokenType typeB = _determineTokenType(tokenB);

            if (typeA == TokenType.PROJECT_WRAPPED) {
                if (!IERC7984(tokenA).isOperator(user, address(this))) {
                    tempMissing[missingCount] = string(abi.encodePacked("tokenA.setOperator(router, deadline)"));
                    missingCount++;
                }
            }

            if (typeB == TokenType.PROJECT_WRAPPED) {
                if (!IERC7984(tokenB).isOperator(user, address(this))) {
                    tempMissing[missingCount] = string(abi.encodePacked("tokenB.setOperator(router, deadline)"));
                    missingCount++;
                }
            }
        } else if (operationType == OperationType.REMOVE_LIQUIDITY) {
            // Need to check Pair (LP token) operator permission
            address processedTokenA = _getProcessedTokenAddress(tokenA);
            address processedTokenB = _getProcessedTokenAddress(tokenB);
            address pair = FHEFactory(FHE_FACTORY).getPair(processedTokenA, processedTokenB);

            if (pair != address(0)) {
                if (!IERC7984(pair).isOperator(user, address(this))) {
                    tempMissing[missingCount] = string(abi.encodePacked("pair.setOperator(router, deadline)"));
                    missingCount++;
                }
            } else {
                tempMissing[missingCount] = "Pair does not exist";
                missingCount++;
            }
        } else if (operationType == OperationType.SWAP) {
            // Check if tokenIn is ERC7984
            TokenType typeIn = _determineTokenType(tokenA); // tokenA is tokenIn for swap

            if (typeIn == TokenType.PROJECT_WRAPPED) {
                if (!IERC7984(tokenA).isOperator(user, address(this))) {
                    tempMissing[missingCount] = string(abi.encodePacked("tokenIn.setOperator(router, deadline)"));
                    missingCount++;
                }
            }
        }

        // Create properly sized result array
        missingPermissions = new string[](missingCount);
        for (uint256 i = 0; i < missingCount; i++) {
            missingPermissions[i] = tempMissing[i];
        }

        isValid = (missingCount == 0);
    }

    // ============================================
    // ============ Helper Functions ============
    // ============================================

    /**
     * @dev Determine token type (with external ERC7984 protection)
     */
    function _determineTokenType(address token) internal view returns (TokenType) {
        if (WrapperFactory(WRAPPER_FACTORY).isWrapper(token)) {
            return TokenType.PROJECT_WRAPPED;
        }

        if (officialFHETokens[token]) {
            return TokenType.OFFICIAL_FHE;
        }

        if (_isERC7984(token)) {
            revert UnsupportedToken(token);
        }

        return TokenType.PLAIN_ERC20;
    }

    /**
     * @dev Check if token is ERC7984
     */
    function _isERC7984(address token) internal view returns (bool) {
        try IERC7984(token).isOperator(address(0), address(0)) returns (bool) {
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @dev Wrap ERC20 to project ERC7984
     */
    function wrapToken(address token, uint256 amount) internal returns (address wrappedToken) {
        if (amount == 0) revert InvalidAmount();
        if (amount > type(uint64).max) revert AmountTooLarge();

        // 1. Transfer ERC20 from user to Router
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // 2. Get or create wrapper
        string memory name;
        string memory symbol;

        try IERC20Metadata(token).name() returns (string memory n) {
            name = n;
        } catch {
            name = "Unknown";
        }

        try IERC20Metadata(token).symbol() returns (string memory s) {
            symbol = s;
        } catch {
            symbol = "UNK";
        }

        wrappedToken = WrapperFactory(WRAPPER_FACTORY).getOrCreateWrapper(
            token,
            string(abi.encodePacked("Confidential ", name)),
            string(abi.encodePacked("c", symbol)),
            WrapperFactory.TokenType.PLAIN_ERC20
        );

        // 3. Approve and wrap
        IERC20(token).approve(wrappedToken, amount);
        IERC20Wrapper(wrappedToken).wrap(address(this), amount);

        emit TokenWrapped(msg.sender, token, wrappedToken, amount);

        return wrappedToken;
    }

    /**
     * @dev Check user permissions
     */
    function _checkOperatorPermission(address user, address token) internal view {
        if (!IERC7984(token).isOperator(user, address(this))) {
            revert OperatorNotSet(token, user, address(this));
        }
    }

    /**
     * @dev Calculate square root (Babylonian method)
     */
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        
        return y;
    }

    /**
     * @dev Get processed token address (query only, no wrapping)
     */
    function _getProcessedTokenAddress(address token) internal view returns (address) {
        if (WrapperFactory(WRAPPER_FACTORY).isWrapper(token)) {
            return token;
        }

        if (officialFHETokens[token]) {
            revert OfficialFHENotSupported();
        }

        if (_isERC7984(token)) {
            revert UnsupportedToken(token);
        }

        return WrapperFactory(WRAPPER_FACTORY).getWrapper(token);
    }

    /**
     * @dev Ensure Pair exists, create if not
     */
    function _ensurePairExists(
        address processedTokenA,
        address processedTokenB,
        address originalTokenA,
        address originalTokenB
    ) internal returns (address pairAddress) {
        // 1. Query existing pair from Factory
        pairAddress = FHEFactory(FHE_FACTORY).getPair(processedTokenA, processedTokenB);

        // 2. If pair exists, return it
        if (pairAddress != address(0)) {
            return pairAddress;
        }

        // 3. Pair doesn't exist, need to create it
        // Determine token types
        TokenType typeA = _determineTokenType(originalTokenA);
        TokenType typeB = _determineTokenType(originalTokenB);

        // Convert Router's TokenType to Factory's TokenType (same enum values)
        FHEFactory.TokenType factoryTypeA = FHEFactory.TokenType(uint8(typeA));
        FHEFactory.TokenType factoryTypeB = FHEFactory.TokenType(uint8(typeB));

        // Create pair with type information
        pairAddress = FHEFactory(FHE_FACTORY).createPairWithInfo(
            processedTokenA,
            processedTokenB,
            originalTokenA,
            originalTokenB,
            factoryTypeA,
            factoryTypeB
        );

        if (pairAddress == address(0)) {
            revert PairCreationFailed();
        }

        return pairAddress;
    }

    // ============================================
    // ============ Quote Functions ============
    // ============================================

    /**
     * @dev Get estimated output amount for a swap (plaintext version)
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount
     * @return amountOut Estimated output amount
     * @return priceImpact Price impact in basis points (e.g., 50 = 0.5%)
     *
     * Note: This is an approximation based on obfuscated reserves (±7% variance)
     */
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut, uint256 priceImpact) {
        if (tokenIn == address(0) || tokenOut == address(0)) revert InvalidToken();
        if (tokenIn == tokenOut) revert InvalidToken();
        if (amountIn == 0) revert InvalidAmount();
        if (amountIn > type(uint64).max) revert AmountTooLarge();

        // Get processed token addresses
        address processedTokenIn = _getProcessedTokenAddress(tokenIn);
        address processedTokenOut = _getProcessedTokenAddress(tokenOut);

        // Get pair
        address pair = FHEFactory(FHE_FACTORY).getPair(processedTokenIn, processedTokenOut);
        if (pair == address(0)) revert PairNotFound();

        // Get obfuscated reserves
        (uint256 reserve0Obf, uint256 reserve1Obf) = FHEPair(pair).getObfuscatedReserves();

        if (reserve0Obf == 0 || reserve1Obf == 0) revert InsufficientLiquidity();
        if (reserve0Obf > type(uint128).max || reserve1Obf > type(uint128).max) revert AmountTooLarge();

        // Determine which reserve is for input token
        address token0 = FHEPair(pair).token0Address();
        bool isToken0In = (processedTokenIn == token0);

        uint256 reserveIn = isToken0In ? reserve0Obf : reserve1Obf;
        uint256 reserveOut = isToken0In ? reserve1Obf : reserve0Obf;

        // Calculate output using constant product formula with 0.3% fee
        // amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        if (denominator == 0) revert InsufficientLiquidity();
        amountOut = numerator / denominator;

        // Calculate price impact: (amountOut / reserveOut) * 10000
        if (reserveOut == 0) revert InsufficientLiquidity();
        priceImpact = (amountOut * 10000) / reserveOut;

        return (amountOut, priceImpact);
    }

    /**
     * @dev Get estimated liquidity amount for adding liquidity
     * @param tokenA Token A address
     * @param tokenB Token B address
     * @param amountA Token A amount
     * @param amountB Token B amount
     * @return liquidity Estimated LP tokens to be minted
     * @return actualAmountA Actual amount of token A that will be used
     * @return actualAmountB Actual amount of token B that will be used
     *
     * Note: For existing pools, amounts may be adjusted to match current ratio
     */
    function quoteLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external view returns (uint256 liquidity, uint256 actualAmountA, uint256 actualAmountB) {
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (tokenA == tokenB) revert InvalidToken();
        if (amountA == 0 || amountB == 0) revert InvalidAmount();
        if (amountA > type(uint64).max || amountB > type(uint64).max) revert AmountTooLarge();

        // Get processed token addresses
        address processedTokenA = _getProcessedTokenAddress(tokenA);
        address processedTokenB = _getProcessedTokenAddress(tokenB);

        // Get pair
        address pair = FHEFactory(FHE_FACTORY).getPair(processedTokenA, processedTokenB);
        
        if (pair == address(0)) {
            // New pair: all liquidity will be used
            actualAmountA = amountA;
            actualAmountB = amountB;
            // For new pair: liquidity ≈ sqrt(amountA * amountB) - MINIMUM_LIQUIDITY
            liquidity = _sqrt(amountA * amountB);
            if (liquidity > 1000) {
                liquidity -= 1000; // MINIMUM_LIQUIDITY
            }
        } else {
            // Existing pair: get obfuscated reserves
            (uint256 reserve0Obf, uint256 reserve1Obf) = FHEPair(pair).getObfuscatedReserves();
            
            if (reserve0Obf == 0 || reserve1Obf == 0) revert InsufficientLiquidity();

            // Determine token order
            address token0 = FHEPair(pair).token0Address();
            (uint256 reserveA, uint256 reserveB) = (tokenA < tokenB)
                ? (reserve0Obf, reserve1Obf)
                : (reserve1Obf, reserve0Obf);

            // Calculate optimal amounts based on current ratio
            if (reserveA == 0) revert InsufficientLiquidity();
            uint256 amountBOptimal = (amountA * reserveB) / reserveA;

            if (amountBOptimal <= amountB) {
                actualAmountA = amountA;
                actualAmountB = amountBOptimal;
            } else {
                if (reserveB == 0) revert InsufficientLiquidity();
                uint256 amountAOptimal = (amountB * reserveA) / reserveB;
                actualAmountA = amountAOptimal;
                actualAmountB = amountB;
            }

            // Estimate LP tokens: min(amountA/reserveA, amountB/reserveB) * totalSupply
            uint256 totalSupply = IERC7984(pair).totalSupply();
            if (reserveA == 0 || reserveB == 0) revert InsufficientLiquidity();
            uint256 liquidityA = (actualAmountA * totalSupply) / reserveA;
            uint256 liquidityB = (actualAmountB * totalSupply) / reserveB;
            liquidity = liquidityA < liquidityB ? liquidityA : liquidityB;
        }

        return (liquidity, actualAmountA, actualAmountB);
    }

    /**
     * @dev Get estimated token amounts for removing liquidity
     * @param tokenA Token A address
     * @param tokenB Token B address
     * @param liquidity LP token amount to burn
     * @return amountA Estimated token A amount to receive
     * @return amountB Estimated token B amount to receive
     *
     * Note: Based on obfuscated reserves (±7% variance)
     */
    function quoteRemoveLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity
    ) external view returns (uint256 amountA, uint256 amountB) {
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (tokenA == tokenB) revert InvalidToken();
        if (liquidity == 0) revert InvalidAmount();
        if (liquidity > type(uint64).max) revert AmountTooLarge();

        // Get processed token addresses
        address processedTokenA = _getProcessedTokenAddress(tokenA);
        address processedTokenB = _getProcessedTokenAddress(tokenB);

        // Get pair
        address pair = FHEFactory(FHE_FACTORY).getPair(processedTokenA, processedTokenB);
        if (pair == address(0)) revert PairNotFound();

        // Get obfuscated reserves and total supply
        (uint256 reserve0Obf, uint256 reserve1Obf) = FHEPair(pair).getObfuscatedReserves();
        uint256 totalSupply = IERC7984(pair).totalSupply();

        if (totalSupply == 0) revert InsufficientLiquidity();

        // Determine token order
        address token0 = FHEPair(pair).token0Address();
        (uint256 reserveA, uint256 reserveB) = (processedTokenA == token0)
            ? (reserve0Obf, reserve1Obf)
            : (reserve1Obf, reserve0Obf);

        // Calculate proportional amounts: amount = (liquidity * reserve) / totalSupply
        if (totalSupply == 0) revert InsufficientLiquidity();
        amountA = (liquidity * reserveA) / totalSupply;
        amountB = (liquidity * reserveB) / totalSupply;

        return (amountA, amountB);
    }

    // ============================================
    // ============ Emergency Functions ============
    // ============================================

    /**
     * @dev Rescue tokens accidentally sent to Router
     * @param token Token address to rescue
     * @param to Recipient address
     * @param amount Amount to rescue
     *
     * Security: Only owner can call, prevents rescuing tokens during active operations
     */
    function rescueTokens(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (token == address(0)) revert InvalidToken();
        if (to == address(0)) revert InvalidToken();
        if (to == address(this)) revert InvalidToken();
        if (amount == 0) revert NoRescueNeeded();

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert NoRescueNeeded();
        if (amount > balance) revert InvalidAmount();

        // Transfer tokens to recipient
        IERC20(token).safeTransfer(to, amount);

        emit TokensRescued(token, to, amount, block.timestamp);
    }

    /**
     * @dev Rescue ERC7984 tokens accidentally sent to Router
     * @param token ERC7984 token address
     * @param to Recipient address
     * @param amount Amount to rescue (plaintext for owner operations)
     *
     * Note: For ERC7984 tokens, owner must know the balance
     */
    function rescueConfidentialTokens(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (token == address(0)) revert InvalidToken();
        if (to == address(0)) revert InvalidToken();
        if (to == address(this)) revert InvalidToken();
        if (amount == 0) revert NoRescueNeeded();
        if (amount > type(uint64).max) revert AmountTooLarge();

        // Convert to encrypted amount
        euint64 encryptedAmount = FHE.asEuint64(uint64(amount));
        
        // Set recipient as operator temporarily
        IERC7984(token).setOperator(address(this), uint48(block.timestamp + 300));

        // Transfer confidential tokens
        IERC7984(token).confidentialTransfer(to, encryptedAmount);

        emit TokensRescued(token, to, amount, block.timestamp);
    }

    // ============================================
    // ============ Admin Functions ============
    // ============================================

    /**
     * @dev Set official FHE token status
     */
    function setOfficialFHEToken(address token, bool isOfficial) external onlyOwner {
        if (token == address(0)) revert InvalidToken();
        if (token == address(this)) revert InvalidToken();
        officialFHETokens[token] = isOfficial;
        emit OfficialFHETokenUpdated(token, isOfficial);
    }

    /**
     * @dev Set recommended deadline buffer (for reference only, not enforced)
     * @param newBuffer New recommended buffer time (seconds)
     * @notice This value is only used for frontend suggestions, contract does not enforce deadline to be ahead of this time
     */
    function setDeadlineBuffer(uint256 newBuffer) external onlyOwner {
        if (newBuffer > 86400) revert InvalidBuffer();
        uint256 oldBuffer = deadlineBuffer;
        deadlineBuffer = newBuffer;
        emit DeadlineBufferUpdated(oldBuffer, newBuffer, block.timestamp);
    }

    /**
     * @dev Emergency pause
     */
    function setPaused(bool _paused) external onlyOwner {
        if (paused == _paused) return;
        paused = _paused;
        emit PausedStateChanged(_paused, block.timestamp);
    }

    // ============================================
    // ============ View Functions ============
    // ============================================

    /**
     * @dev Get Pair address
     */
    function getPair(address tokenA, address tokenB) external view returns (address pair) {
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (tokenA == tokenB) revert InvalidToken();

        address processedTokenA = _getProcessedTokenAddress(tokenA);
        address processedTokenB = _getProcessedTokenAddress(tokenB);

        return FHEFactory(FHE_FACTORY).getPair(processedTokenA, processedTokenB);
    }

    /**
     * @dev Get wrapped token address for an ERC20 token
     */
    function getWrappedToken(address originalToken) external view returns (address wrappedToken) {
        if (originalToken == address(0)) revert InvalidToken();
        return WrapperFactory(WRAPPER_FACTORY).getWrapper(originalToken);
    }

    /**
     * @dev Check if a token is a project wrapped token
     */
    function isProjectWrappedToken(address token) external view returns (bool) {
        if (token == address(0)) revert InvalidToken();
        return WrapperFactory(WRAPPER_FACTORY).isWrapper(token);
    }

    /**
     * @dev Get pair info including reserves and total supply
     */
    function getPairInfo(
        address tokenA,
        address tokenB
    ) external view returns (
        address pair,
        uint256 reserve0,
        uint256 reserve1,
        uint256 totalSupply,
        address token0,
        address token1
    ) {
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (tokenA == tokenB) revert InvalidToken();

        address processedTokenA = _getProcessedTokenAddress(tokenA);
        address processedTokenB = _getProcessedTokenAddress(tokenB);

        pair = FHEFactory(FHE_FACTORY).getPair(processedTokenA, processedTokenB);

        if (pair == address(0)) {
            return (address(0), 0, 0, 0, address(0), address(0));
        }

        token0 = FHEPair(pair).token0Address();
        token1 = FHEPair(pair).token1Address();
        (reserve0, reserve1) = FHEPair(pair).getObfuscatedReserves();
        totalSupply = IERC7984(pair).totalSupply();
    }

    /**
     * @dev Batch get pair addresses for multiple token pairs
     */
    function getBatchPairs(
        address[] calldata tokensA,
        address[] calldata tokensB
    ) external view returns (address[] memory pairs) {
        if (tokensA.length != tokensB.length) revert InvalidAmount();
        if (tokensA.length == 0) revert InvalidAmount();
        if (tokensA.length > 100) revert AmountTooLarge();

        pairs = new address[](tokensA.length);

        for (uint256 i = 0; i < tokensA.length; i++) {
            if (tokensA[i] == address(0) || tokensB[i] == address(0)) {
                pairs[i] = address(0);
                continue;
            }
            if (tokensA[i] == tokensB[i]) {
                pairs[i] = address(0);
                continue;
            }

            try this.getPair(tokensA[i], tokensB[i]) returns (address pair) {
                pairs[i] = pair;
            } catch {
                pairs[i] = address(0);
            }
        }
    }

    /**
     * @dev Get router state for health checks
     */
    function getRouterState() external view returns (
        bool isPaused,
        uint256 currentDeadlineBuffer,
        address wrapperFactory,
        address fheFactory,
        address tokenConverter
    ) {
        isPaused = paused;
        currentDeadlineBuffer = deadlineBuffer;
        wrapperFactory = WRAPPER_FACTORY;
        fheFactory = FHE_FACTORY;
        tokenConverter = TOKEN_CONVERTER;
    }

    /**
     * @dev Calculate minimum deadline for current block
     */
    function getMinimumDeadline() external view returns (uint256) {
        return block.timestamp + deadlineBuffer;
    }

    /**
     * @dev Validate deadline is acceptable
     */
    function isValidDeadline(uint256 deadline) external view returns (bool) {
        return deadline > block.timestamp;
    }

    /**
     * @dev Get token type information
     */
    function getTokenTypeInfo(address token) external view returns (
        TokenType tokenType,
        bool isValid,
        address processedAddress
    ) {
        if (token == address(0)) {
            return (TokenType.PLAIN_ERC20, false, address(0));
        }

        try this.determineTokenType(token) returns (TokenType tType) {
            tokenType = tType;
            isValid = true;

            if (tokenType == TokenType.PROJECT_WRAPPED) {
                processedAddress = token;
            } else if (tokenType == TokenType.PLAIN_ERC20) {
                processedAddress = WrapperFactory(WRAPPER_FACTORY).getWrapper(token);
            } else {
                processedAddress = address(0);
            }
        } catch {
            return (TokenType.PLAIN_ERC20, false, address(0));
        }
    }

    /**
     * @dev Public version of determineTokenType for external calls
     */
    function determineTokenType(address token) external view returns (TokenType) {
        if (WrapperFactory(WRAPPER_FACTORY).isWrapper(token)) {
            return TokenType.PROJECT_WRAPPED;
        }

        if (officialFHETokens[token]) {
            return TokenType.OFFICIAL_FHE;
        }

        if (_isERC7984(token)) {
            revert UnsupportedToken(token);
        }

        return TokenType.PLAIN_ERC20;
    }
}
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
 * @dev Router contract for CAMM (Confidential Automated Market Maker)
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
        PROJECT_WRAPPED,  // 0: Project wrapped ERC7984
        OFFICIAL_FHE,     // 1: Zama official FHE (reserved)
        PLAIN_ERC20      // 2: Plain ERC20
    }

    enum RefundType {
        LIQUIDITY_ADD,    // 0: Add liquidity refund
        LIQUIDITY_REMOVE, // 1: Remove liquidity refund
        SWAP             // 2: Swap refund
    }

    enum OperationType {
        ADD_LIQUIDITY,    // 0: Add liquidity
        REMOVE_LIQUIDITY, // 1: Remove liquidity
        SWAP             // 2: Swap
    }

    // ============ Events ============

    event LiquidityAdded(
        address indexed user,
        address indexed pair,
        uint256 requestID
    );

    event LiquidityRemoved(
        address indexed user,
        address indexed pair,
        uint256 requestID
    );

    event TokensSwapped(
        address indexed user,
        address indexed pair,
        uint256 requestID
    );

    event TokenWrapped(
        address indexed user,
        address indexed originalToken,
        address indexed wrappedToken,
        uint256 amount
    );

    event TokenUnwrapped(
        address indexed user,
        address indexed wrappedToken,
        address indexed to,
        uint256 requestID
    );

    event OfficialFHETokenUpdated(
        address indexed token,
        bool isOfficial
    );

    // ============ Errors ============

    error InvalidToken();
    error InvalidAmount();
    error InvalidDeadline();
    error PairNotFound();
    error RouterPaused();
    error PairCreationFailed();
    error UnsupportedToken(address token);              // Unsupported external ERC7984
    error MustUseEncryptedVersion();                    // Must use encrypted version
    error OnlyProjectWrappedToken();                    // Only project wrapped tokens supported
    error OfficialFHENotSupported();                    // Official FHE not supported yet
    error OperatorNotSet(address token, address user, address operator);
    error InvalidRefundType();                          // Invalid refund type
    error WrapperNotFound();                            // Original token has no wrapper
    error InvalidOutputToken();                         // Invalid output token

    // ============ Constructor ============

    constructor(
        address _wrapperFactory,
        address _fheFactory,
        address _tokenConverter
    ) Ownable(msg.sender) {
        if (_wrapperFactory == address(0)) revert InvalidToken();
        if (_fheFactory == address(0)) revert InvalidToken();
        if (_tokenConverter == address(0)) revert InvalidToken();

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
        if (to == address(0)) revert InvalidToken();

        // Step 2: Strictly verify token types (must both be PLAIN_ERC20)
        TokenType typeA = determineTokenType(tokenA);
        TokenType typeB = determineTokenType(tokenB);

        if (typeA != TokenType.PLAIN_ERC20 || typeB != TokenType.PLAIN_ERC20) {
            revert MustUseEncryptedVersion();
        }

        // Step 3: Process tokenA (ERC20 → wrap)
        address wrappedTokenA = wrapToken(tokenA, amountA);

        // Step 4: Process tokenB (ERC20 → wrap)
        address wrappedTokenB = wrapToken(tokenB, amountB);

        // Step 5: Ensure Pair exists
        address pair = _ensurePairExists(
            wrappedTokenA,
            wrappedTokenB,
            tokenA,
            tokenB
        );

        // Step 6: Router sets Pair as operator for both wrapped tokens
        // This allows Pair to call confidentialTransferFrom(Router, Pair, amount)
        IERC7984(wrappedTokenA).setOperator(pair, uint48(deadline));
        IERC7984(wrappedTokenB).setOperator(pair, uint48(deadline));

        // Step 7: Convert plaintext to encrypted
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

        // Emit event
        emit LiquidityAdded(msg.sender, pair, 0);  // requestID is 0 for synchronous operations

        return 0;  // Synchronous operation, no requestID needed
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

        // Step 2: Import encrypted data
        euint64 amountA = FHE.fromExternal(encryptedAmountA, inputProof);
        euint64 amountB = FHE.fromExternal(encryptedAmountB, inputProof);

        // Step 3: Determine token types
        TokenType typeA = determineTokenType(tokenA);
        TokenType typeB = determineTokenType(tokenB);

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
        address pair = _ensurePairExists(
            processedTokenA,
            processedTokenB,
            tokenA,
            tokenB
        );

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

        emit LiquidityAdded(msg.sender, pair, 0);

        return 0;  // Synchronous operation, no requestID needed

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

        emit LiquidityRemoved(msg.sender, pair, 0);

        return 0;  // Synchronous operation, no requestID needed
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
        if (to == address(0)) revert InvalidToken();

        // Step 2: Strictly verify tokenIn type (must be PLAIN_ERC20)
        TokenType typeIn = determineTokenType(tokenIn);
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
        if (!((wrappedTokenIn == token0 && processedTokenOut == token1) ||
              (wrappedTokenIn == token1 && processedTokenOut == token0))) {
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
        (euint128 expectedDivUpperPart, euint128 expectedDivLowerPart) =
            FHEPairLib.calculateExpectedOutParts(encryptedAmountIn, isToken0In, reserve0, reserve1);

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

        // Emit event
        emit TokensSwapped(msg.sender, pair, 0);

        return 0;  // Synchronous operation, no requestID needed
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
        if (to == address(0)) revert InvalidToken();

        // Step 2: Import encrypted data
        euint64 amountIn = FHE.fromExternal(encryptedAmountIn, inputProof);

        // Step 3: Determine token types
        TokenType typeIn = determineTokenType(tokenIn);
        TokenType typeOut = determineTokenType(tokenOut);

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

        if (!((processedTokenIn == token0 && processedTokenOut == token1) ||
              (processedTokenIn == token1 && processedTokenOut == token0))) {
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
        (euint128 expectedDivUpperPart, euint128 expectedDivLowerPart) =
            FHEPairLib.calculateExpectedOutParts(processedAmountIn, isToken0In, reserve0, reserve1);

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

        emit TokensSwapped(msg.sender, pair, 0);

        return 0;  // Synchronous operation, no requestID needed

        // Step 6: Asynchronous flow for official FHE conversion
        // TODO: Implement when official FHE tokens are available
        // Will delegate to TokenConverter.convertAndCall()
    }

    /**
     * @dev Unwrap project tokens to ERC20 (new feature)
     * @param originalToken Original ERC20 token address (e.g., USDC address)
     * @param encryptedAmount Encrypted amount
     * @param inputProof Input proof
     * @param to ERC20 recipient address
     * @return requestID Unwrap request ID
     *
     * User prerequisites:
     * 1. Get wrapper address: wrapper = WrapperFactory.getWrapper(originalToken)
     * 2. Set Router as operator: IERC7984(wrapper).setOperator(router, deadline)
     * 3. Call this function
     *
     * Process:
     * - Router queries wrapper address
     * - Router calls wrapper's unwrap function
     * - Wrapper asynchronously decrypts and sends ERC20 to 'to' address
     *
     * Note: Only supports unwrapping project wrapped tokens, not official FHE
     */
    function unwrapToken(
        address originalToken,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof,
        address to,
        uint256 deadline
    ) external nonReentrant notPaused validDeadline(deadline) returns (uint256 requestID) {
        // Step 1: Validate inputs
        if (originalToken == address(0) || to == address(0)) revert InvalidToken();

        // Step 2: Query wrapper address
        address wrapper = WrapperFactory(WRAPPER_FACTORY).getWrapper(originalToken);
        if (wrapper == address(0)) revert WrapperNotFound();

        // Step 3: Import encrypted amount
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);

        // Step 4: Check user has set Router as operator for the wrapper
        _checkOperatorPermission(msg.sender, wrapper);

        // Step 5: Transfer wrapped tokens from user to Router
        IERC7984(wrapper).confidentialTransferFrom(msg.sender, address(this), amount);

        // Step 6: Router sets wrapper as operator
        // This allows the wrapper to burn tokens from Router
        IERC7984(wrapper).setOperator(wrapper, uint48(deadline));

        // Step 7: Allow wrapper to access encrypted amount
        FHE.allowTransient(amount, wrapper);

        // Step 8: Call Wrapper.unwrap
        // Note: Unwrap is asynchronous
        // - Wrapper burns the wrapped tokens from Router
        // - Wrapper requests FHE decryption
        // - After decryption, wrapper sends ERC20 to 'to' address
        IERC20Wrapper(wrapper).unwrap(address(this), to, amount);

        emit TokenUnwrapped(msg.sender, wrapper, to, 0);

        return 0;  // Unwrap is asynchronous, actual requestID is generated by wrapper

        // Note: The underlying ERC20 will be sent directly to 'to' address
        // in the wrapper's finalizeUnwrap callback, no need for Router to hold it
    }

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
        // Initialize missing permissions array (max 3 items)
        string[] memory tempMissing = new string[](3);
        uint256 missingCount = 0;

        if (operationType == OperationType.ADD_LIQUIDITY) {
            // Check if tokenA and tokenB are ERC7984
            TokenType typeA = determineTokenType(tokenA);
            TokenType typeB = determineTokenType(tokenB);

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
            TokenType typeIn = determineTokenType(tokenA); // tokenA is tokenIn for swap

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
    function determineTokenType(address token) internal view returns (TokenType) {

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
        TokenType typeA = determineTokenType(originalTokenA);
        TokenType typeB = determineTokenType(originalTokenB);

        // Convert Router's TokenType to Factory's TokenType (same enum values)
        FHEFactory.TokenType factoryTypeA = FHEFactory.TokenType(uint8(typeA));
        FHEFactory.TokenType factoryTypeB = FHEFactory.TokenType(uint8(typeB));

        // Create pair with type information
        // Note: Using address(0) as priceScanner placeholder for now
        pairAddress = FHEFactory(FHE_FACTORY).createPairWithInfo(
            processedTokenA,
            processedTokenB,
            originalTokenA,
            originalTokenB,
            factoryTypeA,
            factoryTypeB,
            address(0)  // priceScanner placeholder
        );

        if (pairAddress == address(0)) {
            revert PairCreationFailed();
        }

        return pairAddress;
    }

    // ============================================
    // ============ Admin Functions ============
    // ============================================

    /**
     * @dev Set official FHE token status
     */
    function setOfficialFHEToken(address token, bool isOfficial) external onlyOwner {
        officialFHETokens[token] = isOfficial;
        emit OfficialFHETokenUpdated(token, isOfficial);
    }

    /**
     * @dev Set recommended deadline buffer (for reference only, not enforced)
     * @param newBuffer New recommended buffer time (seconds)
     * @notice This value is only used for frontend suggestions, contract does not enforce deadline to be ahead of this time
     */
    function setDeadlineBuffer(uint256 newBuffer) external onlyOwner {
        deadlineBuffer = newBuffer;
    }

    /**
     * @dev Emergency pause
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
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
}

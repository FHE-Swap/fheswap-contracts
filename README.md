# FHESwap

**A Confidential Automated Market Maker (AMM) with ERC20 to ERC7984 Wrapper System**

Building a privacy-preserving DEX where token amounts, balances, and reserves remain encrypted end-to-end using **Zama's Fully Homomorphic Encryption (FHEVM)**.

> ⚠️ **Work in Progress** - Currently in development phase.

---

## Project Vision

FHESwap aims to create a fully confidential UniswapV2-style AMM where:
- All token amounts and balances are encrypted
- Pool reserves remain private through obfuscation
- Liquidity operations preserve user privacy
- Price information is available without revealing exact reserves

---

## Development Roadmap

### Phase 1: Foundation ✅ **COMPLETED**

**ERC7984 Confidential Token Standard Implementation**
- ✅ Base ERC7984 implementation (OpenZeppelin standard)
- ✅ Token interfaces and utilities
- ✅ Receiver interface for confidential transfers

**ERC20 to ERC7984 Wrapper System** 
- ✅ ERC20Wrapper contract (bidirectional conversion)
- ✅ WrapperFactory (creation and management)
- ✅ Multi-decimal support (6 and 18 decimals)
- ✅ Configurable exchange rates
- ✅ Comprehensive test suite with mock decrypt callbacks
- ✅ Precision testing (1.897867 units test case)

### Phase 2: Core AMM 🚧 **IN PROGRESS**

**Core Contracts**
- ✅ **FHEFactory**: Pair creation and management (COMPLETED)
- ✅ **FHERouter**: Router for swap operations (COMPLETED)
- ✅ **TokenConverter**: Official FHE token conversion (COMPLETED)
- ✅ **FHEPairLib**: Mathematical operations and FHE computations (COMPLETED)
- 🚧 **FHEPair**: Confidential liquidity pool (IN DEVELOPMENT)

### Phase 3: Advanced Features 📋 **FUTURE**

- Frontend interface
- Additional features and optimizations

---

## Current Status: Phase 2 In Progress 🚧

We have successfully implemented the foundational wrapper system, factory contract, router contract, token converter, and pair library. The core AMM infrastructure is nearly complete, with only the FHEPair contract remaining in development.

### What Works Now

#### Wrapper System ✅
- **Wrap**: Convert ERC20 → ERC7984 (confidential)
- **Unwrap**: Convert ERC7984 → ERC20 (with decrypt callback)
- **Factory**: Create and manage wrappers for any ERC20 token
- **Testing**: Full test coverage including edge cases

#### Factory System ✅
- **FHEFactory**: Create and manage confidential trading pairs
- **Pair Creation**: Deterministic deployment using minimal proxies
- **Token Type Management**: Support for ERC20, ERC7984, and official FHE tokens
- **Platform Fee System**: Configurable platform fees with fee recipient management
- **Token Information Tracking**: Detailed token info with original/processed address mapping
- **Query Functions**: Comprehensive pair and token information retrieval
- **English Documentation**: Complete English comments and documentation
- **Testing**: Comprehensive test suite for factory operations

#### Router System ✅
- **FHERouter**: Unified interface for plaintext and encrypted operations
- **Token Wrapping**: Automatic ERC20 to ERC7984 conversion
- **Liquidity Management**: Add/remove liquidity with privacy preservation
- **Token Swapping**: Confidential swap operations with slippage protection
- **Slippage Protection**: Configurable slippage tolerance with expected output calculation
- **FHEPairLib Integration**: Mathematical operations for swap calculations
- **Permission Validation**: User permission checking and validation
- **Synchronous Operations**: Direct execution without async callbacks
- **Refund System**: Operation failure handling and token recovery
- **English Documentation**: Complete English comments and documentation

#### Token Converter System ✅
- **TokenConverter**: Official FHE token conversion architecture
- **Future-Ready**: Reserved architecture for Zama official FHE tokens
- **Admin Management**: Official FHE token registration and management
- **Async Processing**: Designed for future async unwrap operations
- **Batch Operations**: Bulk registration of official FHE tokens
- **Emergency Functions**: Token withdrawal and emergency controls
- **English Documentation**: Complete English comments and documentation

#### Example Usage

**Wrapper System:**
```solidity
// Create a wrapper for any ERC20 token
address wrapper = factory.createWrapper(
    usdcAddress,
    "Wrapped USDC",
    "wUSDC",
    1  // 1:1 rate
);

// Wrap tokens
erc20.approve(wrapper, amount);
wrapperContract.wrap(user, amount);

// Unwrap (asynchronous via FHEVM)
wrapperContract.unwrap(from, to, encryptedAmount);
```

**Factory System:**
```solidity
// Create a trading pair
address pair = fheFactory.createPairWithInfo(
    tokenA,
    tokenB,
    originalTokenA,
    originalTokenB,
    TokenType.PROJECT_WRAPPED,
    TokenType.PROJECT_WRAPPED,
    priceScanner
);

// Get existing pair
address existingPair = fheFactory.getPair(tokenA, tokenB);
```

**Router System:**
```solidity
// Add liquidity (plaintext version)
router.addLiquidity(
    tokenA,
    tokenB,
    amountA,
    amountB,
    to,
    deadline
);

// Add liquidity (encrypted version)
router.addLiquidity(
    tokenA,
    tokenB,
    encryptedAmountA,
    encryptedAmountB,
    inputProof,
    to,
    deadline
);

// Swap tokens with slippage protection
router.swapTokens(
    tokenIn,
    tokenOut,
    amountIn,
    50,  // 0.5% slippage tolerance
    to,
    deadline
);
```

**Token Converter System:**
```solidity
// Register official FHE token (admin only)
tokenConverter.registerOfficialFHE(
    officialFHE,
    underlying,
    officialWrapper
);

// Batch register official FHE tokens
tokenConverter.registerOfficialFHEBatch(
    officialFHEs,
    underlyings,
    officialWrappers
);

// Check if official FHE is registered
bool isRegistered = tokenConverter.isOfficialFHERegistered(officialFHE);
```

---

## Architecture

### Implemented Contracts

```
contracts/
├── confidential-tokens/
│   ├── base/
│   │   ├── ERC7984.sol              ✅ Confidential token implementation
│   │   ├── IERC7984.sol             ✅ Token interface
│   │   ├── ERC7984Utils.sol         ✅ Utility functions
│   │   └── IERC7984Receiver.sol     ✅ Receiver interface
│   └── extensions/
│       ├── ERC20Wrapper.sol         ✅ Wrapper contract
│       ├── WrapperFactory.sol       ✅ Factory contract
│       ├── WrapperUtils.sol         ✅ Utility library
│       ├── IERC20Wrapper.sol        ✅ Wrapper interface
│       └── WrapperTest.sol          ✅ Test suite
└── test/
    ├── MockERC20.sol                ✅ Mock ERC20 for testing
    └── MockERC20Wrapper.sol         ✅ Mock wrapper with callbacks
```

### Core Contracts

```
contracts/
└── core/                            
    ├── FHEFactory.sol               ✅ Pair factory (COMPLETED)
    ├── FHERouter.sol                ✅ Swap router (COMPLETED)
    ├── TokenConverter.sol           ✅ Token converter (COMPLETED)
    ├── FHEPairLib.sol               ✅ Pair library (COMPLETED)
    └── FHEPair.sol                  🚧 Liquidity pool (IN DEVELOPMENT)

---

## Testing

Run the complete test suite:

```bash
npx hardhat test
```

### Current Test Coverage ✅

**Wrapper System:**
- **18-decimal tokens** (ETH-like): Wrap/unwrap with precision tests
- **6-decimal tokens** (USDC-like): Wrap/unwrap with precision tests
- **Precision test**: 1.897867 units conversion accuracy
- **Complete unwrap cycle**: Mock decrypt callback simulation
- **Multi-user scenarios**: Concurrent operations
- **Factory integration**: Wrapper creation and management
- **Edge cases**: Zero amounts, invalid rates, unauthorized access
- **Event emission**: Wrapped/Unwrapped events

**Factory System:**
- **Pair creation**: Deterministic deployment testing
- **Token type validation**: ERC20, ERC7984, and official FHE support
- **Platform fee management**: Fee configuration and recipient management
- **Token information tracking**: Original/processed address mapping
- **Query functions**: Comprehensive pair and token info retrieval
- **Duplicate pair prevention**: Proper validation and error handling
- **Factory state management**: Pair tracking and retrieval
- **Edge cases**: Invalid tokens, unauthorized access, duplicate pairs
- **Documentation**: English comments and comprehensive documentation

**Router System:**
- **Token wrapping**: ERC20 to ERC7984 conversion testing
- **Permission validation**: Operator permission checking
- **Liquidity operations**: Add/remove liquidity with encrypted amounts
- **Swap operations**: Token swapping with privacy preservation
- **Slippage protection**: Expected output calculation and slippage validation
- **FHEPairLib integration**: Mathematical operations for swap calculations
- **Synchronous execution**: Direct operation execution without async callbacks
- **Error handling**: Comprehensive error scenarios and edge cases
- **Refund mechanisms**: Operation failure handling and token recovery
- **Documentation**: English comments and comprehensive documentation

**Token Converter System:**
- **Admin functions**: Official FHE token registration and management
- **Batch operations**: Bulk registration testing
- **Permission controls**: Owner-only access validation
- **Future architecture**: Placeholder functions for official FHE integration
- **Emergency functions**: Token withdrawal and emergency controls
- **State management**: Registration tracking and validation
- **Documentation**: English comments and comprehensive documentation

**Pair Library System:**
- **Mathematical operations**: Square root, random number generation, and FHE computations
- **Reserve obfuscation**: Privacy-preserving reserve calculation for public price discovery
- **Liquidity calculations**: Add/remove liquidity mathematical operations with encrypted amounts
- **Swap calculations**: AMM swap logic implementation with 0.3% fee
- **Slippage protection**: Expected output calculation for slippage protection
- **Division invariance**: Secure division operations using random number obfuscation
- **Error handling**: Comprehensive validation and edge case handling
- **Documentation**: English comments and comprehensive documentation

All tests passing ✅

---

## Technical Highlights

### Decimal Conversion
- ERC20: 6 or 18 decimals
- ERC7984: 6 decimals (standardized)
- Automatic rate-based conversion

### Asynchronous Unwrapping
1. User initiates unwrap with encrypted amount
2. Contract burns confidential tokens
3. FHEVM gateway decrypts the amount
4. Callback transfers ERC20 tokens to user

### Privacy Preservation
- Wrapped amounts are fully encrypted (euint64)
- Only authorized parties can decrypt
- Unwrap process maintains confidentiality until final transfer

---

## Requirements

- Node.js
- Hardhat
- FHEVM dependencies (@fhevm/solidity)
- OpenZeppelin contracts

### Installation

```bash
npm install
```

---

## Next Steps

Continuing development of the core AMM contracts:
- **FHEPair**: Confidential liquidity pool (in development)

**Recently Completed:**
- **FHERouter**: Swap routing and liquidity management with unified interface
- **TokenConverter**: Official FHE token conversion architecture (future-ready)
- **FHEPairLib**: Mathematical operations and FHE computations library

---

## Contributing

This is a research and development project. Contributions and feedback are welcome.

---

## License

**BSD 3-Clause Clear License**

---

## Acknowledgments

Built with:
- **Zama's FHEVM** - Fully Homomorphic Encryption for smart contracts
- **OpenZeppelin** - ERC-7984 Confidential Token Standard

Resources:
- [FHEVM Documentation](https://docs.zama.ai/fhevm)
- [ERC-7984 Specification](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts)
- [Hardhat Guide](https://docs.zama.ai/protocol/solidity-guides/getting-started/quick-start-tutorial)

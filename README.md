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
- 🚧 **FHEPair**: Confidential liquidity pool with encrypted operations (IN DEVELOPMENT)
- 🚧 **FHERouter**: Router for swap operations (IN DEVELOPMENT)

### Phase 3: Advanced Features 📋 **FUTURE**

- Frontend interface
- Additional features and optimizations

---

## Current Status: Phase 2 In Progress 🚧

We have successfully implemented the foundational wrapper system and are now developing the core AMM contracts. The factory contract is complete and ready for pair creation and management.

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
- **Testing**: Comprehensive test suite for factory operations

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
    ├── FHEPair.sol                  🚧 Liquidity pool (IN DEVELOPMENT)
    ├── FHEPairLib.sol               🚧 Pair library (IN DEVELOPMENT)
    ├── FHERouter.sol                🚧 Swap router (IN DEVELOPMENT)
    └── TokenConverter.sol           🚧 Token converter (IN DEVELOPMENT)

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
- **Duplicate pair prevention**: Proper validation and error handling
- **Factory state management**: Pair tracking and retrieval
- **Edge cases**: Invalid tokens, unauthorized access, duplicate pairs

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
- **FHEPair**: Confidential liquidity pool with encrypted operations
- **FHERouter**: Swap routing and liquidity management
- **FHEPairLib**: Mathematical operations and FHE computations
- **TokenConverter**: Official FHE token conversion (future)

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

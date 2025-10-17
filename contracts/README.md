# FHEVM Confidential Token Swap & Liquidity Protocol

A comprehensive Hardhat-based project for developing and deploying confidential token swap and liquidity provision contracts using FHEVM (Fully Homomorphic Encryption Virtual Machine) on Zama's FHEVM network, enhanced with RISC Zero zero-knowledge proofs.

## Overview

This project implements a complete confidential token swap and liquidity protocol similar to Uniswap V2, but with privacy-preserving features using fully homomorphic encryption. The system allows users to swap confidential tokens and provide liquidity while maintaining complete privacy of their balances, transaction amounts, and liquidity positions. The protocol integrates RISC Zero zero-knowledge proofs for enhanced security and verifiable computations.

## Key Features

### 🔐 Privacy-Preserving Operations
- **Confidential Token Swaps**: Privacy-preserving token exchanges using FHEVM
- **Encrypted Liquidity Management**: Add and remove liquidity with complete privacy
- **Confidential Balance Tracking**: All balances and reserves stored in encrypted form
- **Private Transaction History**: No on-chain visibility of transaction amounts

### 🏊‍♂️ Advanced Liquidity Features
- **Liquidity Provision**: Add liquidity to pools and receive LP tokens
- **Liquidity Removal**: Remove liquidity and burn LP tokens
- **LP Token Management**: Encrypted LP token balances and total supply tracking
- **First Liquidity Lock**: Initial liquidity provision with locked LP tokens
- **Liquidity Calculation**: Off-chain calculation with on-chain verification

### 🛡️ Security & Verification
- **RISC Zero Integration**: Zero-knowledge proof verification for swap and liquidity operations
- **Signature Verification**: Cryptographic signature validation for all operations
- **Proof Replay Protection**: Prevents double-spending of ZK proofs
- **Trusted Verifier System**: Configurable trusted verifier for proof validation

### 💰 Protocol Economics
- **Protocol Fees**: Configurable protocol fees (default 0.05%)
- **Fee Distribution**: Automatic fee distribution to designated addresses
- **Fee Management**: Owner-controlled fee settings and distribution
- **Slippage Protection**: Built-in slippage protection mechanisms

### 🔧 Multiple Implementation Levels
- **`FHESwap`**: Basic swap functionality with encrypted reserves
- **`FHESwapSimple`**: Simplified implementation with LP token support
- **`FHESwapSimpleGuarded`**: Advanced implementation with ZK proofs and protocol fees
- **`ConfidentialFungibleTokenMintableBurnable`**: Confidential token with mint/burn capabilities

## Smart Contracts

### Core Contracts

#### `FHESwap.sol` - Basic Swap Implementation
- **Purpose**: Basic confidential token swap functionality
- **Features**: 
  - Encrypted reserves management
  - Basic swap operations with off-chain calculation
  - Liquidity provision (mint function)
  - Numerator/denominator pattern for division handling

#### `FHESwapSimple.sol` - Enhanced Swap with LP Tokens
- **Purpose**: Simplified but complete AMM implementation
- **Features**:
  - Full liquidity provision and removal
  - LP token minting and burning
  - Encrypted LP balance tracking
  - Event emission for liquidity operations
  - Complete swap functionality with slippage protection

#### `FHESwapSimpleGuarded.sol` - Advanced Protocol with ZK Proofs
- **Purpose**: Production-ready implementation with maximum security
- **Features**:
  - **RISC Zero Integration**: ZK proof verification for all operations
  - **Protocol Fees**: Configurable fees with automatic distribution
  - **Advanced Liquidity Management**: Sophisticated LP token handling
  - **Signature Verification**: Cryptographic proof validation
  - **Fee Management**: Owner-controlled fee settings and distribution
  - **Proof Replay Protection**: Prevents double-spending attacks
  - **Trusted Verifier System**: Configurable verification authority

#### `ConfidentialFungibleTokenMintableBurnable.sol` - Confidential Token
- **Purpose**: Confidential token implementation with administrative controls
- **Features**:
  - Mintable and burnable confidential tokens
  - Owner-controlled minting
  - Integration with swap contracts
  - Standard confidential token interface

### Technical Architecture

#### Encryption & Privacy
- **FHE Operations**: All sensitive data encrypted using FHEVM
- **Confidential Transfers**: Privacy-preserving token movements
- **Encrypted State**: Reserves, balances, and LP tokens stored encrypted
- **Operator Authorization**: Secure access control for token operations

#### Zero-Knowledge Integration
- **RISC Zero Host**: Off-chain proof generation and verification
- **Proof Verification**: On-chain signature validation
- **Journal-based Proofs**: Structured proof data for swap and liquidity operations
- **Expiry Management**: Time-based proof validation

#### Fee System
- **Fee Distribution**: Automatic LP token distribution to fee recipients
- **Fee Management**: Owner-controlled fee settings and recipients
- **Fee Accumulation**: Tracking of accumulated protocol fees

## Prerequisites

- Node.js >= 20
- npm >= 7.0.0
- Access to Sepolia FHEVM network
- Infura API key (for Sepolia deployment)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd contracts
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
npx hardhat vars setup
```

Required environment variables:
- `MNEMONIC`: Your wallet mnemonic phrase
- `INFURA_API_KEY`: Infura API key for Sepolia access
- `ETHERSCAN_API_KEY`: Etherscan API key for contract verification

## Usage

### Compilation

```bash
npm run compile
```

### Testing

Run all tests:
```bash
npm test
```

Run Sepolia-specific tests:
```bash
npm run test:sepolia
```

Run quick Sepolia tests:
```bash
npm run test:sepolia:quick
```

### Deployment

Deploy to Sepolia:
```bash
npm run deploy:sepolia
```

Deploy using script:
```bash
npm run deploy:sepolia:script
```

### Contract Verification

Verify contracts on Etherscan:
```bash
npm run verify:sepolia
```

## Scripts

### Utility Scripts

- **`mint-sepolia.ts`**: Mint confidential tokens on Sepolia
- **`fund-accounts.js`**: Fund test accounts with ETH
- **`check-balance.js`**: Check account balances
- **`show-conf-balance.ts`**: Display confidential token balances

### Deployment Scripts

- **`001_deploy_tokens_and_swap.ts`**: Deploy tokens and swap contracts
- **`deploy-sepolia.sh`**: Automated deployment script for Sepolia

## Project Structure

```
contracts/
├── contracts/           # Smart contracts
│   ├── FHESwap.sol
│   ├── FHESwapSimple.sol
│   ├── FHESwapSimpleGuarded.sol
│   └── ConfidentialFungibleTokenMintableBurnable.sol
├── test/               # Test files
│   ├── FHESwap.sepolia.ts
│   ├── FHESwapSimple.sepolia.ts
│   ├── FHESwapSimpleGuarded.e2e.ts
│   └── FHESwapCompleteFlow.e2e.ts
├── scripts/            # Deployment and utility scripts
├── deploy/             # Hardhat deployment configurations
├── tasks/              # Hardhat custom tasks
└── typechain-types/    # Generated TypeScript types
```

## Development

### Code Quality

Lint Solidity code:
```bash
npm run lint:sol
```

Lint TypeScript code:
```bash
npm run lint:ts
```

Format code:
```bash
npm run prettier:write
```

### Coverage

Generate test coverage report:
```bash
npm run coverage
```

### Type Generation

Generate TypeScript types from contracts:
```bash
npm run typechain
```

## Network Configuration

### Sepolia FHEVM

The project is configured to work with Sepolia FHEVM network:
- Chain ID: 11155111
- Gas limit: 8,000,000
- Gas price: 20 gwei
- Timeout: 600 seconds

### Local Development

For local development, use the hardhat network:
```bash
npx hardhat node
```

## Security Considerations

- **Private Key Management**: Never commit private keys or mnemonics to version control
- **Operator Authorization**: Ensure proper operator setup for confidential token operations
- **Off-chain Calculations**: Division operations must be performed off-chain and results re-encrypted
- **Gas Limits**: FHEVM operations may require higher gas limits

## Testing

The project includes comprehensive test suites:

- **Unit Tests**: Individual contract functionality
- **Integration Tests**: End-to-end swap flows
- **Sepolia Tests**: Network-specific testing
- **E2E Tests**: Complete user journey testing

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

This project is licensed under the BSD-3-Clause-Clear License - see the [LICENSE](LICENSE) file for details.

## Resources

- [FHEVM Documentation](https://docs.fhevm.org/)
- [Zama FHEVM](https://fhevm.org/)
- [OpenZeppelin Confidential Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/master/contracts/confidential)
- [Hardhat Documentation](https://hardhat.org/docs)

## Support

For questions and support, please refer to the FHEVM community channels or create an issue in this repository.

# RISC Zero ZK Proof System for FHEVM Confidential Token Swaps

A comprehensive RISC Zero zero-knowledge proof system designed to provide cryptographic verification for confidential token swap and liquidity operations on the FHEVM (Fully Homomorphic Encryption Virtual Machine) network. This system ensures the integrity and correctness of swap calculations, liquidity provision, and fee distribution while maintaining complete privacy through zero-knowledge proofs.

## Overview

This project implements a sophisticated zero-knowledge proof system using RISC Zero zkVM to verify complex financial calculations for confidential token swaps and liquidity management. The system provides cryptographic guarantees for:

- **Swap Calculations**: Verification of AMM (Automated Market Maker) swap computations
- **Liquidity Operations**: Proof of correct liquidity provision and removal calculations
- **Fee Distribution**: Cryptographic verification of protocol fee calculations
- **Slippage Protection**: Mathematical proof of slippage bounds compliance
- **Context Binding**: Binding proofs to specific blockchain contexts and time windows

## Key Features

### 🔐 Zero-Knowledge Verification
- **Cryptographic Proofs**: RISC Zero zkVM-based proof generation and verification
- **Privacy-Preserving**: No sensitive data exposed during proof verification
- **Mathematical Guarantees**: Cryptographic assurance of calculation correctness
- **Efficient Verification**: Fast on-chain proof verification

### 💱 Swap Proof System
- **AMM Calculations**: Verification of constant product formula calculations
- **Fee Handling**: Proof of correct fee application (0.3% default)
- **Slippage Protection**: Mathematical verification of slippage bounds
- **Reserve Updates**: Cryptographic proof of reserve state transitions

### 🏊‍♂️ Liquidity Proof System
- **Add Liquidity**: Verification of liquidity provision calculations
- **Remove Liquidity**: Proof of liquidity removal and token distribution
- **LP Token Minting**: Cryptographic verification of LP token calculations
- **Protocol Fees**: Proof of protocol fee distribution calculations

### 🛡️ Security Features
- **Context Binding**: Proofs bound to specific chain, pool, and user contexts
- **Expiry Protection**: Time-based proof validation
- **Nonce System**: Replay attack prevention
- **Signature Verification**: Cryptographic signature validation

## Architecture

### Project Structure

```
RISC_ZAMA/
├── Cargo.toml                 # Workspace configuration
├── rust-toolchain.toml        # Rust toolchain specification
├── host/                      # Host application (proof generation)
│   ├── Cargo.toml
│   └── src/
│       └── main.rs           # Main host logic and proof orchestration
└── methods/                   # zkVM guest programs
    ├── Cargo.toml
    ├── build.rs              # Build configuration
    ├── guest/                # Swap verification guest
    │   ├── Cargo.toml
    │   └── src/main.rs       # Swap calculation verification
    ├── guest_add_liquidity/  # Add liquidity verification guest
    │   ├── Cargo.toml
    │   └── src/main.rs       # Liquidity provision verification
    └── guest_remove_liquidity/ # Remove liquidity verification guest
        ├── Cargo.toml
        └── src/main.rs       # Liquidity removal verification
```

### Core Components

#### 1. Host Application (`host/`)
The host application orchestrates the proof generation process:
- **Input Processing**: Handles JSON input from external systems
- **Proof Generation**: Coordinates zkVM execution and proof creation
- **Output Management**: Returns proof hashes for on-chain verification
- **Multiple Methods**: Supports swap, add liquidity, and remove liquidity proofs

#### 2. Swap Verification Guest (`guest/`)
Verifies swap calculation correctness:
- **AMM Formula**: Implements constant product formula verification
- **Fee Calculations**: Verifies 0.3% fee application
- **Slippage Checks**: Ensures slippage within acceptable bounds
- **Reserve Validation**: Confirms reserve state consistency

#### 3. Add Liquidity Guest (`guest_add_liquidity/`)
Verifies liquidity provision calculations:
- **LP Token Calculation**: Verifies LP token minting calculations
- **Protocol Fees**: Calculates and verifies protocol fee distribution
- **First Add Logic**: Handles initial liquidity provision with locked tokens
- **K Value Tracking**: Maintains and verifies invariant calculations

#### 4. Remove Liquidity Guest (`guest_remove_liquidity/`)
Verifies liquidity removal calculations:
- **Token Distribution**: Verifies proportional token distribution
- **LP Token Burning**: Confirms LP token burn calculations
- **Fee Distribution**: Calculates protocol fee distribution
- **Reserve Updates**: Verifies reserve state transitions

## Data Structures

### Swap Inputs
```rust
pub struct SwapInputs {
    pub reserve_in: u128,           // Input token reserve
    pub reserve_out: u128,          // Output token reserve
    pub amount_in: u128,            // Input amount
    pub fee_numerator: u128,        // Fee numerator (997)
    pub fee_denominator: u128,      // Fee denominator (1000)
    pub expected_out: u128,         // Expected output amount
    pub min_out: u128,              // Minimum acceptable output
    pub max_slippage_bps: u128,     // Maximum slippage in basis points
    pub chain_id: u64,              // Blockchain chain ID
    pub pool: [u8; 20],             // Pool contract address
    pub token_in: [u8; 20],         // Input token address
    pub to: [u8; 20],               // Recipient address
    pub expiry: u64,                // Proof expiry timestamp
    pub nonce: u64,                 // Nonce for replay protection
}
```

### Add Liquidity Inputs
```rust
pub struct AddLiquidityInputs {
    pub reserve0: u128,             // Token0 reserve
    pub reserve1: u128,             // Token1 reserve
    pub amount0: u128,              // Token0 amount to add
    pub amount1: u128,              // Token1 amount to add
    pub total_supply: u128,         // Current LP token total supply
    pub is_first_add: bool,         // Whether this is the first liquidity add
    pub min_amount0: u128,          // Minimum token0 amount
    pub min_amount1: u128,          // Minimum token1 amount
    pub min_liquidity: u128,        // Minimum liquidity to mint
    pub fee_enabled: bool,          // Whether protocol fees are enabled
    pub fee_to: [u8; 20],          // Fee recipient address
    pub last_k: u128,               // Previous K value for fee calculation
    pub chain_id: u64,              // Blockchain chain ID
    pub pool: [u8; 20],             // Pool contract address
    pub user: [u8; 20],             // User address
    pub expiry: u64,                // Proof expiry timestamp
    pub nonce: u64,                 // Nonce for replay protection
}
```

### Remove Liquidity Inputs
```rust
pub struct RemoveLiquidityInputs {
    pub reserve0: u128,             // Token0 reserve
    pub reserve1: u128,             // Token1 reserve
    pub total_supply: u128,         // Current LP token total supply
    pub liquidity: u128,            // LP tokens to burn
    pub min_amount0_out: u128,      // Minimum token0 to receive
    pub min_amount1_out: u128,      // Minimum token1 to receive
    pub fee_enabled: bool,          // Whether protocol fees are enabled
    pub fee_to: [u8; 20],          // Fee recipient address
    pub last_k: u128,               // Previous K value for fee calculation
    pub chain_id: u64,              // Blockchain chain ID
    pub pool: [u8; 20],             // Pool contract address
    pub user: [u8; 20],             // User address
    pub expiry: u64,                // Proof expiry timestamp
    pub nonce: u64,                 // Nonce for replay protection
}
```

## Mathematical Foundations

### AMM Formula Verification
The system verifies the constant product formula:
```
x * y = k
```
Where:
- `x` = reserve of token0
- `y` = reserve of token1
- `k` = constant product invariant

### Swap Calculation
For a swap of `amount_in` tokens:
```
amount_in_with_fee = amount_in * 997 / 1000
amount_out = (amount_in_with_fee * reserve_out) / (reserve_in * 1000 + amount_in_with_fee)
```

### Liquidity Calculation
For adding liquidity:
```
liquidity = min(amount0 * total_supply / reserve0, amount1 * total_supply / reserve1)
```

### Protocol Fee Calculation
```
protocol_fee_lp = (new_k - last_k) * total_supply / (2 * new_k)
```

## Prerequisites

- **Rust**: Latest stable version (managed by `rust-toolchain.toml`)
- **RISC Zero**: Version 3.0.3 or compatible
- **Development Environment**: Linux/macOS recommended

## Installation

1. **Install Rust** (if not already installed):
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

2. **Clone and Build**:
```bash
cd RISC_ZAMA
cargo build
```

## Usage

### Development Mode (Recommended for Development)

For faster iteration during development, use dev mode:

```bash
RUST_LOG="[executor]=info" RISC0_DEV_MODE=1 cargo run
```

This mode:
- Skips actual proof generation for faster execution
- Provides execution statistics
- Enables detailed logging
- Perfect for testing and development

### Production Mode

For actual proof generation:

```bash
cargo run
```

### Input Format

The system expects JSON input via stdin with the following structure:

#### Swap Proof Input Structure
```json
{
  "reserve_in": <u128>,         // Input token reserve amount
  "reserve_out": <u128>,        // Output token reserve amount  
  "amount_in": <u128>,          // Input amount for swap
  "fee_numerator": <u128>,      // Fee numerator (typically 997)
  "fee_denominator": <u128>,    // Fee denominator (typically 1000)
  "expected_out": <u128>,       // Expected output amount
  "min_out": <u128>,            // Minimum acceptable output
  "max_slippage_bps": <u128>,   // Maximum slippage in basis points
  "chain_id": <u64>,            // Blockchain chain ID
  "pool": [<u8; 20>],           // Pool contract address
  "token_in": [<u8; 20>],       // Input token address
  "to": [<u8; 20>],             // Recipient address
  "expiry": <u64>,              // Proof expiry timestamp
  "nonce": <u64>                // Nonce for replay protection
}
```

#### Add Liquidity Proof Input Structure
```json
{
  "reserve0": <u128>,           // Token0 reserve amount
  "reserve1": <u128>,           // Token1 reserve amount
  "amount0": <u128>,            // Token0 amount to add
  "amount1": <u128>,            // Token1 amount to add
  "total_supply": <u128>,       // Current LP token total supply
  "is_first_add": <bool>,       // Whether this is the first liquidity add
  "min_amount0": <u128>,        // Minimum token0 amount
  "min_amount1": <u128>,        // Minimum token1 amount
  "min_liquidity": <u128>,      // Minimum liquidity to mint
  "fee_enabled": <bool>,        // Whether protocol fees are enabled
  "fee_to": [<u8; 20>],         // Fee recipient address
  "last_k": <u128>,             // Previous K value for fee calculation
  "chain_id": <u64>,            // Blockchain chain ID
  "pool": [<u8; 20>],           // Pool contract address
  "user": [<u8; 20>],           // User address
  "expiry": <u64>,              // Proof expiry timestamp
  "nonce": <u64>                // Nonce for replay protection
}
```

### Output Format

The system outputs a proof hash in the format:
```
proof_hash=0x[64-character-hex-string]
```

## Integration with FHEVM Contracts

### Proof Generation Workflow

1. **Contract Call**: FHEVM contract calls `getAmountOut` or liquidity functions
2. **Data Preparation**: Contract prepares input data for proof generation
3. **Proof Generation**: Host application generates ZK proof
4. **Signature**: Trusted verifier signs the proof hash
5. **Contract Verification**: Contract verifies signature and executes operation

### Contract Integration Points

- **Swap Operations**: `swapWithProof` function in `FHESwapSimpleGuarded`
- **Add Liquidity**: `addLiquidityWithProof` function
- **Remove Liquidity**: `removeLiquidityWithProof` function
- **Fee Withdrawal**: `withdrawProtocolFees` function

## Security Considerations

### Proof Security
- **Cryptographic Guarantees**: All calculations are cryptographically verified
- **Replay Protection**: Nonce system prevents proof reuse
- **Expiry Protection**: Time-based proof validation
- **Context Binding**: Proofs bound to specific blockchain contexts

### Trust Model
- **Trusted Verifier**: Centralized verifier for proof signatures
- **Verifier Rotation**: Ability to update trusted verifier
- **Multi-sig Support**: Potential for multi-signature verification

### Privacy Preservation
- **Zero-Knowledge**: No sensitive data revealed during verification
- **Encrypted State**: All on-chain state remains encrypted
- **Private Calculations**: Complex calculations performed off-chain

## Performance Characteristics

### Proof Generation Time
- **Development Mode**: ~1-2 seconds (no actual proof generation)
- **Production Mode**: ~10-30 seconds (depending on complexity)
- **Optimization**: Build with `--release` for best performance

### Gas Costs
- **On-chain Verification**: Minimal gas cost for signature verification
- **Proof Storage**: No on-chain proof storage required
- **Efficient Verification**: Fast cryptographic verification

## Development Workflow

### Local Development
1. **Code Changes**: Modify guest programs or host logic
2. **Build**: `cargo build`
3. **Test**: `RISC0_DEV_MODE=1 cargo run`
4. **Debug**: Use logging and development mode for debugging

### Testing
1. **Unit Tests**: Test individual components
2. **Integration Tests**: Test full proof generation workflow
3. **Contract Tests**: Test integration with FHEVM contracts

### Deployment
1. **Build Release**: `cargo build --release`
2. **Deploy Host**: Deploy host application to production environment
3. **Update Contracts**: Update contract verifier addresses
4. **Monitor**: Monitor proof generation and verification

## Troubleshooting

### Common Issues

1. **Build Failures**: Ensure correct Rust toolchain version
2. **Proof Generation Errors**: Check input data validity
3. **Verification Failures**: Verify signature and proof hash
4. **Performance Issues**: Use development mode for testing

### Debug Mode
Enable detailed logging:
```bash
RUST_LOG="debug" RISC0_DEV_MODE=1 cargo run
```

## Contributing

1. **Fork Repository**: Create your own fork
2. **Create Branch**: Create feature branch
3. **Implement Changes**: Make your modifications
4. **Test Thoroughly**: Test all functionality
5. **Submit PR**: Create pull request with detailed description

## License

This project is licensed under the same license as the parent project. See the LICENSE file for details.

## Resources

- [RISC Zero Documentation](https://dev.risczero.com/)
- [RISC Zero Examples](https://github.com/risc0/risc0/tree/main/examples)
- [FHEVM Documentation](https://docs.fhevm.org/)
- [Zero-Knowledge Proofs](https://z.cash/technology/zksnarks/)

## Support

For questions and support:
- Create an issue in the repository
- Join the RISC Zero Discord community
- Check the RISC Zero documentation

---

**Note**: This system is designed for use with the FHEVM confidential token swap protocol. Ensure proper integration testing before production deployment.
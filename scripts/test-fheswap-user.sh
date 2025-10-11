#!/bin/bash

# Compile contracts
echo "🔨 Compiling contracts..."
npx hardhat compile

# Run local tests
echo "🧪 Running FHESwapUser tests..."
npx hardhat test test/FHESwapUser.ts

# If you need to test on Sepolia testnet, uncomment the lines below
# echo "🧪 Running FHESwapUser tests on Sepolia..."
# npx hardhat test test/FHESwapUser.ts --network sepolia

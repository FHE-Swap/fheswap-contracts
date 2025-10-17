#!/bin/bash

# FHESwap Sepolia deployment script
echo "🚀 Starting FHESwap deployment to Sepolia testnet..."

# Check environment variables
if [ -z "$MNEMONIC" ]; then
    echo "❌ Error: MNEMONIC environment variable not set"
    echo "Please run: npx hardhat vars set MNEMONIC"
    exit 1
fi

if [ -z "$INFURA_API_KEY" ]; then
    echo "❌ Error: INFURA_API_KEY environment variable not set"
    echo "Please run: npx hardhat vars set INFURA_API_KEY"
    exit 1
fi

echo "✅ Environment variables check passed"

# Compile contracts
echo "📦 Compiling contracts..."
npx hardhat compile

if [ $? -ne 0 ]; then
    echo "❌ Contract compilation failed"
    exit 1
fi

echo "✅ Contract compilation successful"

# Deploy to Sepolia
echo "🌐 Deploying to Sepolia testnet..."
npx hardhat deploy --network sepolia

if [ $? -ne 0 ]; then
    echo "❌ Deployment failed"
    exit 1
fi

echo "✅ Deployment successful!"

# Show deployment info
echo "📋 Deployment info:"
echo "Network: Sepolia"
echo "Deployment files: ./deployments/sepolia/"

echo ""
echo "🎉 Deployment complete! You can now run tests:"
echo "npm run test:sepolia"
echo ""
echo "Or run specific Sepolia tests:"
echo "npx hardhat test test/FHESwap.sepolia.ts --network sepolia"
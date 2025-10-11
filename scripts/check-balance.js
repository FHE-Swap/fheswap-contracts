const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Checking Sepolia account balance...\n");
  
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  
  console.log(`📋 Network info:`);
  console.log(`Network: ${hre.network.name}`);
  console.log(`Chain ID: ${hre.network.config.chainId}`);
  console.log(`URL: ${hre.network.config.url}\n`);
  
  console.log(`👤 Deployer account:`);
  console.log(`Address: ${deployer.address}`);
  
  try {
    const balance = await ethers.provider.getBalance(deployer.address);
    const balanceInEth = ethers.formatEther(balance);
    
    console.log(`Balance: ${balanceInEth} ETH`);
    
    if (parseFloat(balanceInEth) < 0.01) {
      console.log("⚠️  Warning: Balance may be insufficient for deployment and testing");
      console.log("Please get more ETH from testnet faucets:");
      console.log("- https://sepoliafaucet.com/");
      console.log("- https://faucets.chain.link/");
    } else if (parseFloat(balanceInEth) < 0.05) {
      console.log("⚠️  Warning: Balance may only be enough for basic deployment");
    } else {
      console.log("✅ Balance sufficient for deployment and testing");
    }
    
  } catch (error) {
    console.error("❌ Failed to get balance:", error.message);
    console.log("Please check network connection and configuration");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script execution failed:", error);
    process.exit(1);
  });
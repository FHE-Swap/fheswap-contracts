import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployTokensAndSwap: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("====================================================");
  console.log(`Deploying to network: ${hre.network.name}`);
  console.log(`Deployer account: ${deployer}`);
  console.log("====================================================\n");

  // Check deployer balance
  const deployerSigner = await ethers.getSigner(deployer);
  const balance = await ethers.provider.getBalance(deployer);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH\n`);

  // Deploy TokenA
  console.log("🚀 Deploying TokenA (ConfidentialFungibleTokenMintableBurnable)...");
  const tokenADeployment = await deploy("TokenA", {
    contract: "ConfidentialFungibleTokenMintableBurnable",
    from: deployer,
    args: [deployer, "TokenA", "TKA", "https://example.com/metadataA"],
    log: true,
    waitConfirmations: hre.network.name === "sepolia" ? 2 : 1,
  });
  console.log(`✅ TokenA deployed at: ${tokenADeployment.address}\n`);

  // Deploy TokenB
  console.log("🚀 Deploying TokenB (ConfidentialFungibleTokenMintableBurnable)...");
  const tokenBDeployment = await deploy("TokenB", {
    contract: "ConfidentialFungibleTokenMintableBurnable",
    from: deployer,
    args: [deployer, "TokenB", "TKB", "https://example.com/metadataB"],
    log: true,
    waitConfirmations: hre.network.name === "sepolia" ? 2 : 1,
  });
  console.log(`✅ TokenB deployed at: ${tokenBDeployment.address}\n`);

  // Deploy FHESwapSimple
  console.log("🚀 Deploying FHESwapSimple...");
  const fheSwapDeployment = await deploy("FHESwap", {
    contract: "FHESwapSimple",
    from: deployer,
    args: [tokenADeployment.address, tokenBDeployment.address, deployer],
    log: true,
    waitConfirmations: hre.network.name === "sepolia" ? 2 : 1,
  });
  console.log(`✅ FHESwapSimple deployed at: ${fheSwapDeployment.address}\n`);

  // Initialize coprocessor on testnet
  if (hre.network.name === "sepolia") {
    console.log("🔧 Initializing FHEVM coprocessor...");
    try {
      // Connect to deployed contracts
      const tokenA = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenADeployment.address);
      const tokenB = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenBDeployment.address);
      const fheSwap = await ethers.getContractAt("FHESwapSimple", fheSwapDeployment.address);

      // Initialize coprocessor
      await hre.fhevm.assertCoprocessorInitialized(tokenA, "ConfidentialFungibleTokenMintableBurnable");
      await hre.fhevm.assertCoprocessorInitialized(tokenB, "ConfidentialFungibleTokenMintableBurnable");
      await hre.fhevm.assertCoprocessorInitialized(fheSwap, "FHESwapSimple");
      console.log("✅ FHEVM coprocessor initialized\n");
    } catch (error) {
      console.log("⚠️  Coprocessor initialization warning:", error);
      console.log("This may be normal, will be handled automatically during testing\n");
    }
  }

  console.log("====================================================");
  console.log("🎉 All contracts deployed successfully!");
  console.log("====================================================");
  console.log(`TokenA: ${tokenADeployment.address}`);
  console.log(`TokenB: ${tokenBDeployment.address}`);
  console.log(`FHESwap: ${fheSwapDeployment.address}`);
  console.log("====================================================\n");

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    tokenA: tokenADeployment.address,
    tokenB: tokenBDeployment.address,
    fheSwap: fheSwapDeployment.address,
    deployer: deployer,
    timestamp: new Date().toISOString(),
  };

  console.log("📝 Deployment info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
};

export default deployTokensAndSwap;
deployTokensAndSwap.tags = ["TokenA", "TokenB", "FHESwap", "all"];
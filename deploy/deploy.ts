import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deployConfidentialToken = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("Deploying from account:", deployer);

  const name = "MyConfidentialToken";
  const symbol = "MCT";
  const uri = "https://example.com/metadata/";

  await deploy("ConfidentialFungibleTokenMintableBurnable", {
    from: deployer,
    args: [deployer, name, symbol, uri],
    log: true,
  });
};

export default deployConfidentialToken;
deployConfidentialToken.tags = ["ConfidentialFungibleTokenMintableBurnable"];
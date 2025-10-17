import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  const tokenA = await deployments.getOrNull("TokenA");
  const tokenB = await deployments.getOrNull("TokenB");

  if (!tokenA || !tokenB) {
    throw new Error("TokenA/TokenB not found. Deploy base tokens first.");
  }

  const signers = await ethers.getSigners();
  const trustedVerifier = signers[3].address;

  await deploy("FHESwapSimpleGuarded", {
    from: deployer,
    args: [tokenA.address, tokenB.address, deployer, trustedVerifier],
    log: true,
    waitConfirmations: 1,
  });

  log(`FHESwapSimpleGuarded deployed with trustedVerifier=${trustedVerifier}`);
};

export default func;
func.tags = ["guarded"];
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

async function main() {
  const target = process.env.TO?.trim() || "0xd857e1E4E3c042B1cF0996E89A54C686bA87f8E2";
  const tokenAAddr = process.env.TOKEN_A?.trim() || "0x174FAEb7FE5690366612E99058d6e0D2B388aCAD";
  const tokenBAddr = process.env.TOKEN_B?.trim() || "0x57085a2fC68473188e046F0Ea16A1075DD56D6f2";

  const [signer0] = await ethers.getSigners();
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Decrypt-as signer:", signer0.address);
  console.log("Target address:", target);
  console.log("TokenA:", tokenAAddr);
  console.log("TokenB:", tokenBAddr);

  // Initialize FHEVM CLI (needed for decryption)
  await fhevm.initializeCLIApi();

  const tokenA = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenAAddr);
  const tokenB = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenBAddr);

  const encA = await tokenA.confidentialBalanceOf(target);
  const encB = await tokenB.confidentialBalanceOf(target);

  console.log("Encrypted balance TokenA:", ethers.hexlify(encA));
  console.log("Encrypted balance TokenB:", ethers.hexlify(encB));

  // Decrypt using the signer who owns the private key of `target`.
  // Here signer0 is the deployer, which matches the provided target by default.
  const decA = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(encA), tokenAAddr, signer0);
  const decB = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(encB), tokenBAddr, signer0);

  console.log("Decrypted balance TokenA (clear):", decA);
  console.log("Decrypted balance TokenB (clear):", decB);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});



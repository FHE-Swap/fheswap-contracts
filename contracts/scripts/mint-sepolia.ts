import { ethers, fhevm } from "hardhat";

async function main() {
  const target = process.env.TO?.trim() || "0xd857e1E4E3c042B1cF0996E89A54C686bA87f8E2";
  const amount = BigInt(process.env.AMT || "1000");
  const tokenAAddr = process.env.TOKEN_A?.trim() || "0x174FAEb7FE5690366612E99058d6e0D2B388aCAD";
  const tokenBAddr = process.env.TOKEN_B?.trim() || "0x57085a2fC68473188e046F0Ea16A1075DD56D6f2";

  const [owner] = await ethers.getSigners();
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Owner:", owner.address);
  console.log("Target:", target);
  console.log("Amount:", amount.toString());
  console.log("TokenA:", tokenAAddr);
  console.log("TokenB:", tokenBAddr);

  await fhevm.initializeCLIApi();

  const tokenA = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenAAddr);
  const tokenB = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenBAddr);

  // Mint TokenA
  const encA = await fhevm.createEncryptedInput(tokenAAddr, owner.address).add64(Number(amount)).encrypt();
  const txA = await tokenA.connect(owner).mint(target, encA.handles[0], encA.inputProof);
  await txA.wait();
  console.log("Minted TokenA");

  // Mint TokenB
  const encB = await fhevm.createEncryptedInput(tokenBAddr, owner.address).add64(Number(amount)).encrypt();
  const txB = await tokenB.connect(owner).mint(target, encB.handles[0], encB.inputProof);
  await txB.wait();
  console.log("Minted TokenB");

  // Print encrypted balances (hex)
  const balAEnc = await tokenA.confidentialBalanceOf(target);
  const balBEnc = await tokenB.confidentialBalanceOf(target);
  console.log("Encrypted balance TokenA:", ethers.hexlify(balAEnc));
  console.log("Encrypted balance TokenB:", ethers.hexlify(balBEnc));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



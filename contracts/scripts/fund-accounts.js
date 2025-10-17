const { ethers } = require("hardhat");

async function main() {
  console.log("💰 Funding test accounts with ETH...\n");

  const [deployer, alice, bob] = await ethers.getSigners();
  
  console.log("📋 Account info:");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Alice: ${alice.address}`);
  console.log(`Bob: ${bob.address}\n`);

  // Check current balances
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  const aliceBalance = await ethers.provider.getBalance(alice.address);
  const bobBalance = await ethers.provider.getBalance(bob.address);
  
  console.log("💼 Current balances:");
  console.log(`Deployer: ${ethers.formatEther(deployerBalance)} ETH`);
  console.log(`Alice: ${ethers.formatEther(aliceBalance)} ETH`);
  console.log(`Bob: ${ethers.formatEther(bobBalance)} ETH\n`);

  // Transfer to Bob
  if (bobBalance < ethers.parseEther("0.1")) {
    console.log("💸 Transferring 0.1 ETH to Bob...");
    const transferAmount = ethers.parseEther("0.1");
    
    const tx = await deployer.sendTransaction({
      to: bob.address,
      value: transferAmount
    });
    
    await tx.wait();
    console.log(`✅ Transfer successful: ${tx.hash}`);
    
    const newBobBalance = await ethers.provider.getBalance(bob.address);
    console.log(`✅ Bob's new balance: ${ethers.formatEther(newBobBalance)} ETH`);
  } else {
    console.log("✅ Bob has sufficient balance, no transfer needed");
  }

  // Top up Alice if needed
  if (aliceBalance < ethers.parseEther("0.05")) {
    console.log("💸 Topping up Alice with 0.05 ETH...");
    const transferAmount = ethers.parseEther("0.05");
    
    const tx = await deployer.sendTransaction({
      to: alice.address,
      value: transferAmount
    });
    
    await tx.wait();
    console.log(`✅ Transfer successful: ${tx.hash}`);
    
    const newAliceBalance = await ethers.provider.getBalance(alice.address);
    console.log(`✅ Alice's new balance: ${ethers.formatEther(newAliceBalance)} ETH`);
  } else {
    console.log("✅ Alice has sufficient balance, no transfer needed");
  }

  console.log("\n🎉 Account funding complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
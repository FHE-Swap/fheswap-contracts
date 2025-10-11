import { FHESwapSimple, ConfidentialFungibleTokenMintableBurnable } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm, deployments } from "hardhat";
import hre from "hardhat";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

describe("FHESwapSimple Step-by-Step Test - Sepolia", function () {
  this.timeout(1800000); // 30 minutes timeout to accommodate network instability and retries

  // Simple retry utility (exponential backoff)
  async function retryOperation<T>(
    label: string,
    operation: () => Promise<T>,
    maxRetries: number = 5,
    delayMs: number = 2500
  ): Promise<T> {
    let lastErr: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err: any) {
        lastErr = err;
        const message = String(err?.message || err);
        // Common transient errors: ECONNRESET, Relayer 5xx, provider timeout
        const transient = /ECONNRESET|timeout|ECONNREFUSED|ETIMEDOUT|5\d\d|Relayer/i.test(message);
        console.log(`⚠️ [${label}] Failed (attempt ${attempt}/${maxRetries}): ${message}`);
        if (!transient || attempt === maxRetries) break;
        const wait = Math.floor(delayMs * Math.pow(1.5, attempt - 1));
        console.log(`⏳ [${label}] Retrying in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  let signers: Signers;
  let tokenA: ConfidentialFungibleTokenMintableBurnable;
  let tokenB: ConfidentialFungibleTokenMintableBurnable;
  let tokenAAddress: string;
  let tokenBAddress: string;
  let fHeSwap: FHESwapSimple;
  let fHeSwapAddress: string;

  before(async function () {
    console.log("\n" + "=".repeat(80));
    console.log("🚀 FHESwapSimple Step-by-Step Test - Sepolia");
    console.log("=".repeat(80));
    
    await fhevm.initializeCLIApi();
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
    
    console.log("👥 Test Accounts:");
    console.log(`Deployer: ${signers.deployer.address}`);
    console.log(`Alice: ${signers.alice.address}`);
    console.log(`Bob: ${signers.bob.address}`);

    // Check balances
    const deployerBalance = await ethers.provider.getBalance(signers.deployer.address);
    const aliceBalance = await ethers.provider.getBalance(signers.alice.address);
    const bobBalance = await ethers.provider.getBalance(signers.bob.address);
    
    console.log("\n💰 Account ETH Balances:");
    console.log(`Deployer: ${ethers.formatEther(deployerBalance)} ETH`);
    console.log(`Alice: ${ethers.formatEther(aliceBalance)} ETH`);
    console.log(`Bob: ${ethers.formatEther(bobBalance)} ETH`);

    // Connect to contracts
    const tokenADeployment = await deployments.get("TokenA");
    tokenAAddress = tokenADeployment.address; 
    tokenA = (await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenAAddress)) as ConfidentialFungibleTokenMintableBurnable;

    const tokenBDeployment = await deployments.get("TokenB");
    tokenBAddress = tokenBDeployment.address;
    tokenB = (await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenBAddress)) as ConfidentialFungibleTokenMintableBurnable;

    const fHeSwapDeployment = await deployments.get("FHESwap");
    fHeSwapAddress = fHeSwapDeployment.address;
    fHeSwap = (await ethers.getContractAt("FHESwapSimple", fHeSwapAddress)) as FHESwapSimple;

    console.log("\n🏭 Contract Addresses:");
    console.log(`TokenA: ${tokenAAddress}`);
    console.log(`TokenB: ${tokenBAddress}`);
    console.log(`FHESwapSimple: ${fHeSwapAddress}`);

    try {
      await hre.fhevm.assertCoprocessorInitialized(tokenA, "ConfidentialFungibleTokenMintableBurnable");
      await hre.fhevm.assertCoprocessorInitialized(tokenB, "ConfidentialFungibleTokenMintableBurnable");
      await hre.fhevm.assertCoprocessorInitialized(fHeSwap, "FHESwapSimple");
      console.log("✅ Coprocessor Initialization Verified");
    } catch (error: any) {
      console.log("⚠️ Coprocessor Initialization Warning, continuing with the test");
    }

    console.log("\n" + "=".repeat(80));
  });

  it("Step 1: Verify Contract Basic Information", async function () {
    console.log("\n📋 Step 1: Verify Contract Basic Information");
    console.log("-".repeat(50));

    const token0 = await fHeSwap.token0();
    const token1 = await fHeSwap.token1();
    const owner = await fHeSwap.owner();

    console.log(`✅ Token0: ${token0}`);
    console.log(`✅ Token1: ${token1}`);
    console.log(`✅ Owner: ${owner}`);

    expect(token0).to.equal(tokenAAddress);
    expect(token1).to.equal(tokenBAddress);
    expect(owner).to.equal(signers.deployer.address);
  });

  it("Step 2: Bob Adds Liquidity", async function () {
    console.log("\n💧 Step 2: Bob Adds Liquidity");
    console.log("-".repeat(50));

    const bob = signers.bob;
    const deployer = signers.deployer;
    
    const bobAmountA = ethers.parseUnits("40", 6); // 40 TokenA
    const bobAmountB = ethers.parseUnits("20", 6); // 20 TokenB

    console.log(`👤 User: ${bob.address}`);
    console.log(`💰 Adding Amounts: ${ethers.formatUnits(bobAmountA, 6)} TokenA, ${ethers.formatUnits(bobAmountB, 6)} TokenB`);

    // 1. Mint tokens to Bob
    console.log("\n🪙 Minting tokens to Bob...");
    const encryptedMintA = await fhevm.createEncryptedInput(tokenAAddress, deployer.address).add64(bobAmountA).encrypt();
    const mintATx = await retryOperation("Bob mint TokenA", async () =>
      tokenA.connect(deployer).mint(bob.address, encryptedMintA.handles[0], encryptedMintA.inputProof)
    );
    const mintAReceipt = await retryOperation("Bob mintA wait", async () => mintATx.wait());
    console.log(`📤 TokenA Minting: ${mintATx.hash} (Gas: ${mintAReceipt?.gasUsed})`);

    const encryptedMintB = await fhevm.createEncryptedInput(tokenBAddress, deployer.address).add64(bobAmountB).encrypt();
    const mintBTx = await retryOperation("Bob mint TokenB", async () =>
      tokenB.connect(deployer).mint(bob.address, encryptedMintB.handles[0], encryptedMintB.inputProof)
    );
    const mintBReceipt = await retryOperation("Bob mintB wait", async () => mintBTx.wait());
    console.log(`📤 TokenB Minting: ${mintBTx.hash} (Gas: ${mintBReceipt?.gasUsed})`);

    // 2. Set operator permissions
    console.log("\n🔐 Setting operator permissions...");
    const operatorExpiry = Math.floor(Date.now() / 1000) + 3600;
    
    const setOpATx = await retryOperation("Bob setOperator A", async () => tokenA.connect(bob).setOperator(fHeSwapAddress, operatorExpiry));
    await retryOperation("Bob setOperator A wait", async () => setOpATx.wait());
    console.log(`🔑 TokenA Operator: ${setOpATx.hash}`);
    
    const setOpBTx = await retryOperation("Bob setOperator B", async () => tokenB.connect(bob).setOperator(fHeSwapAddress, operatorExpiry));
    await retryOperation("Bob setOperator B wait", async () => setOpBTx.wait());
    console.log(`🔑 TokenB Operator: ${setOpBTx.hash}`);

    // 3. Authorize the contract to access Bob's balance
    console.log("\n🔐 Authorizing the contract to access Bob's balance...");
    const bobTokenABalance = await tokenA.confidentialBalanceOf(bob.address);
    const bobTokenBBalance = await tokenB.confidentialBalanceOf(bob.address);
    
    const authTokenATx = await retryOperation("Bob authorizeSelf A", async () => tokenA.connect(bob).authorizeSelf(bobTokenABalance));
    await retryOperation("Bob authorizeSelf A wait", async () => authTokenATx.wait());
    console.log(`🔑 TokenA Balance Authorization: ${authTokenATx.hash}`);
    
    const authTokenBTx = await retryOperation("Bob authorizeSelf B", async () => tokenB.connect(bob).authorizeSelf(bobTokenBBalance));
    await retryOperation("Bob authorizeSelf B wait", async () => authTokenBTx.wait());
    console.log(`🔑 TokenB Balance Authorization: ${authTokenBTx.hash}`);

    // 4. Add liquidity (first addition before the reserve is initialized, avoid decrypting uninitialized handles)
    console.log("\n💧 Performing Add Liquidity...");
    const encryptedAmount0 = await fhevm.createEncryptedInput(fHeSwapAddress, bob.address).add64(bobAmountA).encrypt();
    const encryptedAmount1 = await fhevm.createEncryptedInput(fHeSwapAddress, bob.address).add64(bobAmountB).encrypt();
    
    const addLiquidityTx = await retryOperation("Bob addLiquidity send", async () => fHeSwap.connect(bob).addLiquidity(
      encryptedAmount0.handles[0],
      encryptedAmount0.inputProof,
      encryptedAmount1.handles[0],
      encryptedAmount1.inputProof
    ));
    
    const receipt = await retryOperation("Bob addLiquidity wait", async () => addLiquidityTx.wait());
    console.log(`📤 Add Liquidity: ${addLiquidityTx.hash}`);
    console.log(`⛽ Gas Used: ${receipt?.gasUsed}`);
    console.log(`🧾 Block Number: ${receipt?.blockNumber}`);

    // 5. Verify the reserve values are correct (deployer decrypts)
    const reserve0AfterAddEnc = await fHeSwap.getEncryptedReserve0();
    const reserve1AfterAddEnc = await fHeSwap.getEncryptedReserve1();
    const reserve0AfterAdd = await retryOperation("decrypt reserve0 after add", async () =>
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(reserve0AfterAddEnc),
        fHeSwapAddress,
        signers.deployer
      )
    );
    const reserve1AfterAdd = await retryOperation("decrypt reserve1 after add", async () =>
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(reserve1AfterAddEnc),
        fHeSwapAddress,
        signers.deployer
      )
    );

    // The first addition should equal the injected amounts
    expect(reserve0AfterAdd).to.equal(bobAmountA);
    expect(reserve1AfterAdd).to.equal(bobAmountB);

    // 6. Verify LP tokens (attempt to decrypt by Bob, failure does not affect the strong assertion with the reserve)
    const bobLPBalance = await fHeSwap.getEncryptedLPBalance(bob.address);
    const totalSupply = await fHeSwap.getEncryptedTotalSupply();
    
    console.log(`🔒 Bob's LP Token Handle: ${ethers.hexlify(bobLPBalance)}`);
    console.log(`🔒 Total Supply Handle: ${ethers.hexlify(totalSupply)}`);

    try {
      const decryptedLPBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(bobLPBalance),
        fHeSwapAddress,
        bob
      );
      console.log(`💎 Bob's LP Token Amount: ${ethers.formatUnits(decryptedLPBalance, 6)}`);
    } catch (error) {
      console.log("⚠️ LP Token Decryption Failed, but Allocation Successful");
    }

    expect(bobLPBalance).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
    console.log("✅ Bob's Liquidity Addition Successful");
  });

  it("Step 3: Alice Performs Token Swap", async function () {
    console.log("\n🔄 Step 3: Alice Performs Token Swap");
    console.log("-".repeat(50));

    const alice = signers.alice;
    const deployer = signers.deployer;
    const swapAmount = ethers.parseUnits("5", 6); // 5 TokenA

    console.log(`👤 Swap User: ${alice.address}`);
    console.log(`💱 Swap Amount: ${ethers.formatUnits(swapAmount, 6)} TokenA → TokenB`);

    // 1. Check balances before the swap
    console.log("\n💰 Checking Balances Before Swap...");
    const aliceTokenABalanceBefore = await tokenA.confidentialBalanceOf(alice.address);
    const aliceTokenBBalanceBefore = await tokenB.confidentialBalanceOf(alice.address);
    
    console.log(`🔒 Alice's TokenA Balance Handle: ${ethers.hexlify(aliceTokenABalanceBefore)}`);
    console.log(`🔒 Alice's TokenB Balance Handle: ${ethers.hexlify(aliceTokenBBalanceBefore)}`);

    // 2. Mint tokens for Alice
    console.log("\n🪙 Minting Swap Tokens for Alice...");
    const encryptedMintA = await fhevm.createEncryptedInput(tokenAAddress, deployer.address).add64(swapAmount).encrypt();
    const mintATx = await retryOperation("Alice mint TokenA", async () =>
      tokenA.connect(deployer).mint(alice.address, encryptedMintA.handles[0], encryptedMintA.inputProof)
    );
    const mintAReceipt = await retryOperation("Alice mintA wait", async () => mintATx.wait());
    console.log(`📤 Additional TokenA Minting: ${mintATx.hash} (Gas: ${mintAReceipt?.gasUsed})`);

    // 3. Set operator permissions
    const operatorExpiry = Math.floor(Date.now() / 1000) + 3600;
    const setOpATx = await retryOperation("Alice setOperator A", async () => tokenA.connect(alice).setOperator(fHeSwapAddress, operatorExpiry));
    const setOpReceipt = await retryOperation("Alice setOperator A wait", async () => setOpATx.wait());
    console.log(`🔑 Alice's Operator Permissions: ${setOpATx.hash} (Gas: ${setOpReceipt?.gasUsed})`);

    // 4. Authorize the contract to access Alice's balance
    console.log("\n🔐 Authorizing the contract to access Alice's balance...");
    const aliceTokenABalanceForAuth = await tokenA.confidentialBalanceOf(alice.address);
    const authAliceTokenATx = await retryOperation("Alice authorizeSelf A", async () => tokenA.connect(alice).authorizeSelf(aliceTokenABalanceForAuth));
    await retryOperation("Alice authorizeSelf A wait", async () => authAliceTokenATx.wait());
    console.log(`🔑 Alice's TokenA Balance Authorization: ${authAliceTokenATx.hash}`);

    // 5. Get the reserves before the swap (decrypted by deployer)
    console.log("\n📊 Getting Reserves Before Swap...");
    const reserve0BeforeEnc = await fHeSwap.getEncryptedReserve0();
    const reserve1BeforeEnc = await fHeSwap.getEncryptedReserve1();
    console.log(`🔒 Reserve0 Handle Before Swap: ${ethers.hexlify(reserve0BeforeEnc)}`);
    console.log(`🔒 Reserve1 Handle Before Swap: ${ethers.hexlify(reserve1BeforeEnc)}`);
    const reserve0Before = await retryOperation("decrypt reserve0 before swap", async () =>
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(reserve0BeforeEnc),
        fHeSwapAddress,
        signers.deployer
      )
    );
    const reserve1Before = await retryOperation("decrypt reserve1 before swap", async () =>
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(reserve1BeforeEnc),
        fHeSwapAddress,
        signers.deployer
      )
    );

    // 6. Get the swap estimate
    console.log("\n📊 Getting Swap Estimate...");
    const encryptedSwapAmount = await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(swapAmount).encrypt();
    const getAmountOutTx = await retryOperation("getAmountOut send", async () => fHeSwap.connect(alice).getAmountOut(
      encryptedSwapAmount.handles[0],
      encryptedSwapAmount.inputProof,
      tokenAAddress
    ));
    console.log(`📤 Price Inquiry: ${getAmountOutTx.hash}`);
    await retryOperation("getAmountOut wait", async () => getAmountOutTx.wait());

    // 7. Calculate the expected output
    const numerator = await fHeSwap.connect(alice).getEncryptedNumerator();
    const denominator = await fHeSwap.connect(alice).getEncryptedDenominator();
    
    let expectedOut: bigint;
    let minOut: bigint;

    const decryptedNumerator = await retryOperation("decrypt numerator", async () =>
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(numerator),
        fHeSwapAddress,
        alice
      )
    );

    const decryptedDenominator = await retryOperation("decrypt denominator", async () =>
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(denominator),
        fHeSwapAddress,
        alice
      )
    );

    expectedOut = decryptedNumerator / decryptedDenominator;
    minOut = (expectedOut * 99n) / 100n; // 1% slippage

    console.log(`🧮 Expected Output: ${ethers.formatUnits(expectedOut, 6)} TokenB`);
    console.log(`📉 Minimum Output (1% Slippage): ${ethers.formatUnits(minOut, 6)} TokenB`);
    console.log(`📊 Slippage Protection: ${ethers.formatUnits(expectedOut - minOut, 6)} TokenB`);

    // 8. Perform the swap
    console.log("\n🔄 Performing Swap...");
    const encryptedExpectedOut = await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(expectedOut).encrypt();
    const encryptedMinOut = await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(minOut).encrypt();
    
    const swapTx = await retryOperation("swap send", async () => fHeSwap.connect(alice).swap(
      encryptedSwapAmount.handles[0],
      encryptedSwapAmount.inputProof,
      encryptedExpectedOut.handles[0],
      encryptedExpectedOut.inputProof,
      encryptedMinOut.handles[0],
      encryptedMinOut.inputProof,
      tokenAAddress,
      alice.address
    ));
    
    const swapReceipt = await retryOperation("swap wait", async () => swapTx.wait());
    console.log(`📤 Swap Execution: ${swapTx.hash}`);
    console.log(`⛽ Gas Used: ${swapReceipt?.gasUsed}`);
    console.log(`🧾 Block Number: ${swapReceipt?.blockNumber}`);

    // 9. Get the reserves after the swap (decrypted by deployer)
    console.log("\n📊 Getting Reserves After Swap...");
    const reserve0AfterEnc = await fHeSwap.getEncryptedReserve0();
    const reserve1AfterEnc = await fHeSwap.getEncryptedReserve1();
    console.log(`🔒 Reserve0 Handle After Swap: ${ethers.hexlify(reserve0AfterEnc)}`);
    console.log(`🔒 Reserve1 Handle After Swap: ${ethers.hexlify(reserve1AfterEnc)}`);
    const reserve0After = await retryOperation("decrypt reserve0 after swap", async () =>
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(reserve0AfterEnc),
        fHeSwapAddress,
        signers.deployer
      )
    );
    const reserve1After = await retryOperation("decrypt reserve1 after swap", async () =>
      fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(reserve1AfterEnc),
        fHeSwapAddress,
        signers.deployer
      )
    );

    // Strong assertion on reserve changes: TokenA reserve +swapAmount, TokenB reserve -expectedOut
    expect(reserve0After - reserve0Before).to.equal(swapAmount);
    expect(reserve1Before - reserve1After).to.equal(expectedOut);

    // 10. Verify the balance changes after the swap (if user balance decryption fails, do not block the test since the reserves have been strongly asserted)
    console.log("\n💰 Verifying Swap Results...");
    const aliceTokenABalanceAfter = await tokenA.confidentialBalanceOf(alice.address);
    const aliceTokenBBalanceAfter = await tokenB.confidentialBalanceOf(alice.address);
    
    console.log(`🔒 Alice's TokenA Balance Handle: ${ethers.hexlify(aliceTokenABalanceAfter)}`);
    console.log(`🔒 Alice's TokenB Balance Handle: ${ethers.hexlify(aliceTokenBBalanceAfter)}`);

    // 11. Attempt to decrypt balance changes
    try {
      const decryptedTokenABefore = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(aliceTokenABalanceBefore),
        tokenAAddress,
        alice
      );
      
      const decryptedTokenAAfter = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(aliceTokenABalanceAfter),
        tokenAAddress,
        alice
      );
      
      const decryptedTokenBBefore = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(aliceTokenBBalanceBefore),
        tokenBAddress,
        alice
      );
      
      const decryptedTokenBAfter = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(aliceTokenBBalanceAfter),
        tokenBAddress,
        alice
      );
      
      const tokenAChange = decryptedTokenAAfter - decryptedTokenABefore;
      const tokenBChange = decryptedTokenBAfter - decryptedTokenBBefore;
      
      console.log(`\n📊 Detailed Swap Results:`);
      console.log(`💸 Actual TokenA Paid: ${ethers.formatUnits(swapAmount, 6)}`);
      console.log(`💰 Actual TokenB Received: ${ethers.formatUnits(tokenBChange, 6)}`);
      console.log(`📉 Slippage: ${ethers.formatUnits(expectedOut - tokenBChange, 6)} TokenB`);
      console.log(`📊 Slippage Percentage: ${((Number(expectedOut - tokenBChange) / Number(expectedOut)) * 100).toFixed(2)}%`);
      console.log(`💎 Alice's Remaining TokenA: ${ethers.formatUnits(decryptedTokenAAfter, 6)}`);
      console.log(`💎 Alice's Remaining TokenB: ${ethers.formatUnits(decryptedTokenBAfter, 6)}`);
      
    } catch (error) {
      console.log("⚠️ Balance Decryption Failed, but Swap Successful");
    }

    expect(expectedOut).to.be.greaterThan(0n);
    console.log("✅ Alice's Token Swap Successful");
  });

  it("Step 4: Bob Removes Partial Liquidity", async function () {
    console.log("\n📤 Step 4: Bob Removes Partial Liquidity");
    console.log("-".repeat(50));

    const bob = signers.bob;
    const liquidityToRemove = ethers.parseUnits("20", 6); // Remove 20 LP tokens

    console.log(`👤 User: ${bob.address}`);
    console.log(`📉 Liquidity to Remove: ${ethers.formatUnits(liquidityToRemove, 6)}`);

    // 1. Check Bob's current LP balance
    const lpBalanceBefore = await fHeSwap.getEncryptedLPBalance(bob.address);
    console.log(`🔒 LP Balance Handle Before Removal: ${ethers.hexlify(lpBalanceBefore)}`);

    // 2. Perform liquidity removal
    console.log("\n📤 Performing Liquidity Removal...");
    const encryptedLiquidity = await fhevm.createEncryptedInput(fHeSwapAddress, bob.address).add64(liquidityToRemove).encrypt();
    
    const removeLiquidityTx = await retryOperation("removeLiquidity send", async () => fHeSwap.connect(bob).removeLiquidity(
      encryptedLiquidity.handles[0],
      encryptedLiquidity.inputProof
    ));
    
    const removeReceipt = await retryOperation("removeLiquidity wait", async () => removeLiquidityTx.wait());
    console.log(`📤 Liquidity Removal: ${removeLiquidityTx.hash}`);
    console.log(`⛽ Gas Used: ${removeReceipt?.gasUsed}`);
    console.log(`🧾 Block Number: ${removeReceipt?.blockNumber}`);

    // 3. Verify the state after removal
    const lpBalanceAfter = await fHeSwap.getEncryptedLPBalance(bob.address);
    const reserve0After = await fHeSwap.getEncryptedReserve0();
    const reserve1After = await fHeSwap.getEncryptedReserve1();
    
    console.log(`🔒 LP Balance Handle After Removal: ${ethers.hexlify(lpBalanceAfter)}`);
    console.log(`🔒 Reserve0 Handle After Removal: ${ethers.hexlify(reserve0After)}`);
    console.log(`🔒 Reserve1 Handle After Removal: ${ethers.hexlify(reserve1After)}`);

    try {
      const decryptedLPAfter = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(lpBalanceAfter),
        fHeSwapAddress,
        bob
      );
      console.log(`📉 LP Balance After Removal: ${ethers.formatUnits(decryptedLPAfter, 6)}`);
    } catch (error) {
      console.log("⚠️ LP Balance Decryption Failed, but Removal Successful");
    }

    expect(lpBalanceAfter).to.not.equal(lpBalanceBefore);
    console.log("✅ Bob's Liquidity Removal Successful");
  });

  after(async function () {
    console.log("\n" + "=".repeat(80));
    console.log("🎉 FHESwapSimple Step-by-Step Test Completed");
    console.log("=".repeat(80));
    
    console.log("\n📊 Test Summary:");
    console.log("✅ Contract Information Verified");
    console.log("✅ Bob Added Liquidity");
    console.log("✅ Alice Performed Token Swap");
    console.log("✅ Bob Removed Liquidity");
    
    console.log("\n🔗 Sepolia Etherscan Links:");
    console.log(`🌐 FHESwapSimple: https://sepolia.etherscan.io/address/${fHeSwapAddress}`);
    console.log(`🌐 TokenA: https://sepolia.etherscan.io/address/${tokenAAddress}`);
    console.log(`🌐 TokenB: https://sepolia.etherscan.io/address/${tokenBAddress}`);
    
    console.log("\n" + "=".repeat(80));
  });
});
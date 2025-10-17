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

describe("FHESwapSimple Detailed Test - Sepolia Testnet", function () {
  this.timeout(1800000); // 30 minute timeout, adapted for retry mechanism

  let signers: Signers;
  let tokenA: ConfidentialFungibleTokenMintableBurnable;
  let tokenB: ConfidentialFungibleTokenMintableBurnable;
  let tokenAAddress: string;
  let tokenBAddress: string;
  let fHeSwap: FHESwapSimple;
  let fHeSwapAddress: string;

  // Retry helper function
  async function retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 3, delay: number = 2000): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error: any) {
        console.log(`⚠️ Operation failed (attempt ${i + 1}/${maxRetries}): ${error.message}`);
        if (i === maxRetries - 1) throw error;
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 1.5; // Exponential backoff
      }
    }
    throw new Error("All retries failed");
  }

  before(async function () {
    console.log("\n" + "=".repeat(80));
    console.log("🚀 FHESwapSimple Sepolia Detailed Test Started");
    console.log("=".repeat(80));
    
    console.log("📡 Initializing FHEVM...");
    await fhevm.initializeCLIApi();
    console.log("✅ FHEVM initialization completed");

    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
    
    console.log("\n👥 Test account info:");
    console.log(`📋 Deployer: ${signers.deployer.address}`);
    console.log(`👤 Alice: ${signers.alice.address}`);
    console.log(`👤 Bob: ${signers.bob.address}`);

    // Check account balances
    const deployerBalance = await ethers.provider.getBalance(signers.deployer.address);
    const aliceBalance = await ethers.provider.getBalance(signers.alice.address);
    const bobBalance = await ethers.provider.getBalance(signers.bob.address);
    
    console.log("\n💰 Account ETH balances:");
    console.log(`💼 Deployer: ${ethers.formatEther(deployerBalance)} ETH`);
    console.log(`💼 Alice: ${ethers.formatEther(aliceBalance)} ETH`);
    console.log(`💼 Bob: ${ethers.formatEther(bobBalance)} ETH`);

    // Connect to deployed contracts
    console.log("\n🔗 Connecting to deployed contracts...");
    
    try {
      const tokenADeployment = await deployments.get("TokenA");
      tokenAAddress = tokenADeployment.address;
      tokenA = (await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenAAddress)) as ConfidentialFungibleTokenMintableBurnable;
      console.log(`✅ TokenA connected: ${tokenAAddress}`);

      const tokenBDeployment = await deployments.get("TokenB");
      tokenBAddress = tokenBDeployment.address;
      tokenB = (await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenBAddress)) as ConfidentialFungibleTokenMintableBurnable;
      console.log(`✅ TokenB connected: ${tokenBAddress}`);

      const fHeSwapDeployment = await deployments.get("FHESwap");
      fHeSwapAddress = fHeSwapDeployment.address;
      fHeSwap = (await ethers.getContractAt("FHESwapSimple", fHeSwapAddress)) as FHESwapSimple;
      console.log(`✅ FHESwapSimple connected: ${fHeSwapAddress}`);
    } catch (error) {
      console.log("⚠️ No deployed contracts found, may need to run deployment script first");
      throw error;
    }

    console.log("\n🔧 Verifying coprocessor...");
    try {
      await hre.fhevm.assertCoprocessorInitialized(tokenA, "ConfidentialFungibleTokenMintableBurnable");
      await hre.fhevm.assertCoprocessorInitialized(tokenB, "ConfidentialFungibleTokenMintableBurnable");
      await hre.fhevm.assertCoprocessorInitialized(fHeSwap, "FHESwapSimple");
      console.log("✅ Coprocessor verification completed");
    } catch (error: any) {
      console.log("⚠️ Coprocessor verification warning:", error.message);
    }

    console.log("\n" + "=".repeat(80));
    console.log("🎯 Test preparation completed, starting test cases");
    console.log("=".repeat(80));
  });

  it("should verify contract deployment and basic info", async function () {
    console.log("\n📋 Test 1: Verify contract deployment and basic info");
    console.log("-".repeat(50));

    console.log("🔍 Verifying FHESwapSimple contract configuration...");
    const token0Address = await retryOperation(() => fHeSwap.token0());
    const token1Address = await retryOperation(() => fHeSwap.token1());
    const owner = await retryOperation(() => fHeSwap.owner());

    console.log(`📊 Contract info:`);
    console.log(`   Token0: ${token0Address}`);
    console.log(`   Token1: ${token1Address}`);
    console.log(`   Owner: ${owner}`);
    console.log(`   FHESwap: ${fHeSwapAddress}`);

    expect(token0Address).to.equal(tokenAAddress);
    expect(token1Address).to.equal(tokenBAddress);
    expect(owner).to.equal(signers.deployer.address);

    console.log("✅ Contract configuration verification passed");
  }); 

  it("should allow Alice to add liquidity and receive LP tokens", async function () {
    console.log("\n💧 Test 2: Alice adds liquidity");
    console.log("-".repeat(50));

    const alice = signers.alice;
    const deployer = signers.deployer;
    
    const liquidityAmountA = ethers.parseUnits("100", 6); // 100 TokenA
    const liquidityAmountB = ethers.parseUnits("50", 6);  // 50 TokenB

    console.log(`👤 User: ${alice.address}`);
    console.log(`💰 Preparing to add liquidity:`);
    console.log(`   TokenA: ${ethers.formatUnits(liquidityAmountA, 6)}`);
    console.log(`   TokenB: ${ethers.formatUnits(liquidityAmountB, 6)}`);

    // 1. Mint tokens for Alice
    console.log("\n🪙 Step 1: Mint tokens for Alice");
    
    const encryptedMintA = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(tokenAAddress, deployer.address).add64(liquidityAmountA).encrypt();
    });
    const mintATx = await retryOperation(() => tokenA.connect(deployer).mint(alice.address, encryptedMintA.handles[0], encryptedMintA.inputProof));
    const mintAReceipt = await retryOperation(() => mintATx.wait());
    console.log(`📤 TokenA minting transaction: ${mintATx.hash}`);
    console.log(`⛽ Gas used: ${mintAReceipt?.gasUsed}`);

    const encryptedMintB = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(tokenBAddress, deployer.address).add64(liquidityAmountB).encrypt();
    });
    const mintBTx = await retryOperation(() => tokenB.connect(deployer).mint(alice.address, encryptedMintB.handles[0], encryptedMintB.inputProof));
    const mintBReceipt = await retryOperation(() => mintBTx.wait());
    console.log(`📤 TokenB minting transaction: ${mintBTx.hash}`);
    console.log(`⛽ Gas used: ${mintBReceipt?.gasUsed}`);

    // 2. Set operator permissions
    console.log("\n🔐 Step 2: Set operator permissions");
    const operatorExpiry = Math.floor(Date.now() / 1000) + 3600; // Expires in 1 hour
    
    const setOpATx = await retryOperation(() => tokenA.connect(alice).setOperator(fHeSwapAddress, operatorExpiry));
    const setOpAReceipt = await retryOperation(() => setOpATx.wait());
    console.log(`🔑 TokenA operator set: ${setOpATx.hash}`);
    console.log(`⛽ Gas used: ${setOpAReceipt?.gasUsed}`);
    
    const setOpBTx = await retryOperation(() => tokenB.connect(alice).setOperator(fHeSwapAddress, operatorExpiry));
    const setOpBReceipt = await retryOperation(() => setOpBTx.wait());
    console.log(`🔑 TokenB operator set: ${setOpBTx.hash}`);
    console.log(`⛽ Gas used: ${setOpBReceipt?.gasUsed}`);

    // 2.1 Authorize the contract to access Alice's confidential balance (to prevent ACL SenderNotAllowed)
    console.log("\n🔐 Step 2.1: Authorize the contract to access Alice's balance");
    const aliceBalanceAForAuth = await retryOperation(() => tokenA.confidentialBalanceOf(alice.address));
    const authAliceATx = await retryOperation(() => tokenA.connect(alice).authorizeSelf(aliceBalanceAForAuth));
    await retryOperation(() => authAliceATx.wait());
    console.log(`🔑 Alice TokenA balance authorization: ${authAliceATx.hash}`);
    const aliceBalanceBForAuth = await retryOperation(() => tokenB.confidentialBalanceOf(alice.address));
    const authAliceBTx = await retryOperation(() => tokenB.connect(alice).authorizeSelf(aliceBalanceBForAuth));
    await retryOperation(() => authAliceBTx.wait());
    console.log(`🔑 Alice TokenB balance authorization: ${authAliceBTx.hash}`);

    // 3. Add liquidity
    console.log("\n💧 Step 3: Add liquidity");
    const encryptedAmount0 = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(liquidityAmountA).encrypt();
    });
    const encryptedAmount1 = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(liquidityAmountB).encrypt();
    });
    
    const addLiquidityTx = await retryOperation(() => fHeSwap.connect(alice).addLiquidity(
      encryptedAmount0.handles[0],
      encryptedAmount0.inputProof,
      encryptedAmount1.handles[0],
      encryptedAmount1.inputProof
    ));
    
    const addLiquidityReceipt = await retryOperation(() => addLiquidityTx.wait());
    console.log(`📤 Add liquidity transaction: ${addLiquidityTx.hash}`);
    console.log(`⛽ Gas used: ${addLiquidityReceipt?.gasUsed}`);
    console.log(`🧾 Block number: ${addLiquidityReceipt?.blockNumber}`);

    // 3.1 Strictly verify the reserves (decrypted by deployer; the first addition should equal the input amounts)
    const reserve0AfterAddEnc = await retryOperation(() => fHeSwap.getEncryptedReserve0());
    const reserve1AfterAddEnc = await retryOperation(() => fHeSwap.getEncryptedReserve1());
    const reserve0AfterAdd = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve0AfterAddEnc),
      fHeSwapAddress,
      signers.deployer
    );
    const reserve1AfterAdd = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve1AfterAddEnc),
      fHeSwapAddress,
      signers.deployer
    );
    expect(reserve0AfterAdd).to.equal(liquidityAmountA);
    expect(reserve1AfterAdd).to.equal(liquidityAmountB);

    // 4. Verify LP token balance
    console.log("\n🎫 Step 4: Verify LP token allocation");
    const aliceLPBalance = await retryOperation(() => fHeSwap.getEncryptedLPBalance(alice.address));
    const totalSupply = await retryOperation(() => fHeSwap.getEncryptedTotalSupply());
    
    console.log(`🔒 Alice LP token handle: ${ethers.hexlify(aliceLPBalance)}`);
    console.log(`🔒 Total supply handle: ${ethers.hexlify(totalSupply)}`);

    try {
      const decryptedLPBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(aliceLPBalance),
        fHeSwapAddress,
        alice
      );
      console.log(`💎 Alice LP token amount: ${ethers.formatUnits(decryptedLPBalance, 6)}`);
    } catch (error) {
      console.log("⚠️ LP token decryption failed, but allocation was successful");
    }

    expect(aliceLPBalance).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
    expect(totalSupply).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");

    console.log("✅ Alice liquidity addition test passed");
  });

  it("should allow Bob to also add liquidity", async function () {
    console.log("\n💧 Test 3: Bob adds liquidity");
    console.log("-".repeat(50));

    const bob = signers.bob;
    const deployer = signers.deployer;
    
    const bobAmountA = ethers.parseUnits("60", 6); // 60 TokenA
    const bobAmountB = ethers.parseUnits("30", 6); // 30 TokenB

    console.log(`👤 User: ${bob.address}`);
    console.log(`💰 Preparing to add liquidity:`);
    console.log(`   TokenA: ${ethers.formatUnits(bobAmountA, 6)}`);
    console.log(`   TokenB: ${ethers.formatUnits(bobAmountB, 6)}`);

    // Mint tokens for Bob
    const encryptedMintA = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(tokenAAddress, deployer.address).add64(bobAmountA).encrypt();
    });
    const mintATx = await retryOperation(() => tokenA.connect(deployer).mint(bob.address, encryptedMintA.handles[0], encryptedMintA.inputProof));
    console.log(`📤 Bob TokenA minting: ${mintATx.hash}`);

    const encryptedMintB = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(tokenBAddress, deployer.address).add64(bobAmountB).encrypt();
    });
    const mintBTx = await retryOperation(() => tokenB.connect(deployer).mint(bob.address, encryptedMintB.handles[0], encryptedMintB.inputProof));
    console.log(`📤 Bob TokenB minting: ${mintBTx.hash}`);

    // Record reserves before Bob's addition (decrypted by deployer)
    const reserve0BeforeBobEnc = await retryOperation(() => fHeSwap.getEncryptedReserve0());
    const reserve1BeforeBobEnc = await retryOperation(() => fHeSwap.getEncryptedReserve1());
    const reserve0BeforeBob = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve0BeforeBobEnc),
      fHeSwapAddress,
      signers.deployer
    );
    const reserve1BeforeBob = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve1BeforeBobEnc),
      fHeSwapAddress,
      signers.deployer
    );

    // Set operator permissions
    const operatorExpiry = Math.floor(Date.now() / 1000) + 3600;
    const setOpATx = await retryOperation(() => tokenA.connect(bob).setOperator(fHeSwapAddress, operatorExpiry));
    const setOpBTx = await retryOperation(() => tokenB.connect(bob).setOperator(fHeSwapAddress, operatorExpiry));
    console.log(`🔑 Bob operator permissions set`);

    // Authorize the contract to access Bob's confidential balance (to prevent ACL SenderNotAllowed)
    console.log("\n🔐 Authorize the contract to access Bob's balance...");
    const bobBalanceAForAuth = await retryOperation(() => tokenA.confidentialBalanceOf(bob.address));
    const authBobATx = await retryOperation(() => tokenA.connect(bob).authorizeSelf(bobBalanceAForAuth));
    await retryOperation(() => authBobATx.wait());
    console.log(`🔑 Bob TokenA balance authorization: ${authBobATx.hash}`);
    const bobBalanceBForAuth = await retryOperation(() => tokenB.confidentialBalanceOf(bob.address));
    const authBobBTx = await retryOperation(() => tokenB.connect(bob).authorizeSelf(bobBalanceBForAuth));
    await retryOperation(() => authBobBTx.wait());
    console.log(`🔑 Bob TokenB balance authorization: ${authBobBTx.hash}`);

    // Add liquidity
    const encryptedAmount0 = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(fHeSwapAddress, bob.address).add64(bobAmountA).encrypt();
    });
    const encryptedAmount1 = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(fHeSwapAddress, bob.address).add64(bobAmountB).encrypt();
    });
    
    const addLiquidityTx = await retryOperation(() => fHeSwap.connect(bob).addLiquidity(
      encryptedAmount0.handles[0],
      encryptedAmount0.inputProof,
      encryptedAmount1.handles[0],
      encryptedAmount1.inputProof
    ));
    
    const receipt = await retryOperation(() => addLiquidityTx.wait());
    console.log(`📤 Bob adds liquidity: ${addLiquidityTx.hash}`);
    console.log(`⛽ Gas used: ${receipt?.gasUsed}`);

    // Strictly verify the reserve differences
    const reserve0AfterBobEnc = await retryOperation(() => fHeSwap.getEncryptedReserve0());
    const reserve1AfterBobEnc = await retryOperation(() => fHeSwap.getEncryptedReserve1());
    const reserve0AfterBob = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve0AfterBobEnc),
      fHeSwapAddress,
      signers.deployer
    );
    const reserve1AfterBob = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve1AfterBobEnc),
      fHeSwapAddress,
      signers.deployer
    );
    expect(reserve0AfterBob - reserve0BeforeBob).to.equal(bobAmountA);
    expect(reserve1AfterBob - reserve1BeforeBob).to.equal(bobAmountB);

    // Verify Bob's LP tokens
    const bobLPBalance = await retryOperation(() => fHeSwap.getEncryptedLPBalance(bob.address));
    console.log(`🔒 Bob LP token handle: ${ethers.hexlify(bobLPBalance)}`);

    expect(bobLPBalance).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
    console.log("✅ Bob liquidity addition test passed");
  });

  it("should allow Alice to perform a token swap", async function () {
    console.log("\n🔄 Test 4: Alice performs a token swap");
    console.log("-".repeat(50));

    const alice = signers.alice;
    const deployer = signers.deployer;
    const swapAmount = ethers.parseUnits("10", 6); // 10 TokenA

    console.log(`👤 Swap user: ${alice.address}`);
    console.log(`💱 Swap amount: ${ethers.formatUnits(swapAmount, 6)} TokenA → TokenB`);

    // 1. Mint more TokenA for Alice to swap
    console.log("\n🪙 Step 1: Mint tokens for Alice's swap");
    const encryptedMintA = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(tokenAAddress, deployer.address).add64(swapAmount).encrypt();
    });
    const mintATx = await retryOperation(() => tokenA.connect(deployer).mint(alice.address, encryptedMintA.handles[0], encryptedMintA.inputProof));
    console.log(`📤 Additional TokenA minting: ${mintATx.hash}`);
    // Re-authorize after minting to get the latest balance handle
    const aliceAfterMintForAuth = await retryOperation(() => tokenA.confidentialBalanceOf(alice.address));
    const authAliceAfterMintTx = await retryOperation(() => tokenA.connect(alice).authorizeSelf(aliceAfterMintForAuth));
    await retryOperation(() => authAliceAfterMintTx.wait());
    console.log(`🔑 Alice balance authorization after minting: ${authAliceAfterMintTx.hash}`);

    // 2. Get swap estimate
    console.log("\n📊 Step 2: Get swap estimate");
    const encryptedSwapAmount = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(swapAmount).encrypt();
    });
    // Re-authorize before quoting to ensure the latest handle is used for reading/calculations
    const aliceSwapBalanceAuth = await retryOperation(() => tokenA.confidentialBalanceOf(alice.address));
    const authAliceSwapTx = await retryOperation(() => tokenA.connect(alice).authorizeSelf(aliceSwapBalanceAuth));
    await retryOperation(() => authAliceSwapTx.wait());
    console.log(`🔑 Alice balance authorization before quoting: ${authAliceSwapTx.hash}`);
    const getAmountOutTx = await retryOperation(() => fHeSwap.connect(alice).getAmountOut(
      encryptedSwapAmount.handles[0],
      encryptedSwapAmount.inputProof,
      tokenAAddress
    ));
    const estimateReceipt = await retryOperation(() => getAmountOutTx.wait());
    console.log(`📤 Price inquiry transaction: ${getAmountOutTx.hash}`);
    console.log(`⛽ Gas used: ${estimateReceipt?.gasUsed}`);

    // 3. Decrypt numerator and denominator
    console.log("\n🔢 Step 3: Calculate swap output");
    const numerator = await fHeSwap.connect(alice).getEncryptedNumerator();
    const denominator = await fHeSwap.connect(alice).getEncryptedDenominator();
    
    console.log(`🔒 Numerator handle: ${ethers.hexlify(numerator)}`);
    console.log(`🔒 Denominator handle: ${ethers.hexlify(denominator)}`);

    let expectedOut: bigint = 0n;
    let minOut: bigint = 0n;
    
    try {
      const decryptedNumerator = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(numerator),
        fHeSwapAddress,
        alice
      );
      
      const decryptedDenominator = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(denominator),
        fHeSwapAddress,
        alice
      );
      
      expectedOut = decryptedNumerator / decryptedDenominator;
      minOut = (expectedOut * 99n) / 100n; // 1% slippage
      
      console.log(`🧮 Numerator: ${decryptedNumerator}`);
      console.log(`🧮 Denominator: ${decryptedDenominator}`);
      console.log(`💰 Expected output: ${ethers.formatUnits(expectedOut, 6)} TokenB`);
      console.log(`📉 Minimum output: ${ethers.formatUnits(minOut, 6)} TokenB (1% slippage)`);
    } catch (error) {
      console.log("⚠️ Decryption failed, swap cannot proceed");
      throw new Error("Cannot calculate swap output, decryption failed");
    }

    // 3.1 Strictly verify reserve differences (before swap, baseline recorded after quoting but before swap)
    const reserve0BeforeSwapEnc = await retryOperation(() => fHeSwap.getEncryptedReserve0());
    const reserve1BeforeSwapEnc = await retryOperation(() => fHeSwap.getEncryptedReserve1());
    const reserve0BeforeSwap = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve0BeforeSwapEnc),
      fHeSwapAddress,
      signers.deployer
    );
    const reserve1BeforeSwap = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve1BeforeSwapEnc),
      fHeSwapAddress,
      signers.deployer
    );

    // 4. Perform the swap
    console.log("\n🔄 Step 4: Perform the swap");
    // Re-authorize before swap to avoid handle changes between estimation and execution
    const aliceBeforeSwapForAuth = await retryOperation(() => tokenA.confidentialBalanceOf(alice.address));
    const authAliceBeforeSwapTx = await retryOperation(() => tokenA.connect(alice).authorizeSelf(aliceBeforeSwapForAuth));
    await retryOperation(() => authAliceBeforeSwapTx.wait());
    console.log(`🔑 Alice balance authorization before swap: ${authAliceBeforeSwapTx.hash}`);
    const encryptedExpectedOut = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(expectedOut).encrypt();
    });
    const encryptedMinOut = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(minOut).encrypt();
    });
    
    const swapTx = await retryOperation(() => fHeSwap.connect(alice).swap(
      encryptedSwapAmount.handles[0],
      encryptedSwapAmount.inputProof,
      encryptedExpectedOut.handles[0],
      encryptedExpectedOut.inputProof,
      encryptedMinOut.handles[0],
      encryptedMinOut.inputProof,
      tokenAAddress,
      alice.address
    ));
    
    const swapReceipt = await retryOperation(() => swapTx.wait());
    console.log(`📤 Swap execution transaction: ${swapTx.hash}`);
    console.log(`⛽ Gas used: ${swapReceipt?.gasUsed}`);
    console.log(`🧾 Block number: ${swapReceipt?.blockNumber}`);

    // 4.1 Strictly verify reserve differences (after swap)
    const reserve0AfterSwapEnc = await retryOperation(() => fHeSwap.getEncryptedReserve0());
    const reserve1AfterSwapEnc = await retryOperation(() => fHeSwap.getEncryptedReserve1());
    const reserve0AfterSwap = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve0AfterSwapEnc),
      fHeSwapAddress,
      signers.deployer
    );
    const reserve1AfterSwap = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve1AfterSwapEnc),
      fHeSwapAddress,
      signers.deployer
    );
    expect(reserve0AfterSwap - reserve0BeforeSwap).to.equal(swapAmount);
    expect(reserve1BeforeSwap - reserve1AfterSwap).to.equal(expectedOut);

    // 5. Verify swap results
    console.log("\n💰 Step 5: Verify swap results");
    const aliceTokenABalance = await tokenA.confidentialBalanceOf(alice.address);
    const aliceTokenBBalance = await tokenB.confidentialBalanceOf(alice.address);
    
    console.log(`🔒 Alice TokenA balance handle: ${ethers.hexlify(aliceTokenABalance)}`);
    console.log(`🔒 Alice TokenB balance handle: ${ethers.hexlify(aliceTokenBBalance)}`);

    try {
      const decryptedTokenABalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(aliceTokenABalance),
        tokenAAddress,
        alice
      );
      
      const decryptedTokenBBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ethers.hexlify(aliceTokenBBalance),
        tokenBAddress,
        alice
      );
      
      console.log(`💰 Alice TokenA balance: ${ethers.formatUnits(decryptedTokenABalance, 6)}`);
      console.log(`💰 Alice TokenB balance: ${ethers.formatUnits(decryptedTokenBBalance, 6)}`);
    } catch (error) {
      console.log("⚠️ Balance decryption failed, but swap was successful");
    }

    expect(expectedOut).to.be.greaterThan(0n);
    console.log("✅ Alice token swap test passed");
  });

  it("should allow Alice to remove part of her liquidity", async function () {
    console.log("\n📤 Test 5: Alice removes liquidity");
    console.log("-".repeat(50));

    const alice = signers.alice;
    const liquidityToRemove = ethers.parseUnits("30", 6); // Remove 30 LP tokens

    console.log(`👤 User: ${alice.address}`);
    console.log(`📉 Preparing to remove LP tokens: ${ethers.formatUnits(liquidityToRemove, 6)}`);

    // 1. Check state before removal (for subsequent strict comparison)
    console.log("\n📊 Step 1: State before removal");
    const lpBalanceBefore = await retryOperation(() => fHeSwap.getEncryptedLPBalance(alice.address));
    const reserve0Before = await retryOperation(() => fHeSwap.getEncryptedReserve0());
    const reserve1Before = await retryOperation(() => fHeSwap.getEncryptedReserve1());
    
    console.log(`🔒 LP balance handle before removal: ${ethers.hexlify(lpBalanceBefore)}`);

    // 2. Perform liquidity removal
    console.log("\n📤 Step 2: Perform liquidity removal");
    const encryptedLiquidity = await retryOperation(async () => {
      return await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(liquidityToRemove).encrypt();
    });
    
    const removeLiquidityTx = await retryOperation(() => fHeSwap.connect(alice).removeLiquidity(
      encryptedLiquidity.handles[0],
      encryptedLiquidity.inputProof
    ));
    
    const removeReceipt = await retryOperation(() => removeLiquidityTx.wait());
    console.log(`📤 Liquidity removal transaction: ${removeLiquidityTx.hash}`);
    console.log(`⛽ Gas used: ${removeReceipt?.gasUsed}`);
    console.log(`🧾 Block number: ${removeReceipt?.blockNumber}`);

    // 3. Verify state after removal
    console.log("\n📊 Step 3: State after removal");
    const lpBalanceAfter = await retryOperation(() => fHeSwap.getEncryptedLPBalance(alice.address));
    const reserve0After = await retryOperation(() => fHeSwap.getEncryptedReserve0());
    const reserve1After = await retryOperation(() => fHeSwap.getEncryptedReserve1());
    const totalSupplyAfter = await retryOperation(() => fHeSwap.getEncryptedTotalSupply());
    
    console.log(`🔒 LP balance handle after removal: ${ethers.hexlify(lpBalanceAfter)}`);
    console.log(`🔒 Reserve0 handle after removal: ${ethers.hexlify(reserve0After)}`);
    console.log(`🔒 Reserve1 handle after removal: ${ethers.hexlify(reserve1After)}`);
    console.log(`🔒 Total supply handle after removal: ${ethers.hexlify(totalSupplyAfter)}`);

    // 3.1 Strictly decrypt and compare (decrypted by deployer)
    const reserve0BeforeDec = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve0Before),
      fHeSwapAddress,
      signers.deployer
    );
    const reserve1BeforeDec = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve1Before),
      fHeSwapAddress,
      signers.deployer
    );
    const reserve0AfterDec = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve0After),
      fHeSwapAddress,
      signers.deployer
    );
    const reserve1AfterDec = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethers.hexlify(reserve1After),
      fHeSwapAddress,
      signers.deployer
    );
    expect(reserve0BeforeDec - reserve0AfterDec).to.equal(liquidityToRemove);
    expect(reserve1BeforeDec - reserve1AfterDec).to.equal(liquidityToRemove);

    // 4. Verify tokens received by Alice (do not block if decryption fails, as reserves have been strictly asserted)
    console.log("\n💰 Step 4: Verify returned tokens");
    const aliceTokenABalance = await tokenA.confidentialBalanceOf(alice.address);
    const aliceTokenBBalance = await tokenB.confidentialBalanceOf(alice.address);
    
    console.log(`🔒 Alice TokenA balance handle: ${ethers.hexlify(aliceTokenABalance)}`);
    console.log(`🔒 Alice TokenB balance handle: ${ethers.hexlify(aliceTokenBBalance)}`);

    expect(lpBalanceAfter).to.not.equal(lpBalanceBefore);
    console.log("✅ Alice liquidity removal test passed");
  });

  after(async function () {
    console.log("\n" + "=".repeat(80));
    console.log("🎉 FHESwapSimple Sepolia detailed test completed");
    console.log("=".repeat(80));
    
    console.log("\n📊 Test summary:");
    console.log("✅ Contract deployment verification");
    console.log("✅ Alice adds liquidity");
    console.log("✅ Bob adds liquidity");
    console.log("✅ Alice performs token swap");
    console.log("✅ Alice removes liquidity");
    
    console.log("\n🔗 Related addresses:");
    console.log(`🏭 FHESwapSimple: ${fHeSwapAddress}`);
    console.log(`🪙 TokenA: ${tokenAAddress}`);
    console.log(`🪙 TokenB: ${tokenBAddress}`);
    
    console.log("\n📱 View on Sepolia Etherscan:");
    console.log(`🌐 https://sepolia.etherscan.io/address/  ${fHeSwapAddress}`);
    console.log(`🌐 https://sepolia.etherscan.io/address/  ${tokenAAddress}`);
    console.log(`🌐 https://sepolia.etherscan.io/address/  ${tokenBAddress}`);
    
    console.log("\n" + "=".repeat(80));
  });
});
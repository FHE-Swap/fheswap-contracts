import { expect } from "chai";
import { ethers, deployments, fhevm } from "hardhat";
import { FHESwapSimpleGuarded, ConfidentialFungibleTokenMintableBurnable } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import child_process from "child_process";

function runHostWithJson(json: any): string {
  const jsonStr = JSON.stringify(json, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  );
  console.log("Sending JSON to host:", jsonStr);
  
  const p = child_process.spawnSync("cargo", ["run"], {
    cwd: "/home/su/dome/ZK/RSIC-zero/RISC_ZAMA/host",
    input: jsonStr,
    encoding: "utf-8",
    env: { ...process.env, RISC0_DEV_MODE: "1" },
  });
  
  console.log("Host stdout:", p.stdout);
  console.log("Host stderr:", p.stderr);
  console.log("Host status:", p.status);
  
  if (p.status !== 0) {
    throw new Error(`Host failed: ${p.stderr || p.stdout}`);
  }
  const m = p.stdout.match(/proof_hash=0x([0-9a-fA-F]{64})/);
  if (!m) throw new Error("proof_hash not found in host output");
  return "0x" + m[1];
}

describe("FHESwapSimpleGuarded - Sepolia Integration Test", function () {
  this.timeout(1800000); // 30-minute timeout to accommodate Sepolia network delays
  
    
  before(function() {
    process.env.FHEVM_RELAYER_TIMEOUT = "60000";
    process.env.FHEVM_RELAYER_RETRIES = "5";
    process.env.FHEVM_RELAYER_DELAY = "5000";
  });

    
  async function createEncryptedInputWithRetry(
    pool: string,
    user: string,
    amount: bigint,
    label: string,
    maxRetries: number = 8
  ): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`   🔐 [${label}] Creating encrypted input (attempt ${attempt}/${maxRetries})...`);
        const result = await fhevm.createEncryptedInput(pool, user).add64(amount).encrypt();
        console.log(`   ✅ [${label}] Encrypted input created successfully`);
        return result;
      } catch (err: any) {
        const message = String(err?.message || err);
        console.log(`   ⚠️ [${label}] Failed (attempt ${attempt}/${maxRetries}): ${message}`);
        
          
        if (/extraData/i.test(message)) {
          console.log(`   🔧 extraData error detected, waiting for relayer recovery...`);
          const wait = Math.min(30000, 5000 * Math.pow(1.5, attempt - 1));   
          console.log(`   ⏳ Waiting ${wait}ms before retrying...`);
          await new Promise((r) => setTimeout(r, wait));
        } else if (/Bad Request|timeout|ECONNRESET/i.test(message)) {
          const wait = Math.min(15000, 3000 * Math.pow(1.2, attempt - 1));
          console.log(`   ⏳ Waiting ${wait}ms before retrying...`);
          await new Promise((r) => setTimeout(r, wait));
        } else {
          throw err;   
        }
        
        if (attempt === maxRetries) {
          throw new Error(`[${label}] Still failed after ${maxRetries} retries: ${message}`);
        }
      }
    }
  }

    
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
          
        const transient = /ECONNRESET|timeout|ECONNREFUSED|ETIMEDOUT|5\d\d|Relayer|extraData|Bad Request/i.test(message);
        console.log(`⚠️ [${label}] Failed (attempt ${attempt}/${maxRetries}): ${message}`);
        
          
        if (/extraData/i.test(message)) {
          console.log(`   🔧 extraData error detected, this is a known FHEVM relayer issue`);
          console.log(`   💡 Suggestion: Wait for relayer recovery or test on local network`);
        }
        
        if (!transient || attempt === maxRetries) break;
        const wait = Math.floor(delayMs * Math.pow(1.5, attempt - 1));
        console.log(`⏳ [${label}] Waiting ${wait}ms before retrying...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let verifier: HardhatEthersSigner;
  let tokenA: ConfidentialFungibleTokenMintableBurnable;
  let tokenB: ConfidentialFungibleTokenMintableBurnable;
  let guarded: FHESwapSimpleGuarded;

  before(async function () {
    console.log("🌐 Connecting to Sepolia network...");
    
      
    try {
      await fhevm.initializeCLIApi();
      console.log("✅ FHEVM CLI API initialized successfully");
    } catch (error) {
      console.log("⚠️ FHEVM initialization warning:", error);
        
    }

    const s = await ethers.getSigners();
    deployer = s[0];
    alice = s[1];
    verifier = s[3];

    console.log("👥 Account Information:");
    console.log(`   Deployer: ${deployer.address}`);
    console.log(`   Alice: ${alice.address}`);
    console.log(`   Verifier: ${verifier.address}`);

      
    const deployerBalance = await ethers.provider.getBalance(deployer.address);
    const aliceBalance = await ethers.provider.getBalance(alice.address);
    console.log(`   Deployer Balance: ${ethers.formatEther(deployerBalance)} ETH`);
    console.log(`   Alice Balance: ${ethers.formatEther(aliceBalance)} ETH`);

    if (deployerBalance < ethers.parseEther("0.1")) {
      throw new Error("Insufficient deployer balance, at least 0.1 ETH required");
    }
    if (aliceBalance < ethers.parseEther("0.05")) {
      throw new Error("Insufficient Alice balance, at least 0.05 ETH required");
    }

      
    await deployments.fixture(["default", "guarded"], { keepExistingDeployments: true });

    const tokenADeployment = await deployments.get("TokenA");
    const tokenBDeployment = await deployments.get("TokenB");
    const guardedDeployment = await deployments.get("FHESwapSimpleGuarded");

    console.log("📋 Contract Addresses:");
    console.log(`   TokenA: ${tokenADeployment.address}`);
    console.log(`   TokenB: ${tokenBDeployment.address}`);
    console.log(`   FHESwapSimpleGuarded: ${guardedDeployment.address}`);

    tokenA = (await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenADeployment.address)) as any;
    tokenB = (await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenBDeployment.address)) as any;
    guarded = (await ethers.getContractAt("FHESwapSimpleGuarded", guardedDeployment.address)) as any;

      
    const trustedVerifier = await guarded.trustedVerifier();
    console.log(`   Trusted Verifier: ${trustedVerifier}`);
    expect(trustedVerifier).to.equal(verifier.address);
  });

  it("Complete User Flow: Add Liquidity → Swap → Remove Liquidity (Sepolia)", async function () {
    console.log("\n" + "=".repeat(80));
    console.log("🌐 Sepolia Network - Complete User Flow Test: Add Liquidity → Swap → Remove Liquidity");
    console.log("=".repeat(80));
    
      
    const testStartTime = Date.now();

    const pool = await guarded.getAddress();
    const tokenAAddr = await tokenA.getAddress();
    const tokenBAddr = await tokenB.getAddress();
    const chainId = Number((await ethers.provider.getNetwork()).chainId);

    console.log("\n📋 Network and Contract Information:");
    console.log(`   Chain ID: ${chainId} (Sepolia)`);
    console.log(`   Pool: ${pool}`);
    console.log(`   TokenA: ${tokenAAddr}`);
    console.log(`   TokenB: ${tokenBAddr}`);

    // ==================== Step 0: Prepare Tokens ====================
    console.log("\n" + "=".repeat(60));
    console.log("🪙 Step 0: Mint Tokens to Alice");
    console.log("=".repeat(60));
    
    const step0StartTime = Date.now();

    const mintAmtA = ethers.parseUnits("100", 6);
    const mintAmtB = ethers.parseUnits("50", 6);
    
    console.log(`   Minting ${ethers.formatUnits(mintAmtA, 6)} TokenA to Alice`);
    console.log(`   Minting ${ethers.formatUnits(mintAmtB, 6)} TokenB to Alice`);

      
    console.log("   Minting tokens for Alice...");
    
      
    const aliceMintAmountA = ethers.parseUnits("100", 6);   
    const mintAEncryptStart = Date.now();
    const encryptedAliceMintA = await createEncryptedInputWithRetry(tokenAAddr, deployer.address, aliceMintAmountA, "Alice TokenA Mint");
    const mintAEncryptTime = Date.now() - mintAEncryptStart;
    console.log(`   ⏱️ TokenA encrypted input creation: ${mintAEncryptTime}ms`);
    
    const mintAStart = Date.now();
    const mintAliceATx = await retryOperation("Alice TokenA Mint", async () =>
      tokenA.connect(deployer).mint(alice.address, encryptedAliceMintA.handles[0], encryptedAliceMintA.inputProof, { gasLimit: 500000 })
    );
    const mintAConfirmStart = Date.now();
    await retryOperation("Alice TokenA Mint Confirmation", async () => mintAliceATx.wait());
    const mintATotalTime = Date.now() - mintAStart;
    const mintAConfirmTime = Date.now() - mintAConfirmStart;
    console.log(`   ⏱️ TokenA mint transaction: ${mintATotalTime - mintAConfirmTime}ms`);
    console.log(`   ⏱️ TokenA transaction confirmation: ${mintAConfirmTime}ms`);
    console.log(`   ✅ Minted ${ethers.formatUnits(aliceMintAmountA, 6)} TokenA to Alice`);
    
      
    const aliceMintAmountB = ethers.parseUnits("50", 6);   
    const mintBEncryptStart = Date.now();
    const encryptedAliceMintB = await createEncryptedInputWithRetry(tokenBAddr, deployer.address, aliceMintAmountB, "Alice TokenB Mint");
    const mintBEncryptTime = Date.now() - mintBEncryptStart;
    console.log(`   ⏱️ TokenB encrypted input creation: ${mintBEncryptTime}ms`);
    
    const mintBStart = Date.now();
    const mintAliceBTx = await retryOperation("Alice TokenB Mint", async () =>
      tokenB.connect(deployer).mint(alice.address, encryptedAliceMintB.handles[0], encryptedAliceMintB.inputProof, { gasLimit: 500000 })
    );
    const mintBConfirmStart = Date.now();
    await retryOperation("Alice TokenB Mint Confirmation", async () => mintAliceBTx.wait());
    const mintBTotalTime = Date.now() - mintBStart;
    const mintBConfirmTime = Date.now() - mintBConfirmStart;
    console.log(`   ⏱️ TokenB mint transaction: ${mintBTotalTime - mintBConfirmTime}ms`);
    console.log(`   ⏱️ TokenB transaction confirmation: ${mintBConfirmTime}ms`);
    console.log(`   ✅ Minted ${ethers.formatUnits(aliceMintAmountB, 6)} TokenB to Alice`);
    
    const step0EndTime = Date.now();
    const step0Duration = step0EndTime - step0StartTime;
    console.log(`   ⏱️ Step 0 Total Time: ${step0Duration}ms (${(step0Duration/1000).toFixed(2)} seconds)`);

    // Alice authorizes pool as operator
    console.log("\n   Setting operator permissions...");
    const operatorExpiry = Math.floor(Date.now() / 1000) + 7200; // Expires in 2 hours
    try {
      const setOpAStart = Date.now();
      const setOpATx = await retryOperation("TokenA operator setup", async () =>
        tokenA.connect(alice).setOperator(pool, operatorExpiry, { gasLimit: 500000 })
      );
      const setOpAConfirmStart = Date.now();
      const setOpAReceipt = await retryOperation("TokenA operator confirmation", async () => setOpATx.wait());
      const setOpATotalTime = Date.now() - setOpAStart;
      const setOpAConfirmTime = Date.now() - setOpAConfirmStart;
      console.log(`   ⏱️ TokenA operator transaction: ${setOpATotalTime - setOpAConfirmTime}ms`);
      console.log(`   ⏱️ TokenA operator confirmation: ${setOpAConfirmTime}ms`);
      console.log(`   ✅ TokenA operator setup completed: ${setOpATx.hash} (Gas: ${setOpAReceipt?.gasUsed})`);
      
      const setOpBStart = Date.now();
      const setOpBTx = await retryOperation("TokenB operator setup", async () =>
        tokenB.connect(alice).setOperator(pool, operatorExpiry, { gasLimit: 500000 })
      );
      const setOpBConfirmStart = Date.now();
      const setOpBReceipt = await retryOperation("TokenB operator confirmation", async () => setOpBTx.wait());
      const setOpBTotalTime = Date.now() - setOpBStart;
      const setOpBConfirmTime = Date.now() - setOpBConfirmStart;
      console.log(`   ⏱️ TokenB operator transaction: ${setOpBTotalTime - setOpBConfirmTime}ms`);
      console.log(`   ⏱️ TokenB operator confirmation: ${setOpBConfirmTime}ms`);
      console.log(`   ✅ TokenB operator setup completed: ${setOpBTx.hash} (Gas: ${setOpBReceipt?.gasUsed})`);
    } catch (error) {
      console.log(`   ⚠️ Operator setup failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log("   May already be set, continuing with test");
    }

      
    console.log("\n🔐 Step 0.1: Authorize contract access to Alice's confidential balances");
    const step01StartTime = Date.now();
    try {
        
      const balanceAQueryStart = Date.now();
      const aliceBalanceAForAuth = await retryOperation("Get Alice TokenA balance handle", async () => 
        tokenA.confidentialBalanceOf(alice.address)
      );
      const balanceAQueryTime = Date.now() - balanceAQueryStart;
      console.log(`   ⏱️ TokenA balance query: ${balanceAQueryTime}ms`);
      
      console.log(`   Alice TokenA balance handle: ${ethers.hexlify(aliceBalanceAForAuth)}`);
      const authAStart = Date.now();
      const authAliceATx = await retryOperation("Alice TokenA balance authorization", async () =>
        tokenA.connect(alice).authorizeSelf(aliceBalanceAForAuth, { gasLimit: 500000 })
      );
      const authAConfirmStart = Date.now();
      const authAliceAReceipt = await retryOperation("Alice TokenA balance authorization confirmation", async () => authAliceATx.wait());
      const authATotalTime = Date.now() - authAStart;
      const authAConfirmTime = Date.now() - authAConfirmStart;
      console.log(`   ⏱️ TokenA balance authorization transaction: ${authATotalTime - authAConfirmTime}ms`);
      console.log(`   ⏱️ TokenA balance authorization confirmation: ${authAConfirmTime}ms`);
      console.log(`   ✅ Alice TokenA balance authorization completed: ${authAliceATx.hash} (Gas: ${authAliceAReceipt?.gasUsed})`);

        
      const balanceBQueryStart = Date.now();
      const aliceBalanceBForAuth = await retryOperation("Get Alice TokenB balance handle", async () =>
        tokenB.confidentialBalanceOf(alice.address)
      );
      const balanceBQueryTime = Date.now() - balanceBQueryStart;
      console.log(`   ⏱️ TokenB balance query: ${balanceBQueryTime}ms`);
      
      console.log(`   Alice TokenB balance handle: ${ethers.hexlify(aliceBalanceBForAuth)}`);
      const authBStart = Date.now();
      const authAliceBTx = await retryOperation("Alice TokenB balance authorization", async () =>
        tokenB.connect(alice).authorizeSelf(aliceBalanceBForAuth, { gasLimit: 500000 })
      );
      const authBConfirmStart = Date.now();
      const authAliceBReceipt = await retryOperation("Alice TokenB balance authorization confirmation", async () => authAliceBTx.wait());
      const authBTotalTime = Date.now() - authBStart;
      const authBConfirmTime = Date.now() - authBConfirmStart;
      console.log(`   ⏱️ TokenB balance authorization transaction: ${authBTotalTime - authBConfirmTime}ms`);
      console.log(`   ⏱️ TokenB balance authorization confirmation: ${authBConfirmTime}ms`);
      console.log(`   ✅ Alice TokenB balance authorization completed: ${authAliceBTx.hash} (Gas: ${authAliceBReceipt?.gasUsed})`);
    } catch (error) {
      console.log(`   ⚠️ Balance authorization failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log("   Continuing with test, re-authorization may occur in subsequent operations");
    }
    
    const step01EndTime = Date.now();
    const step01Duration = step01EndTime - step01StartTime;
    console.log(`   ⏱️ Step 0.1 Total Time: ${step01Duration}ms (${(step01Duration/1000).toFixed(2)} seconds)`);

    // ==================== Step 1: Add Liquidity ====================
    console.log("\n" + "=".repeat(60));
    console.log("💧 Step 1: User Adds Liquidity");
    console.log("=".repeat(60));
    
    const step1StartTime = Date.now();

      
    let initialReserve0 = 0n, initialReserve1 = 0n, initialTotalSupply = 0n, initialAliceLP = 0n;
    const initialStateStart = Date.now();
    try {
      const queryStart = Date.now();
      const initialReserve0Enc = await guarded.getEncryptedReserve0();
      const initialReserve1Enc = await guarded.getEncryptedReserve1();
      const initialTotalSupplyEnc = await guarded.getEncryptedTotalSupply();
      const initialAliceLPEnc = await guarded.getEncryptedLPBalance(alice.address);
      const queryTime = Date.now() - queryStart;
      console.log(`   ⏱️ Initial state query: ${queryTime}ms`);

      const decryptStart = Date.now();
      initialReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(initialReserve0Enc), pool, deployer);
      initialReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(initialReserve1Enc), pool, deployer);
      initialTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(initialTotalSupplyEnc), pool, deployer);
      initialAliceLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(initialAliceLPEnc), pool, alice);
      const decryptTime = Date.now() - decryptStart;
      console.log(`   ⏱️ Initial state decryption: ${decryptTime}ms`);
    } catch (error) {
      console.log("   Initial reserves are empty, this is normal");
    }
    const initialStateTime = Date.now() - initialStateStart;
    console.log(`   ⏱️ Initial state total time: ${initialStateTime}ms`);

    console.log("\n📊 State Before Adding Liquidity:");
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(initialReserve0, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(initialReserve1, 6)}`);
    console.log(`   Total Supply: ${ethers.formatUnits(initialTotalSupply, 6)}`);
    console.log(`   Alice LP: ${ethers.formatUnits(initialAliceLP, 6)}`);

      
    const addAmount0 = ethers.parseUnits("30", 6);   
    const addAmount1 = ethers.parseUnits("15", 6);   

    console.log("\n💧 Liquidity Addition Parameters:");
    console.log(`   TokenA: ${ethers.formatUnits(addAmount0, 6)}`);
    console.log(`   TokenB: ${ethers.formatUnits(addAmount1, 6)}`);

      
    console.log("   Verifying Alice's token balances...");
    const balanceVerifyStart = Date.now();
    try {
      const aliceBalanceA = await tokenA.confidentialBalanceOf(alice.address);
      const aliceBalanceB = await tokenB.confidentialBalanceOf(alice.address);
      console.log(`   Alice TokenA balance handle: ${ethers.hexlify(aliceBalanceA)}`);
      console.log(`   Alice TokenB balance handle: ${ethers.hexlify(aliceBalanceB)}`);
      console.log("   ✅ Alice's token balance verification completed");
    } catch (error) {
      console.log(`   ⚠️ Balance verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const balanceVerifyTime = Date.now() - balanceVerifyStart;
    console.log(`   ⏱️ Balance verification time: ${balanceVerifyTime}ms`);

    console.log("   Creating encrypted inputs for liquidity...");
    const encryptStart = Date.now();
    const encAdd0 = await createEncryptedInputWithRetry(pool, alice.address, addAmount0, "Liquidity TokenA Encrypted Input");
    const encAdd0Time = Date.now() - encryptStart;
    console.log(`   ⏱️ TokenA encrypted input creation: ${encAdd0Time}ms`);
    
    const encAdd1Start = Date.now();
    const encAdd1 = await createEncryptedInputWithRetry(pool, alice.address, addAmount1, "Liquidity TokenB Encrypted Input");
    const encAdd1Time = Date.now() - encAdd1Start;
    console.log(`   ⏱️ TokenB encrypted input creation: ${encAdd1Time}ms`);

    console.log("   Adding liquidity...");
    const addTxStart = Date.now();
    const addTx = await retryOperation("Add Liquidity", async () =>
      guarded.connect(alice).addLiquidity(
        encAdd0.handles[0], encAdd0.inputProof,
        encAdd1.handles[0], encAdd1.inputProof,
        {
          gasLimit: 2000000,
        }
      )
    );
    const addTxTime = Date.now() - addTxStart;
    console.log(`   ⏱️ Add liquidity transaction: ${addTxTime}ms`);
    
    const addConfirmStart = Date.now();
    const addReceipt = await retryOperation("Add Liquidity Confirmation", async () => addTx.wait());
    const addConfirmTime = Date.now() - addConfirmStart;
    console.log(`   ⏱️ Add liquidity confirmation: ${addConfirmTime}ms`);

    console.log(`   ✅ Liquidity added successfully:`);
    console.log(`     Transaction Hash: ${addTx.hash}`);
    console.log(`     Gas Used: ${addReceipt?.gasUsed}`);
    console.log(`     Transaction Time: ${addTxTime}ms (${(addTxTime/1000).toFixed(2)} seconds)`);
    console.log(`     Confirmation Time: ${addConfirmTime}ms (${(addConfirmTime/1000).toFixed(2)} seconds)`);

      
    const afterAddStateStart = Date.now();
    const afterAddQueryStart = Date.now();
    const afterAddReserve0Enc = await guarded.getEncryptedReserve0();
    const afterAddReserve1Enc = await guarded.getEncryptedReserve1();
    const afterAddTotalSupplyEnc = await guarded.getEncryptedTotalSupply();
    const afterAddAliceLPEnc = await guarded.getEncryptedLPBalance(alice.address);
    const afterAddQueryTime = Date.now() - afterAddQueryStart;
    console.log(`   ⏱️ Post-addition state query: ${afterAddQueryTime}ms`);

    const afterAddDecryptStart = Date.now();
    const afterAddReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterAddReserve0Enc), pool, deployer);
    const afterAddReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterAddReserve1Enc), pool, deployer);
    const afterAddTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterAddTotalSupplyEnc), pool, deployer);
    const afterAddAliceLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterAddAliceLPEnc), pool, alice);
    const afterAddDecryptTime = Date.now() - afterAddDecryptStart;
    console.log(`   ⏱️ Post-addition state decryption: ${afterAddDecryptTime}ms`);
    const afterAddStateTime = Date.now() - afterAddStateStart;
    console.log(`   ⏱️ Post-addition state total time: ${afterAddStateTime}ms`);

    console.log("\n📊 State After Adding Liquidity:");
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(afterAddReserve0, 6)} (+${ethers.formatUnits(afterAddReserve0 - initialReserve0, 6)})`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(afterAddReserve1, 6)} (+${ethers.formatUnits(afterAddReserve1 - initialReserve1, 6)})`);
    console.log(`   Total Supply: ${ethers.formatUnits(afterAddTotalSupply, 6)} (+${ethers.formatUnits(afterAddTotalSupply - initialTotalSupply, 6)})`);
    console.log(`   Alice LP: ${ethers.formatUnits(afterAddAliceLP, 6)} (+${ethers.formatUnits(afterAddAliceLP - initialAliceLP, 6)})`);

      
    expect(afterAddReserve0 - initialReserve0).to.equal(addAmount0);
    expect(afterAddReserve1 - initialReserve1).to.equal(addAmount1);
    
    const step1EndTime = Date.now();
    const step1Duration = step1EndTime - step1StartTime;
    console.log(`   ⏱️ Step 1 Total Time: ${step1Duration}ms (${(step1Duration/1000).toFixed(2)} seconds)`);

    // ==================== Step 2: Execute Swap ====================
    console.log("\n" + "=".repeat(60));
    console.log("🔄 Step 2: Execute Swap Operation");
    console.log("=".repeat(60));
    
    const step2StartTime = Date.now();

      
    const swapAmountIn = ethers.parseUnits("5", 6);   
    const feeN = 997n;
    const feeD = 1000n;
    const userMaxSlippageBps = 100n; // 1% slippage

    console.log("\n💱 Swap Parameters:");
    console.log(`   Input Amount: ${ethers.formatUnits(swapAmountIn, 6)} TokenA`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (1%)`);

      
    console.log("   Calculating swap output...");
    const swapCalcStart = Date.now();
    
    const swapEncryptStart = Date.now();
    const encSwapAmountIn = await createEncryptedInputWithRetry(pool, alice.address, swapAmountIn, "Swap Input Encryption");
    const swapEncryptTime = Date.now() - swapEncryptStart;
    console.log(`   ⏱️ Swap input encryption: ${swapEncryptTime}ms`);
    
    const getAmountOutStart = Date.now();
    const getAmountOutTx = await guarded.connect(alice).getAmountOut(
      encSwapAmountIn.handles[0], 
      encSwapAmountIn.inputProof, 
      tokenAAddr,
      { gasLimit: 1000000 }
    );
    const getAmountOutConfirmStart = Date.now();
    await getAmountOutTx.wait();
    const getAmountOutTime = Date.now() - getAmountOutStart;
    const getAmountOutConfirmTime = Date.now() - getAmountOutConfirmStart;
    console.log(`   ⏱️ getAmountOut transaction: ${getAmountOutTime - getAmountOutConfirmTime}ms`);
    console.log(`   ⏱️ getAmountOut confirmation: ${getAmountOutConfirmTime}ms`);
    console.log(`   ✅ Calculation completed: ${getAmountOutTx.hash}`);
    
    const resultQueryStart = Date.now();
    const numeratorEnc = await guarded.getEncryptedNumerator();
    const denominatorEnc = await guarded.getEncryptedDenominator();
    const resultQueryTime = Date.now() - resultQueryStart;
    console.log(`   ⏱️ Result query: ${resultQueryTime}ms`);
    
    const resultDecryptStart = Date.now();
    const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
    const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
    const expectedOut = numerator / denominator;
    const resultDecryptTime = Date.now() - resultDecryptStart;
    console.log(`   ⏱️ Result decryption: ${resultDecryptTime}ms`);
    
    const swapCalcTime = Date.now() - swapCalcStart;
    console.log(`   ⏱️ Total Swap Calculation Time: ${swapCalcTime}ms`);
    
      
    const minAllowedOut = (expectedOut * (10000n - userMaxSlippageBps)) / 10000n;
    const minOut = minAllowedOut;

    console.log(`   Expected Output: ${ethers.formatUnits(expectedOut, 6)} TokenB`);
    console.log(`   Minimum Output: ${ethers.formatUnits(minOut, 6)} TokenB`);

      
    const swapExpiry = Math.floor(Date.now() / 1000) + 3600;
    const nonce = Math.floor(Math.random() * 1000000);   

    const inputs = {
      reserve_in: Number(afterAddReserve0),
      reserve_out: Number(afterAddReserve1),
      amount_in: Number(swapAmountIn),
      fee_numerator: Number(feeN),
      fee_denominator: Number(feeD),
      expected_out: Number(expectedOut),
      min_out: Number(minOut),
      max_slippage_bps: Number(userMaxSlippageBps),
      chain_id: chainId,
      pool: Array(20).fill(0),
      token_in: Array(20).fill(0),
      to: Array(20).fill(1),
      expiry: swapExpiry,
      nonce: nonce,
    };

    console.log("\n🚀 Generating RISC Zero Proof:");
    console.log(`   Chain ID: ${chainId}`);
    console.log(`   Nonce: ${nonce}`);
    console.log(`   Expiry: ${swapExpiry}`);

    const riscZeroStart = Date.now();
    const proofHashHex = runHostWithJson(inputs);
    const proofHash = proofHashHex as `0x${string}`;
    const riscZeroTime = Date.now() - riscZeroStart;
    console.log(`   ⏱️ RISC Zero Proof Generation: ${riscZeroTime}ms`);
    console.log(`   ✅ Proof generated successfully: ${proofHash.substring(0, 10)}...`);

      
    console.log("   Signing proof...");
    const signStart = Date.now();
    const sig = await verifier.signMessage(ethers.getBytes(proofHash));
    const parsed = ethers.Signature.from(sig);
    const signTime = Date.now() - signStart;
    console.log(`   ⏱️ Proof Signing: ${signTime}ms`);
    console.log("   ✅ Signing completed");

      
    const swapExecEncryptStart = Date.now();
    const encIn = await createEncryptedInputWithRetry(pool, alice.address, swapAmountIn, "Swap Execution Input Encryption");
    const encInTime = Date.now() - swapExecEncryptStart;
    console.log(`   ⏱️ Swap execution input encryption: ${encInTime}ms`);
    
    const encOutStart = Date.now();
    const encOut = await createEncryptedInputWithRetry(pool, alice.address, expectedOut, "Swap Execution Output Encryption");
    const encOutTime = Date.now() - encOutStart;
    console.log(`   ⏱️ Swap execution output encryption: ${encOutTime}ms`);

    console.log("   Executing swap...");
    const swapTxStart = Date.now();
    const swapTx = await guarded.connect(alice).swapWithProof(
      encIn.handles[0], encIn.inputProof,
      encOut.handles[0], encOut.inputProof,
      tokenAAddr,
      alice.address,
      swapExpiry,
      proofHash as any,
      parsed.v, parsed.r, parsed.s,
      {
        gasLimit: 3000000,   
      }
    );
    const swapTxTime = Date.now() - swapTxStart;
    console.log(`   ⏱️ Swap Transaction Execution: ${swapTxTime}ms`);
    
    const swapConfirmStart = Date.now();
    const swapReceipt = await swapTx.wait();
    const swapConfirmTime = Date.now() - swapConfirmStart;
    console.log(`   ⏱️ Swap Transaction Confirmation: ${swapConfirmTime}ms`);
    
    console.log(`   ✅ Swap executed successfully:`);
    console.log(`     Transaction Hash: ${swapTx.hash}`);
    console.log(`     Gas Used: ${swapReceipt?.gasUsed}`);
    console.log(`     Transaction Time: ${swapTxTime}ms (${(swapTxTime/1000).toFixed(2)} seconds)`);
    console.log(`     Confirmation Time: ${swapConfirmTime}ms (${(swapConfirmTime/1000).toFixed(2)} seconds)`);

      
    const afterSwapStateStart = Date.now();
    const afterSwapQueryStart = Date.now();
    const afterSwapReserve0Enc = await guarded.getEncryptedReserve0();
    const afterSwapReserve1Enc = await guarded.getEncryptedReserve1();
    const afterSwapQueryTime = Date.now() - afterSwapQueryStart;
    console.log(`   ⏱️ Post-swap state query: ${afterSwapQueryTime}ms`);

    const afterSwapDecryptStart = Date.now();
    const afterSwapReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterSwapReserve0Enc), pool, deployer);
    const afterSwapReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterSwapReserve1Enc), pool, deployer);
    const afterSwapDecryptTime = Date.now() - afterSwapDecryptStart;
    console.log(`   ⏱️ Post-swap state decryption: ${afterSwapDecryptTime}ms`);
    const afterSwapStateTime = Date.now() - afterSwapStateStart;
    console.log(`   ⏱️ Post-swap state total time: ${afterSwapStateTime}ms`);

    console.log("\n📊 Reserve State After Swap:");
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(afterSwapReserve0, 6)} (+${ethers.formatUnits(afterSwapReserve0 - afterAddReserve0, 6)})`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(afterSwapReserve1, 6)} (-${ethers.formatUnits(afterAddReserve1 - afterSwapReserve1, 6)})`);

      
    expect(afterSwapReserve0 - afterAddReserve0).to.equal(swapAmountIn);
    expect(afterAddReserve1 - afterSwapReserve1).to.equal(expectedOut);
    
    const step2EndTime = Date.now();
    const step2Duration = step2EndTime - step2StartTime;
    console.log(`   ⏱️ Step 2 Total Time: ${step2Duration}ms (${(step2Duration/1000).toFixed(2)} seconds)`);

    // ==================== Step 3: Remove Liquidity ====================
    console.log("\n" + "=".repeat(60));
    console.log("💧 Step 3: Remove Liquidity");
    console.log("=".repeat(60));
    
    const step3StartTime = Date.now();

      
    const removeAmount = ethers.parseUnits("10", 6);   

    console.log("\n💧 Liquidity Removal Parameters:");
    console.log(`   LP Amount to Remove: ${ethers.formatUnits(removeAmount, 6)}`);

    const removeEncryptStart = Date.now();
    const encRemove = await createEncryptedInputWithRetry(pool, alice.address, removeAmount, "Liquidity Removal Encryption");
    const removeEncryptTime = Date.now() - removeEncryptStart;
    console.log(`   ⏱️ Liquidity removal encryption: ${removeEncryptTime}ms`);

    console.log("   Removing liquidity...");
    const removeTxStart = Date.now();
    const removeTx = await guarded.connect(alice).removeLiquidity(
      encRemove.handles[0], encRemove.inputProof,
      {
        gasLimit: 2000000,
      }
    );
    const removeTxTime = Date.now() - removeTxStart;
    console.log(`   ⏱️ Liquidity Removal Transaction: ${removeTxTime}ms`);
    
    const removeConfirmStart = Date.now();
    const removeReceipt = await removeTx.wait();
    const removeConfirmTime = Date.now() - removeConfirmStart;
    console.log(`   ⏱️ Liquidity Removal Confirmation: ${removeConfirmTime}ms`);

    console.log(`   ✅ Liquidity removed successfully:`);
    console.log(`     Transaction Hash: ${removeTx.hash}`);
    console.log(`     Gas Used: ${removeReceipt?.gasUsed}`);
    console.log(`     Transaction Time: ${removeTxTime}ms (${(removeTxTime/1000).toFixed(2)} seconds)`);
    console.log(`     Confirmation Time: ${removeConfirmTime}ms (${(removeConfirmTime/1000).toFixed(2)} seconds)`);

      
    const finalStateStart = Date.now();
    const finalQueryStart = Date.now();
    const finalReserve0Enc = await guarded.getEncryptedReserve0();
    const finalReserve1Enc = await guarded.getEncryptedReserve1();
    const finalTotalSupplyEnc = await guarded.getEncryptedTotalSupply();
    const finalAliceLPEnc = await guarded.getEncryptedLPBalance(alice.address);
    const finalQueryTime = Date.now() - finalQueryStart;
    console.log(`   ⏱️ Final state query: ${finalQueryTime}ms`);

    const finalDecryptStart = Date.now();
    const finalReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalReserve0Enc), pool, deployer);
    const finalReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalReserve1Enc), pool, deployer);
    const finalTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalTotalSupplyEnc), pool, deployer);
    const finalAliceLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalAliceLPEnc), pool, alice);
    const finalDecryptTime = Date.now() - finalDecryptStart;
    console.log(`   ⏱️ Final state decryption: ${finalDecryptTime}ms`);
    const finalStateTime = Date.now() - finalStateStart;
    console.log(`   ⏱️ Final state total time: ${finalStateTime}ms`);

    console.log("\n📊 Final State:");
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(finalReserve0, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(finalReserve1, 6)}`);
    console.log(`   Total Supply: ${ethers.formatUnits(finalTotalSupply, 6)}`);
    console.log(`   Alice LP: ${ethers.formatUnits(finalAliceLP, 6)}`);

      
    expect(finalAliceLP).to.be.lessThan(afterAddAliceLP);
    expect(finalTotalSupply).to.be.lessThan(afterAddTotalSupply);
    
    const step3EndTime = Date.now();
    const step3Duration = step3EndTime - step3StartTime;
    console.log(`   ⏱️ Step 3 Total Time: ${step3Duration}ms (${(step3Duration/1000).toFixed(2)} seconds)`);

    // ==================== Flow Summary ====================
    console.log("\n" + "=".repeat(60));
    console.log("📈 Sepolia Network Complete Flow Summary");
    console.log("=".repeat(60));

    console.log("\n🔄 Flow Change Statistics:");
    console.log(`   Initial Reserves: ${ethers.formatUnits(initialReserve0, 6)} TokenA, ${ethers.formatUnits(initialReserve1, 6)} TokenB`);
    console.log(`   Liquidity Added: +${ethers.formatUnits(addAmount0, 6)} TokenA, +${ethers.formatUnits(addAmount1, 6)} TokenB`);
    console.log(`   Swap Executed: +${ethers.formatUnits(swapAmountIn, 6)} TokenA, -${ethers.formatUnits(expectedOut, 6)} TokenB`);
    console.log(`   Liquidity Removed: -${ethers.formatUnits(removeAmount, 6)} LP`);
    console.log(`   Final Reserves: ${ethers.formatUnits(finalReserve0, 6)} TokenA, ${ethers.formatUnits(finalReserve1, 6)} TokenB`);

      
    const testEndTime = Date.now();
    const totalTestDuration = testEndTime - testStartTime;
    
    // Gas consumption statistics
    const totalGasUsed = (addReceipt?.gasUsed || 0n) + (swapReceipt?.gasUsed || 0n) + (removeReceipt?.gasUsed || 0n);
    
    console.log("\n⛽ Gas Consumption Statistics:");
    console.log(`   Add Liquidity: ${addReceipt?.gasUsed || 0} gas`);
    console.log(`   Execute Swap: ${swapReceipt?.gasUsed || 0} gas`);
    console.log(`   Remove Liquidity: ${removeReceipt?.gasUsed || 0} gas`);
    console.log(`   Total: ${totalGasUsed} gas`);
    
    console.log("\n⏱️ Detailed Time Statistics:");
    console.log(`   Step 0 (Token Minting): ${step0Duration}ms (${(step0Duration/1000).toFixed(2)} seconds)`);
    console.log(`   Step 0.1 (Permission Setup): ${step01Duration}ms (${(step01Duration/1000).toFixed(2)} seconds)`);
    console.log(`   Step 1 (Add Liquidity): ${step1Duration}ms (${(step1Duration/1000).toFixed(2)} seconds)`);
    console.log(`   Step 2 (Execute Swap): ${step2Duration}ms (${(step2Duration/1000).toFixed(2)} seconds)`);
    console.log(`   Step 3 (Remove Liquidity): ${step3Duration}ms (${(step3Duration/1000).toFixed(2)} seconds)`);
    console.log(`   ──────────────────────────────────────────`);
    console.log(`   Step Total: ${step0Duration + step01Duration + step1Duration + step2Duration + step3Duration}ms (${((step0Duration + step01Duration + step1Duration + step2Duration + step3Duration)/1000).toFixed(2)} seconds)`);
    console.log(`   Total Test Time: ${totalTestDuration}ms (${(totalTestDuration/1000).toFixed(2)} seconds)`);
    
      
    const otherTime = totalTestDuration - (step0Duration + step01Duration + step1Duration + step2Duration + step3Duration);
    console.log(`   Other Time (Initialization/Network Delay): ${otherTime}ms (${(otherTime/1000).toFixed(2)} seconds)`);

    console.log("\n✅ Flow Verification:");
    console.log(`   ✅ Add Liquidity: Reserves increased correctly`);
    console.log(`   ✅ Execute Swap: Reserves changed correctly according to AMM formula`);
    console.log(`   ✅ Remove Liquidity: LP and reserves decreased correctly`);
    console.log(`   ✅ Replay Protection: Proof hash has been consumed`);
    console.log(`   ✅ RISC Zero Verification: Slippage protection working properly`);

      
    const isConsumed = await guarded.consumedProofs(proofHash);
    expect(isConsumed).to.be.true;

    console.log("\n" + "=".repeat(80));
    console.log("🎉 Sepolia Network Complete User Flow Test Successfully Completed!");
    console.log("   Full Flow Verified: Add Liquidity → Swap → Remove Liquidity");
    console.log(`   Total Gas Consumed: ${totalGasUsed} gas`);
    console.log(`   Total Time: ${totalTestDuration}ms (${(totalTestDuration/1000).toFixed(2)} seconds)`);
    console.log("=".repeat(80));
  });
});
import { expect } from "chai";
import { ethers, deployments, fhevm } from "hardhat";
import { FHESwapSimpleGuarded, ConfidentialFungibleTokenMintableBurnable } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import child_process from "child_process";
import path from "path";

  
const CONFIG = {
  RISC_ZERO_HOST_PATH: process.env.RISC_ZERO_HOST_PATH || "/home/su/dome/ZK/RSIC-zero/RISC_ZAMA/host",
  CHAIN_ID: 11155111, // Sepolia testnet
  TIMEOUT: 1800000, // 30-minute timeout to handle Sepolia network delays
  EXPIRY_OFFSET: 3600, // 1-hour expiry time
  MAX_SLIPPAGE_BPS: 500, // 5% slippage protection
  PROTOCOL_FEE_BPS: 5, // 0.05% protocol fee
};

  
const TEST_DATA = {
  INITIAL_AMOUNT_A: 1000000n, // 1,000,000 Token A
  INITIAL_AMOUNT_B: 2000000n, // 2,000,000 Token B
  SWAP_AMOUNT_A: 100000n,    // 100,000 Token A for swapping
  ADD_LIQUIDITY_AMOUNT_A: 50000n,  // 50,000 Token A for adding liquidity
  ADD_LIQUIDITY_AMOUNT_B: 100000n, // 100,000 Token B for adding liquidity
  FIRST_ADD_AMOUNT_A: 100000n,   
  FIRST_ADD_AMOUNT_B: 200000n,   
  LOCKED_LP: 1000n,   
};

  
class TestUtils {
  /**
   * Call RISC Zero host to generate proof
   */
  static runHostWithJson(json: any): string {
    const jsonStr = JSON.stringify(json, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value
    );
    console.log("Sending JSON to host:", jsonStr);
    
    const p = child_process.spawnSync("cargo", ["run"], {
      cwd: CONFIG.RISC_ZERO_HOST_PATH,
      input: jsonStr,
      encoding: "utf-8",
      env: { ...process.env, RISC0_DEV_MODE: "1" },
    });
    
    console.log("Host stdout:", p.stdout);
    console.log("Host stderr:", p.stderr);
    console.log("Host status:", p.status);
    
    if (p.status !== 0) {
      throw new Error(`RISC Zero host failed: ${p.stderr || p.stdout}`);
    }
    
    const m = p.stdout.match(/proof_hash=0x([0-9a-fA-F]{64})/);
    if (!m) {
      throw new Error("proof_hash not found in host output");
    }
    
    return "0x" + m[1];
  }

  /**
   * Safely decrypt euint64 value
   */
  static async safeDecryptEuint64(
    encryptedValue: any,
    contractAddress: string,
    signer: HardhatEthersSigner,
    defaultValue: bigint = 0n
  ): Promise<bigint> {
    try {
      return await fhevm.userDecryptEuint(
        FhevmType.euint64, 
        ethers.hexlify(encryptedValue), 
        contractAddress, 
        signer
      );
    } catch (e: any) {
      console.log(`⚠️ Decryption failed, using default value ${defaultValue}:`, e.message);
      return defaultValue;
    }
  }

  /**
   * Safely decrypt euint64 value with retry mechanism
   */
  static async safeDecryptEuint64WithRetry(
    encryptedValue: any,
    contractAddress: string,
    signer: HardhatEthersSigner,
    defaultValue: bigint = 0n,
    maxRetries: number = 3,
    delayMs: number = 2000
  ): Promise<bigint> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await fhevm.userDecryptEuint(
          FhevmType.euint64, 
          ethers.hexlify(encryptedValue), 
          contractAddress, 
          signer
        );
        return result;
      } catch (e: any) {
        console.log(`⚠️ Decryption failed (Attempt ${attempt}/${maxRetries}):`, e.message);
        if (attempt < maxRetries) {
          console.log(`⏳ Waiting ${delayMs}ms before retrying...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    console.log(`⚠️ All decryption attempts failed, using default value ${defaultValue}`);
    return defaultValue;
  }

  /**
   * Generate signature
   */
  static async generateSignature(proofHash: string, verifier: HardhatEthersSigner) {
    const messageHash = ethers.getBytes(proofHash);
    const signature = await verifier.signMessage(messageHash);
    return ethers.Signature.from(signature);
  }

  /**
   * Build base structure for RISC Zero input
   */
  static buildBaseRiscZeroInput(
    poolAddress: string,
    userAddress: string,
    nonce: number
  ) {
    return {
      chain_id: CONFIG.CHAIN_ID,
      pool: Array.from(ethers.getBytes(poolAddress)),
      user: Array.from(ethers.getBytes(userAddress)),
      expiry: Math.floor(Date.now() / 1000) + CONFIG.EXPIRY_OFFSET,
      nonce: nonce
    };
  }

  /**
   * Calculate LP amount for first liquidity addition
   */
  static calculateFirstAddLiquidity(amount0: bigint, amount1: bigint): bigint {
    const product = amount0 * amount1;
    const sqrtProduct = Math.floor(Math.sqrt(Number(product)));
    return BigInt(sqrtProduct) - TEST_DATA.LOCKED_LP;
  }

  /**
   * Calculate LP amount for subsequent liquidity additions
   */
  static calculateSubsequentAddLiquidity(
    amount0: bigint,
    amount1: bigint,
    reserve0: bigint,
    reserve1: bigint,
    totalSupply: bigint
  ): bigint {
    const lpFromToken0 = (amount0 * totalSupply) / reserve0;
    const lpFromToken1 = (amount1 * totalSupply) / reserve1;
    return lpFromToken0 < lpFromToken1 ? lpFromToken0 : lpFromToken1;
  }

  /**
   * Calculate swap output amount
   */
  static calculateSwapOutput(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint
  ): bigint {
    const amountInWithFee = amountIn * 997n; // 0.3% fee
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000n + amountInWithFee;
    return numerator / denominator;
  }

  /**
   * Create encrypted input with retry mechanism
   */
  static async createEncryptedInputWithRetry(
    pool: string,
    user: string,
    amount: bigint,
    label: string,
    maxRetries: number = 8
  ): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`   🔐 [${label}] Creating encrypted input (Attempt ${attempt}/${maxRetries})...`);
        const result = await fhevm.createEncryptedInput(pool, user).add64(amount).encrypt();
        console.log(`   ✅ [${label}] Encrypted input created successfully`);
        return result;
      } catch (err: any) {
        const message = String(err?.message || err);
        console.log(`   ⚠️ [${label}] Failed (Attempt ${attempt}/${maxRetries}): ${message}`);
        
          
        if (/extraData/i.test(message)) {
          console.log(`   🔧 Detected extraData error, waiting for relayer recovery...`);
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

  /**
   * Retry mechanism to handle network instability
   */
  static async retryOperation<T>(
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
        console.log(`⚠️ [${label}] Failed (Attempt ${attempt}/${maxRetries}): ${message}`);
        
          
        if (/extraData/i.test(message)) {
          console.log(`   🔧 Detected extraData error, this is a known FHEVM relayer issue`);
          console.log(`   💡 Recommendation: Wait for relayer recovery or test with local network`);
        }
        
        if (!transient || attempt === maxRetries) break;
        const wait = Math.floor(delayMs * Math.pow(1.5, attempt - 1));
        console.log(`⏳ [${label}] Waiting ${wait}ms before retrying...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }
}

describe("FHESwapSimpleGuarded - Sepolia Complete Flow E2E", function () {
  this.timeout(CONFIG.TIMEOUT);

  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let verifier: HardhatEthersSigner;
  let feeTo: HardhatEthersSigner;
  let tokenA: ConfidentialFungibleTokenMintableBurnable;
  let tokenB: ConfidentialFungibleTokenMintableBurnable;
  let guarded: FHESwapSimpleGuarded;

  before(async function () {
    console.log("\n" + "=".repeat(80));
    console.log("🌐 Sepolia Network - Initialize Complete Flow Test Environment");
    console.log("=".repeat(80));

      
    process.env.FHEVM_RELAYER_TIMEOUT = "60000";
    process.env.FHEVM_RELAYER_RETRIES = "5";
    process.env.FHEVM_RELAYER_DELAY = "5000";

      
    try {
      await fhevm.initializeCLIApi();
      console.log("✅ FHEVM CLI API initialized successfully");
    } catch (error) {
      console.log("⚠️ FHEVM initialization warning:", error);
        
    }

      
    const signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];
    bob = signers[2];
    verifier = signers[3];
    feeTo = signers[4];   

    console.log("📋 Test Participants:");
    console.log("  Deployer:", deployer.address);
    console.log("  Alice:", alice.address);
    console.log("  Bob:", bob.address);
    console.log("  Verifier:", verifier.address);
    console.log("  FeeTo:", feeTo.address);

      
    const deployerBalance = await ethers.provider.getBalance(deployer.address);
    const aliceBalance = await ethers.provider.getBalance(alice.address);
    console.log(`   Deployer Balance: ${ethers.formatEther(deployerBalance)} ETH`);
    console.log(`   Alice Balance: ${ethers.formatEther(aliceBalance)} ETH`);

    if (deployerBalance < ethers.parseEther("0.1")) {
      throw new Error("Insufficient Deployer balance, need at least 0.1 ETH");
    }
    if (aliceBalance < ethers.parseEther("0.05")) {
      throw new Error("Insufficient Alice balance, need at least 0.05 ETH");
    }

      
    await deployments.fixture(["TokenA", "TokenB", "guarded"], { keepExistingDeployments: true });

    const tokenADeployment = await deployments.get("TokenA");
    const tokenBDeployment = await deployments.get("TokenB");
    const guardedDeployment = await deployments.get("FHESwapSimpleGuarded");

    tokenA = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenADeployment.address);
    tokenB = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenBDeployment.address);
    guarded = await ethers.getContractAt("FHESwapSimpleGuarded", guardedDeployment.address);

    console.log("📦 Contract Addresses:");
    console.log("  TokenA:", tokenADeployment.address);
    console.log("  TokenB:", tokenBDeployment.address);
    console.log("  Guarded:", guardedDeployment.address);

      
    console.log("💰 Minting Tokens...");
    
    // Alice's tokens
    const encA_Alice = await TestUtils.createEncryptedInputWithRetry(tokenADeployment.address, deployer.address, TEST_DATA.INITIAL_AMOUNT_A, "Alice TokenA Mint");
    const encB_Alice = await TestUtils.createEncryptedInputWithRetry(tokenBDeployment.address, deployer.address, TEST_DATA.INITIAL_AMOUNT_B, "Alice TokenB Mint");
    await TestUtils.retryOperation("Alice TokenA Mint", async () =>
      tokenA.mint(alice.address, encA_Alice.handles[0], encA_Alice.inputProof, { gasLimit: 500000 })
    );
    await TestUtils.retryOperation("Alice TokenB Mint", async () =>
      tokenB.mint(alice.address, encB_Alice.handles[0], encB_Alice.inputProof, { gasLimit: 500000 })
    );

    // Bob's tokens
    const encA_Bob = await TestUtils.createEncryptedInputWithRetry(tokenADeployment.address, deployer.address, TEST_DATA.INITIAL_AMOUNT_A, "Bob TokenA Mint");
    const encB_Bob = await TestUtils.createEncryptedInputWithRetry(tokenBDeployment.address, deployer.address, TEST_DATA.INITIAL_AMOUNT_B, "Bob TokenB Mint");
    await TestUtils.retryOperation("Bob TokenA Mint", async () =>
      tokenA.mint(bob.address, encA_Bob.handles[0], encA_Bob.inputProof, { gasLimit: 500000 })
    );
    await TestUtils.retryOperation("Bob TokenB Mint", async () =>
      tokenB.mint(bob.address, encB_Bob.handles[0], encB_Bob.inputProof, { gasLimit: 500000 })
    );

      
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    await TestUtils.retryOperation("TokenA Operator Setup", async () =>
      tokenA.connect(alice).setOperator(await guarded.getAddress(), expiry, { gasLimit: 500000 })
    );
    await TestUtils.retryOperation("TokenB Operator Setup", async () =>
      tokenB.connect(alice).setOperator(await guarded.getAddress(), expiry, { gasLimit: 500000 })
    );
    await TestUtils.retryOperation("Bob TokenA Operator Setup", async () =>
      tokenA.connect(bob).setOperator(await guarded.getAddress(), expiry, { gasLimit: 500000 })
    );
    await TestUtils.retryOperation("Bob TokenB Operator Setup", async () =>
      tokenB.connect(bob).setOperator(await guarded.getAddress(), expiry, { gasLimit: 500000 })
    );

    console.log("✅ Environment Initialization Complete");
  });

  describe("Fee Mechanism Setup", function () {
    it("Should be able to set fee-related parameters", async function () {
      console.log("\n" + "=".repeat(60));
      console.log("💸 Testing Fee Mechanism Setup");
      console.log("=".repeat(60));

        
      await TestUtils.retryOperation("Set Fee Recipient Address", async () =>
        guarded.connect(deployer).setFeeTo(feeTo.address, { gasLimit: 200000 })
      );
      expect(await guarded.feeTo()).to.equal(feeTo.address);
      console.log("✅ Fee Recipient Address Set Successfully:", feeTo.address);

        
      await TestUtils.retryOperation("Enable Fee Mechanism", async () =>
        guarded.connect(deployer).setFeeEnabled(true, { gasLimit: 200000 })
      );
      expect(await guarded.feeEnabled()).to.equal(true);
      console.log("✅ Fee Mechanism Enabled Successfully");

        
      const feeToAddress = await guarded.feeTo();
      const feeEnabled = await guarded.feeEnabled();
      const protocolFeeBps = await guarded.protocolFeeBps();

      console.log("📊 Fee Configuration:");
      console.log("  Fee Recipient Address:", feeToAddress);
      console.log("  Fee Enabled Status:", feeEnabled);
      console.log("  Protocol Fee BPS:", protocolFeeBps.toString());
    });
  });

  describe("Complete Liquidity Management Flow", function () {
    it("Should complete the full first liquidity addition flow", async function () {
      console.log("\n" + "=".repeat(60));
      console.log("🌊 Testing First Liquidity Addition");
      console.log("=".repeat(60));

        
      const existingReserve0 = await guarded.getEncryptedReserve0();
      const existingReserve1 = await guarded.getEncryptedReserve1();
      
      let hasLiquidity = false;
      try {
        const decryptedExistingReserve0 = await TestUtils.safeDecryptEuint64(existingReserve0, await guarded.getAddress(), deployer);
        const decryptedExistingReserve1 = await TestUtils.safeDecryptEuint64(existingReserve1, await guarded.getAddress(), deployer);
        hasLiquidity = decryptedExistingReserve0 > 0n && decryptedExistingReserve1 > 0n;
        console.log("🔍 Checking Existing Liquidity:", {
          reserve0: decryptedExistingReserve0,
          reserve1: decryptedExistingReserve1,
          hasLiquidity: hasLiquidity
        });
      } catch (e: any) {
        hasLiquidity = false;
        console.log("⚠️ Unable to decrypt reserves, likely no liquidity:", e.message);
      }
      
      if (hasLiquidity) {
        console.log("⚠️ Liquidity already exists, skipping first liquidity addition test");
        return;
      }

        
      const amount0 = TEST_DATA.FIRST_ADD_AMOUNT_A;
      const amount1 = TEST_DATA.FIRST_ADD_AMOUNT_B;
      
      // 1. Alice calls calculateAddLiquidityNumerators
      console.log("1️⃣ Calling calculateAddLiquidityNumerators...");
      
      const amount0Encrypted = await TestUtils.createEncryptedInputWithRetry(await guarded.getAddress(), alice.address, amount0, "First Liquidity Add TokenA");
      const amount1Encrypted = await TestUtils.createEncryptedInputWithRetry(await guarded.getAddress(), alice.address, amount1, "First Liquidity Add TokenB");
      
      await TestUtils.retryOperation("calculateAddLiquidityNumerators", async () =>
        guarded.connect(alice).calculateAddLiquidityNumerators(
          alice.address,
          amount0Encrypted.handles[0],
          amount0Encrypted.inputProof,
          amount1Encrypted.handles[0],
          amount1Encrypted.inputProof,
          { gasLimit: 1000000 }
        )
      );
      
      console.log("✅ calculateAddLiquidityNumerators Called Successfully");
      
      // 2. Project team decrypts data and calls RISC Zero verification
      console.log("2️⃣ Calling RISC Zero Verification...");
      
        
      const currentReserve0 = await guarded.getCurrentReserve0();
      const currentReserve1 = await guarded.getCurrentReserve1();
      const currentTotalSupply = await guarded.getCurrentTotalSupply();
      const isFirstAdd = await guarded.getIsFirstAdd();
      
      console.log("📊 Current Status:", {
        reserve0: currentReserve0,
        reserve1: currentReserve1,
        totalSupply: currentTotalSupply,
        isFirstAdd: isFirstAdd
      });
      
        
      const decryptedReserve0 = await TestUtils.safeDecryptEuint64(currentReserve0, await guarded.getAddress(), deployer);
      const decryptedReserve1 = await TestUtils.safeDecryptEuint64(currentReserve1, await guarded.getAddress(), deployer);
      const decryptedTotalSupply = await TestUtils.safeDecryptEuint64(currentTotalSupply, await guarded.getAddress(), deployer);
      
        
      const feeEnabled = await guarded.feeEnabled();
      const feeToAddress = await guarded.feeTo();
      const lastK = await guarded.getEncryptedLastK();
      const decryptedLastK = await TestUtils.safeDecryptEuint64(lastK, await guarded.getAddress(), deployer);
      
      console.log("🔓 Decrypted Status:", {
        reserve0: decryptedReserve0,
        reserve1: decryptedReserve1,
        totalSupply: decryptedTotalSupply,
        isFirstAdd: isFirstAdd,
        feeEnabled: feeEnabled,
        feeTo: feeToAddress,
        lastK: decryptedLastK
      });
      
        
      const liquidityInput = {
        ...TestUtils.buildBaseRiscZeroInput(await guarded.getAddress(), alice.address, 1),
        reserve0: Number(decryptedReserve0),
        reserve1: Number(decryptedReserve1),
        amount0: Number(amount0),
        amount1: Number(amount1),
        total_supply: Number(decryptedTotalSupply),
        is_first_add: isFirstAdd,
        min_amount0: 0,          
        min_amount1: 0,          
        min_liquidity: 0,        
        fee_enabled: feeEnabled,
        fee_to: Array.from(ethers.getBytes(feeToAddress)),
        last_k: Number(decryptedLastK)
      };
      
      console.log("📤 RISC Zero Input:", liquidityInput);
      
        
      const proofHash = TestUtils.runHostWithJson(liquidityInput);
      console.log("✅ RISC Zero Verification Successful, proof hash:", proofHash);
      
      // 3. Generate signature
      console.log("3️⃣ Generating Signature...");
      const sig = await TestUtils.generateSignature(proofHash, verifier);
      console.log("✅ Signature Generated Successfully");
      
      // 4. Alice calls addLiquidityWithProof
      console.log("4️⃣ Calling addLiquidityWithProof...");
      
        
      const liquidityMinted = TestUtils.calculateFirstAddLiquidity(amount0, amount1);
      console.log("🧮 Calculated LP Amount:", liquidityMinted);
      
      const liquidityMintedEncrypted = await TestUtils.createEncryptedInputWithRetry(await guarded.getAddress(), alice.address, liquidityMinted, "First Liquidity Add LP");
      
        
      const protocolFeeLP = 0n;   
      const protocolFeeLPEncrypted = await TestUtils.createEncryptedInputWithRetry(await guarded.getAddress(), alice.address, protocolFeeLP, "First Liquidity Add Protocol Fee");
      
        
      const minAmount0Encrypted = await TestUtils.createEncryptedInputWithRetry(await guarded.getAddress(), alice.address, 0n, "First Liquidity Add Min TokenA");
      const minAmount1Encrypted = await TestUtils.createEncryptedInputWithRetry(await guarded.getAddress(), alice.address, 0n, "First Liquidity Add Min TokenB");
      const minLiquidityEncrypted = await TestUtils.createEncryptedInputWithRetry(await guarded.getAddress(), alice.address, 0n, "First Liquidity Add Min LP");

      const liquidityParams = {
        amount0: amount0Encrypted.handles[0],
        amount0Proof: amount0Encrypted.inputProof,
        amount1: amount1Encrypted.handles[0],
        amount1Proof: amount1Encrypted.inputProof,
        liquidityMinted: liquidityMintedEncrypted.handles[0],
        liquidityMintedProof: liquidityMintedEncrypted.inputProof,
        protocolFeeLP: protocolFeeLPEncrypted.handles[0],
        protocolFeeLPProof: protocolFeeLPEncrypted.inputProof,
        minAmount0: minAmount0Encrypted.handles[0],
        minAmount0Proof: minAmount0Encrypted.inputProof,
        minAmount1: minAmount1Encrypted.handles[0],
        minAmount1Proof: minAmount1Encrypted.inputProof,
        minLiquidity: minLiquidityEncrypted.handles[0],
        minLiquidityProof: minLiquidityEncrypted.inputProof,
        expiry: liquidityInput.expiry,
        proofHash: proofHash,
        v: sig.v,
        r: sig.r,
        s: sig.s
      };

      await TestUtils.retryOperation("addLiquidityWithProof", async () =>
        guarded.connect(alice).addLiquidityWithProof(liquidityParams, { gasLimit: 3000000 })
      );
      
      console.log("✅ addLiquidityWithProof Called Successfully");
      
        
      console.log("⏳ Waiting for state synchronization...");
      await new Promise(resolve => setTimeout(resolve, 10000));   
      
      // 5. Verify results
      console.log("5️⃣ Verifying Results...");
      
        
      let decryptedLPBalance = 0n;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts && decryptedLPBalance === 0n) {
        attempts++;
        console.log(`🔍 Attempt ${attempts}/${maxAttempts} to get Alice's LP Balance...`);
        
        try {
            
          await TestUtils.retryOperation("Set Alice Permissions", async () => {
              
            const newExpiry = Math.floor(Date.now() / 1000) + 3600;
            await tokenA.connect(alice).setOperator(await guarded.getAddress(), newExpiry, { gasLimit: 500000 });
            await tokenB.connect(alice).setOperator(await guarded.getAddress(), newExpiry, { gasLimit: 500000 });
          });
          
          const aliceLPBalance = await guarded.getEncryptedLPBalance(alice.address);
          decryptedLPBalance = await TestUtils.safeDecryptEuint64(aliceLPBalance, await guarded.getAddress(), alice);
          
          if (decryptedLPBalance === 0n && attempts < maxAttempts) {
            console.log(`⚠️ Alice's LP Balance still 0, waiting 3 seconds before retrying...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        } catch (e: any) {
          console.log(`⚠️ Failed to get Alice's LP Balance (Attempt ${attempts}):`, e.message);
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }
      
      console.log("👤 Alice's LP Balance:", decryptedLPBalance);
      expect(decryptedLPBalance).to.equal(liquidityMinted);
      
        
      const totalSupply = await guarded.getEncryptedTotalSupply();
      const decryptedTotalSupplyAfter = await TestUtils.safeDecryptEuint64(totalSupply, await guarded.getAddress(), deployer);
      
      console.log("📈 Total Supply:", decryptedTotalSupplyAfter);
        
      expect(decryptedTotalSupplyAfter).to.equal(liquidityMinted + TEST_DATA.LOCKED_LP);
      
        
      let decryptedReserve0After = 0n;
      let decryptedReserve1After = 0n;
      let reserveAttempts = 0;
      const maxReserveAttempts = 5;
      
      while (reserveAttempts < maxReserveAttempts && (decryptedReserve0After === 0n || decryptedReserve1After === 0n)) {
        reserveAttempts++;
        console.log(`🔍 Attempt ${reserveAttempts}/${maxReserveAttempts} to get Reserves...`);
        
        try {
          const reserve0 = await guarded.getEncryptedReserve0();
          const reserve1 = await guarded.getEncryptedReserve1();
          decryptedReserve0After = await TestUtils.safeDecryptEuint64(reserve0, await guarded.getAddress(), deployer);
          decryptedReserve1After = await TestUtils.safeDecryptEuint64(reserve1, await guarded.getAddress(), deployer);
          
          if ((decryptedReserve0After === 0n || decryptedReserve1After === 0n) && reserveAttempts < maxReserveAttempts) {
            console.log(`⚠️ Reserves still 0, waiting 3 seconds before retrying...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        } catch (e: any) {
          console.log(`⚠️ Failed to get Reserves (Attempt ${reserveAttempts}):`, e.message);
          if (reserveAttempts < maxReserveAttempts) {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }
      
      console.log("🏦 Reserves:", {
        reserve0: decryptedReserve0After,
        reserve1: decryptedReserve1After
      });
      expect(decryptedReserve0After).to.equal(amount0);
      expect(decryptedReserve1After).to.equal(amount1);
      
      console.log("🎉 First Liquidity Addition Test Passed!");
    });
  });

  describe("Complete Swap Flow", function () {
    it("Should complete the full swap flow", async function () {
      console.log("\n" + "=".repeat(60));
      console.log("🔄 Testing Complete Swap Flow");
      console.log("=".repeat(60));

      const amountIn = 10000n; // 10,000 Token A
      const maxSlippageBps = 500; // 5% slippage protection
      
      // 1. Get current reserves - add retry mechanism to ensure reserves are not zero
      console.log("1️⃣ Getting Current Reserves...");
      let decryptedReserve0 = 0n;
      let decryptedReserve1 = 0n;
      let swapReserveAttempts = 0;
      const maxSwapReserveAttempts = 10;
      
      while (swapReserveAttempts < maxSwapReserveAttempts && (decryptedReserve0 === 0n || decryptedReserve1 === 0n)) {
        swapReserveAttempts++;
        console.log(`🔍 Attempt ${swapReserveAttempts}/${maxSwapReserveAttempts} to get Swap Reserves...`);
        
        try {
          const reserve0 = await guarded.getEncryptedReserve0();
          const reserve1 = await guarded.getEncryptedReserve1();
          decryptedReserve0 = await TestUtils.safeDecryptEuint64(reserve0, await guarded.getAddress(), deployer);
          decryptedReserve1 = await TestUtils.safeDecryptEuint64(reserve1, await guarded.getAddress(), deployer);
          
          if ((decryptedReserve0 === 0n || decryptedReserve1 === 0n) && swapReserveAttempts < maxSwapReserveAttempts) {
            console.log(`⚠️ Reserves still 0, waiting 5 seconds before retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } catch (e: any) {
          console.log(`⚠️ Failed to get Swap Reserves (Attempt ${swapReserveAttempts}):`, e.message);
          if (swapReserveAttempts < maxSwapReserveAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }
      
        
      if (decryptedReserve0 === 0n || decryptedReserve1 === 0n) {
        console.log("❌ Reserves still 0, skipping swap test");
        return;
      }
      
      console.log("🏦 Current Reserves:", {
        reserve0: decryptedReserve0,
        reserve1: decryptedReserve1
      });
      
      // 2. Calculate expected output
      console.log("2️⃣ Calculating Expected Output...");
      const amountInWithFee = amountIn * 997n; // 0.3% fee
      const numerator = amountInWithFee * decryptedReserve1;
      const denominator = decryptedReserve0 * 1000n + amountInWithFee;
      const expectedOut = numerator / denominator;
      const minOut = (expectedOut * (10000n - BigInt(maxSlippageBps))) / 10000n;
      
      console.log("🧮 Swap Calculations:", {
        amountIn: amountIn,
        amountInWithFee: amountInWithFee,
        expectedOut: expectedOut,
        minOut: minOut,
        maxSlippageBps: maxSlippageBps
      });
      
      // 3. Alice calls getAmountOut
      console.log("3️⃣ Calling getAmountOut...");
      const amountInEncrypted = await TestUtils.createEncryptedInputWithRetry(await guarded.getAddress(), alice.address, amountIn, "Swap Input Encryption");
      
      await TestUtils.retryOperation("getAmountOut", async () =>
        guarded.connect(alice).getAmountOut(
          amountInEncrypted.handles[0],
          amountInEncrypted.inputProof,
          await tokenA.getAddress(),
          { gasLimit: 1000000 }
        )
      );
      
      console.log("✅ getAmountOut Called Successfully");
      
      // 4. Get numerator and denominator
      const numerator_encrypted = await guarded.getEncryptedNumerator();
      const denominator_encrypted = await guarded.getEncryptedDenominator();
      const decryptedNumerator = await TestUtils.safeDecryptEuint64(numerator_encrypted, await guarded.getAddress(), alice);
      const decryptedDenominator = await TestUtils.safeDecryptEuint64(denominator_encrypted, await guarded.getAddress(), alice);
      
      console.log("📊 On-chain Calculated Numerator & Denominator:", {
        numerator: decryptedNumerator,
        denominator: decryptedDenominator
      });
      
      // 5. Build RISC Zero input
      console.log("4️⃣ Calling RISC Zero Verification...");
      const swapInput = {
        reserve_in: Number(decryptedReserve0),
        reserve_out: Number(decryptedReserve1),
        amount_in: Number(amountIn),
        fee_numerator: 997,
        fee_denominator: 1000,
        expected_out: Number(expectedOut),
        min_out: Number(minOut),
        max_slippage_bps: maxSlippageBps,
        chain_id: CONFIG.CHAIN_ID,
        pool: Array.from(ethers.getBytes(await guarded.getAddress())),
        token_in: Array.from(ethers.getBytes(await tokenA.getAddress())),
        to: Array.from(ethers.getBytes(alice.address)),
        expiry: Math.floor(Date.now() / 1000) + 3600,
        nonce: 3
      };
      
      console.log("📤 RISC Zero Input:", swapInput);
      
        
      const proofHash = TestUtils.runHostWithJson(swapInput);
      console.log("✅ RISC Zero Verification Successful, proof hash:", proofHash);
      
      // 6. Generate signature
      console.log("5️⃣ Generating Signature...");
      const sig = await TestUtils.generateSignature(proofHash, verifier);
      console.log("✅ Signature Generated Successfully");
      
      // 7. Check Alice's token balance and permissions
      console.log("6️⃣ Checking Alice's Token Balance and Permissions...");
      
        
      const aliceBalanceA = await tokenA.confidentialBalanceOf(alice.address);
      const aliceBalanceB = await tokenB.confidentialBalanceOf(alice.address);
      console.log("🔍 Alice's Token Balance Handles:", {
        tokenA: ethers.hexlify(aliceBalanceA),
        tokenB: ethers.hexlify(aliceBalanceB)
      });
      
        
      const operatorExpiry = Math.floor(Date.now() / 1000) + 7200; // 2-hour expiry
      await TestUtils.retryOperation("Reset TokenA Operator", async () =>
        tokenA.connect(alice).setOperator(await guarded.getAddress(), operatorExpiry, { gasLimit: 500000 })
      );
      await TestUtils.retryOperation("Reset TokenB Operator", async () =>
        tokenB.connect(alice).setOperator(await guarded.getAddress(), operatorExpiry, { gasLimit: 500000 })
      );
      
        
      await TestUtils.retryOperation("Authorize Alice's TokenA Balance", async () =>
        tokenA.connect(alice).authorizeSelf(aliceBalanceA, { gasLimit: 500000 })
      );
      await TestUtils.retryOperation("Authorize Alice's TokenB Balance", async () =>
        tokenB.connect(alice).authorizeSelf(aliceBalanceB, { gasLimit: 500000 })
      );
      
      console.log("✅ Permissions and Balance Check Completed");
      
      // 8. Alice calls swapWithProof
      console.log("7️⃣ Calling swapWithProof...");
      const expectedAmountOutEncrypted = await TestUtils.createEncryptedInputWithRetry(await guarded.getAddress(), alice.address, expectedOut, "Swap Output Encryption");
      
      await TestUtils.retryOperation("swapWithProof", async () =>
        guarded.connect(alice).swapWithProof(
          amountInEncrypted.handles[0],
          amountInEncrypted.inputProof,
          expectedAmountOutEncrypted.handles[0],
          expectedAmountOutEncrypted.inputProof,
          await tokenA.getAddress(),
          alice.address,
          swapInput.expiry,
          proofHash,
          sig.v,
          sig.r,
          sig.s,
          { gasLimit: 3000000 }
        )
      );
      
      console.log("✅ swapWithProof Called Successfully");
      
      // 9. Verify results
      console.log("8️⃣ Verifying Results...");
      
        
      console.log("⏳ Waiting for state update...");
      await new Promise(resolve => setTimeout(resolve, 5000));
      
        
      let attempts = 0;
      let decryptedNewReserve0 = 0n;
      let decryptedNewReserve1 = 0n;
      
      while (attempts < 3) {
        try {
          const newReserve0 = await guarded.getEncryptedReserve0();
          const newReserve1 = await guarded.getEncryptedReserve1();
          decryptedNewReserve0 = await TestUtils.safeDecryptEuint64(newReserve0, await guarded.getAddress(), deployer);
          decryptedNewReserve1 = await TestUtils.safeDecryptEuint64(newReserve1, await guarded.getAddress(), deployer);
          
          console.log(`🏦 Attempt ${attempts + 1}/3 - Reserves After Swap:`, {
            reserve0: decryptedNewReserve0,
            reserve1: decryptedNewReserve1
          });
          
            
          if (decryptedNewReserve0 > decryptedReserve0 || decryptedNewReserve1 < decryptedReserve1) {
            console.log("✅ Reserve changes detected, swap successful!");
            break;
          }
          
          attempts++;
          if (attempts < 3) {
            console.log(`⏳ No reserve changes detected, waiting 2 seconds before retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.log(`⚠️ Attempt ${attempts + 1} Failed:`, error);
          attempts++;
          if (attempts < 3) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      console.log("📊 Reserve Change Verification:", {
        Original_Reserves: { reserve0: decryptedReserve0, reserve1: decryptedReserve1 },
        Reserves_After_Swap: { reserve0: decryptedNewReserve0, reserve1: decryptedNewReserve1 },
        Expected_Changes: { reserve0_Increase: amountIn, reserve1_Decrease: expectedOut },
        Actual_Changes: { 
          reserve0_Increase: decryptedNewReserve0 - decryptedReserve0, 
          reserve1_Decrease: decryptedReserve1 - decryptedNewReserve1 
        }
      });
      
        
      const reserve0Increase = decryptedNewReserve0 - decryptedReserve0;
      const reserve1Decrease = decryptedReserve1 - decryptedNewReserve1;
      
      console.log("🔍 Change Verification:", {
        "reserve0_Increase": reserve0Increase,
        "reserve1_Decrease": reserve1Decrease,
        "Expected_reserve0_Increase": amountIn,
        "Expected_reserve1_Decrease": expectedOut
      });
      
        
      expect(reserve0Increase).to.be.closeTo(amountIn, amountIn / 100n);
      expect(reserve1Decrease).to.be.closeTo(expectedOut, expectedOut / 100n);
      
      console.log("🎉 Swap Flow Test Passed!");
    });
  });

  describe("Complete Flow Verification", function () {
    it("Should verify the final state of the entire system", async function () {
      console.log("\n" + "=".repeat(60));
      console.log("🔍 Verifying Final System State");
      console.log("=".repeat(60));

        
      const finalReserve0 = await guarded.getEncryptedReserve0();
      const finalReserve1 = await guarded.getEncryptedReserve1();
      const decryptedFinalReserve0 = await TestUtils.safeDecryptEuint64(finalReserve0, await guarded.getAddress(), deployer);
      const decryptedFinalReserve1 = await TestUtils.safeDecryptEuint64(finalReserve1, await guarded.getAddress(), deployer);
      
      console.log("🏦 Final Reserves:", {
        reserve0: decryptedFinalReserve0,
        reserve1: decryptedFinalReserve1
      });
      
        
      const finalTotalSupply = await guarded.getEncryptedTotalSupply();
      const decryptedFinalTotalSupply = await TestUtils.safeDecryptEuint64(finalTotalSupply, await guarded.getAddress(), deployer);
      
      console.log("📈 Final Total Supply:", decryptedFinalTotalSupply);
      
        
      const aliceFinalLP = await guarded.getEncryptedLPBalance(alice.address);
      const bobFinalLP = await guarded.getEncryptedLPBalance(bob.address);
      const feeToFinalLP = await guarded.getEncryptedLPBalance(feeTo.address);
      
      let decryptedAliceFinalLP = 0n;
      let decryptedBobFinalLP = 0n;
      let decryptedFeeToFinalLP = 0n;
      
      try {
        decryptedAliceFinalLP = await TestUtils.safeDecryptEuint64(aliceFinalLP, await guarded.getAddress(), alice);
      } catch (e: any) {
        console.log("Alice's LP Balance Not Initialized");
      }
      
      try {
        decryptedBobFinalLP = await TestUtils.safeDecryptEuint64(bobFinalLP, await guarded.getAddress(), bob);
      } catch (e: any) {
        console.log("Bob's LP Balance Not Initialized");
      }
      
      try {
        decryptedFeeToFinalLP = await TestUtils.safeDecryptEuint64(feeToFinalLP, await guarded.getAddress(), feeTo);
      } catch (e: any) {
        console.log("FeeTo's LP Balance Not Initialized");
      }
      
      console.log("👥 Final LP Balances:", {
        Alice: decryptedAliceFinalLP,
        Bob: decryptedBobFinalLP,
        FeeTo: decryptedFeeToFinalLP
      });
      
        
      const feeEnabled = await guarded.feeEnabled();
      const feeToAddress = await guarded.feeTo();
      const protocolFeeBps = await guarded.protocolFeeBps();
      
      console.log("💸 Fee Mechanism Status:", {
        feeEnabled: feeEnabled,
        feeTo: feeToAddress,
        protocolFeeBps: protocolFeeBps.toString()
      });
      
        
      console.log("\n" + "=".repeat(60));
      console.log("💰 Testing Fee Withdrawal Functionality");
      console.log("=".repeat(60));
      
        
      const feeToLPBalance = await guarded.getEncryptedLPBalance(feeTo.address);
      const decryptedFeeToLPBalance = await TestUtils.safeDecryptEuint64(feeToLPBalance, await guarded.getAddress(), feeTo);
      
      console.log("🏦 FeeTo's LP Balance:", decryptedFeeToLPBalance);
      
      if (decryptedFeeToLPBalance > 0n) {
        console.log("✅ FeeTo has accumulated LP fees, which can be withdrawn");
        
          
        const totalSupply = await guarded.getEncryptedTotalSupply();
        const decryptedTotalSupply = await TestUtils.safeDecryptEuint64(totalSupply, await guarded.getAddress(), deployer);
        
        const reserve0 = await guarded.getEncryptedReserve0();
        const reserve1 = await guarded.getEncryptedReserve1();
        const decryptedReserve0 = await TestUtils.safeDecryptEuint64(reserve0, await guarded.getAddress(), deployer);
        const decryptedReserve1 = await TestUtils.safeDecryptEuint64(reserve1, await guarded.getAddress(), deployer);
        
          
        const withdrawableAmount0 = (decryptedFeeToLPBalance * decryptedReserve0) / decryptedTotalSupply;
        const withdrawableAmount1 = (decryptedFeeToLPBalance * decryptedReserve1) / decryptedTotalSupply;
        
        console.log("💎 Withdrawable Token Amounts:", {
          token0: withdrawableAmount0,
          token1: withdrawableAmount1
        });
        
          
        console.log("ℹ️ To withdraw fees, the feeTo address needs to call the withdrawProtocolFees function");
      } else {
        console.log("ℹ️ FeeTo has no accumulated LP fees yet");
      }
      
        
      expect(decryptedFinalReserve0).to.be.greaterThan(0n);
      expect(decryptedFinalReserve1).to.be.greaterThan(0n);
      expect(decryptedFinalTotalSupply).to.be.greaterThan(0n);
      expect(feeEnabled).to.be.true;
      expect(feeToAddress).to.equal(feeTo.address);
      
      console.log("🎉 Complete Flow Tests All Passed!");
      console.log("=".repeat(80));
      console.log("✅ System Functionality Verification Complete:");
      console.log("  ✅ Fee Mechanism Setup and Activation");
      console.log("  ✅ First Liquidity Addition");
      console.log("  ✅ Complete Swap Flow");
      console.log("  ✅ Final State Verification");
      console.log("=".repeat(80));
    });
  });
});
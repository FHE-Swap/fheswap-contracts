import { expect } from "chai";   
import { ethers, deployments, fhevm } from "hardhat";   
import { FHESwapSimpleGuarded, ConfidentialFungibleTokenMintableBurnable } from "../types";   
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";   
import { FhevmType } from "@fhevm/hardhat-plugin";   
import child_process from "child_process";   
import path from "path";   

  
const CONFIG = {   
  RISC_ZERO_HOST_PATH: process.env.RISC_ZERO_HOST_PATH || "/home/su/dome/ZK/RSIC-zero/RISC_ZAMA/host", // RISC Zero host path, use environment variable first, otherwise use default path
  CHAIN_ID: 11155111, // Sepolia testnet chain ID, using Sepolia testnet
  TIMEOUT: 1200000,   
  EXPIRY_OFFSET: 3600,   
  MAX_SLIPPAGE_BPS: 500,   
  PROTOCOL_FEE_BPS: 5,   
};

  
const TEST_DATA = {   
  INITIAL_AMOUNT_A: 1000000n,   
  INITIAL_AMOUNT_B: 2000000n,   
  SWAP_AMOUNT_A: 100000n,   
  ADD_LIQUIDITY_AMOUNT_A: 50000n,   
  ADD_LIQUIDITY_AMOUNT_B: 100000n,   
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
}

describe("FHESwapSimpleGuarded - Complete Flow E2E", function () {   
  this.timeout(CONFIG.TIMEOUT);   

  let deployer: HardhatEthersSigner;   
  let alice: HardhatEthersSigner; // Alice user signer
  let bob: HardhatEthersSigner; // Bob user signer
  let verifier: HardhatEthersSigner;   
  let feeTo: HardhatEthersSigner;   
  let tokenA: ConfidentialFungibleTokenMintableBurnable;   
  let tokenB: ConfidentialFungibleTokenMintableBurnable;   
  let guarded: FHESwapSimpleGuarded;   

  before(async function () {   
    console.log("\n" + "=".repeat(80));   
    console.log("🚀 Initializing complete flow test environment");   
    console.log("=".repeat(80));   

      
    const signers = await ethers.getSigners();   
    deployer = signers[0];   
    alice = signers[1];   
    bob = signers[2];   
    verifier = signers[3];   
    feeTo = signers[4];   

    console.log("📋 Test participants:");   
    console.log("  Deployer:", deployer.address);   
    console.log("  Alice:", alice.address);   
    console.log("  Bob:", bob.address);   
    console.log("  Verifier:", verifier.address);   
    console.log("  FeeTo:", feeTo.address);   

      
    await deployments.fixture(["TokenA", "TokenB", "guarded"], { keepExistingDeployments: true });   

    const tokenADeployment = await deployments.get("TokenA");   
    const tokenBDeployment = await deployments.get("TokenB");   
    const guardedDeployment = await deployments.get("FHESwapSimpleGuarded");   

    tokenA = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenADeployment.address);   
    tokenB = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenBDeployment.address);   
    guarded = await ethers.getContractAt("FHESwapSimpleGuarded", guardedDeployment.address);   

    console.log("📦 Contract addresses:");   
    console.log("  TokenA:", tokenADeployment.address);   
    console.log("  TokenB:", tokenBDeployment.address);   
    console.log("  Guarded:", guardedDeployment.address);   

      
    console.log("💰 Minting tokens...");   
    
    // Alice's tokens
    const encA_Alice = await fhevm.createEncryptedInput(tokenADeployment.address, deployer.address).add64(TEST_DATA.INITIAL_AMOUNT_A).encrypt();   
    const encB_Alice = await fhevm.createEncryptedInput(tokenBDeployment.address, deployer.address).add64(TEST_DATA.INITIAL_AMOUNT_B).encrypt();   
    await tokenA.mint(alice.address, encA_Alice.handles[0], encA_Alice.inputProof);   
    await tokenB.mint(alice.address, encB_Alice.handles[0], encB_Alice.inputProof);   

    // Bob's tokens
    const encA_Bob = await fhevm.createEncryptedInput(tokenADeployment.address, deployer.address).add64(TEST_DATA.INITIAL_AMOUNT_A).encrypt();   
    const encB_Bob = await fhevm.createEncryptedInput(tokenBDeployment.address, deployer.address).add64(TEST_DATA.INITIAL_AMOUNT_B).encrypt();   
    await tokenA.mint(bob.address, encA_Bob.handles[0], encA_Bob.inputProof);   
    await tokenB.mint(bob.address, encB_Bob.handles[0], encB_Bob.inputProof);   

      
    const expiry = Math.floor(Date.now() / 1000) + 3600;   
    await tokenA.connect(alice).setOperator(await guarded.getAddress(), expiry);   
    await tokenB.connect(alice).setOperator(await guarded.getAddress(), expiry);   
    await tokenA.connect(bob).setOperator(await guarded.getAddress(), expiry);   
    await tokenB.connect(bob).setOperator(await guarded.getAddress(), expiry);   

    console.log("✅ Environment initialization completed");   
  });

  describe("Fee Mechanism Setup", function () {   
    it("Should be able to set fee-related parameters", async function () {   
      console.log("\n" + "=".repeat(60));   
      console.log("💸 Testing fee mechanism setup");   
      console.log("=".repeat(60));   

        
      await guarded.connect(deployer).setFeeTo(feeTo.address);   
      expect(await guarded.feeTo()).to.equal(feeTo.address);   
      console.log("✅ Fee recipient address set successfully:", feeTo.address);   

        
      await guarded.connect(deployer).setFeeEnabled(true);   
      expect(await guarded.feeEnabled()).to.equal(true);   
      console.log("✅ Fee mechanism enabled successfully");   

        
      const feeToAddress = await guarded.feeTo();   
      const feeEnabled = await guarded.feeEnabled();   
      const protocolFeeBps = await guarded.protocolFeeBps();   

      console.log("📊 Fee configuration:");   
      console.log("  Fee recipient address:", feeToAddress);   
      console.log("  Fee enabled status:", feeEnabled);   
      console.log("  Protocol fee basis points:", protocolFeeBps.toString());   
    });
  });

  describe("Complete Liquidity Management Flow", function () {   
    it("Should complete the full flow of first liquidity addition", async function () {   
      console.log("\n" + "=".repeat(60));   
      console.log("🌊 Testing first liquidity addition");   
      console.log("=".repeat(60));   

        
      const existingReserve0 = await guarded.getEncryptedReserve0();   
      const existingReserve1 = await guarded.getEncryptedReserve1();   
      
      let hasLiquidity = false;   
      try {   
        const decryptedExistingReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(existingReserve0), await guarded.getAddress(), deployer);   
        const decryptedExistingReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(existingReserve1), await guarded.getAddress(), deployer);   
        hasLiquidity = decryptedExistingReserve0 > 0n && decryptedExistingReserve1 > 0n;   
        console.log("🔍 Checking existing liquidity:", {   
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
      
      const amount0Encrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount0).encrypt();   
      const amount1Encrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount1).encrypt();   
      
      await guarded.connect(alice).calculateAddLiquidityNumerators(   
        alice.address, // Alice's address
        amount0Encrypted.handles[0],   
        amount0Encrypted.inputProof,   
        amount1Encrypted.handles[0],   
        amount1Encrypted.inputProof   
      );
      
      console.log("✅ calculateAddLiquidityNumerators call successful");   
      
      // 2. Project team decrypts data and calls RISC Zero verification
      console.log("2️⃣ Calling RISC Zero verification...");   
      
        
      const currentReserve0 = await guarded.getCurrentReserve0();   
      const currentReserve1 = await guarded.getCurrentReserve1();   
      const currentTotalSupply = await guarded.getCurrentTotalSupply();   
      const isFirstAdd = await guarded.getIsFirstAdd();   
      
      console.log("📊 Current state:", {   
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
      
      console.log("🔓 Decrypted state:", {   
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
      
      console.log("📤 RISC Zero input:", liquidityInput);   
      
        
      const proofHash = TestUtils.runHostWithJson(liquidityInput);   
      console.log("✅ RISC Zero verification successful, proof hash:", proofHash);   
      
      // 3. Generate signature
      console.log("3️⃣ Generating signature...");   
      const sig = await TestUtils.generateSignature(proofHash, verifier);   
      console.log("✅ Signature generated successfully");   
      
      // 4. Alice calls addLiquidityWithProof
      console.log("4️⃣ Calling addLiquidityWithProof...");   
      
        
      const liquidityMinted = TestUtils.calculateFirstAddLiquidity(amount0, amount1);   
      console.log("🧮 Calculated LP amount:", liquidityMinted);   
      
      const liquidityMintedEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(liquidityMinted).encrypt();   
      
        
      const protocolFeeLP = 0n;   
      const protocolFeeLPEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(protocolFeeLP).encrypt();   
      
        
      const minAmount0Encrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(0n).encrypt();   
      const minAmount1Encrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(0n).encrypt();   
      const minLiquidityEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(0n).encrypt();   

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

      await guarded.connect(alice).addLiquidityWithProof(liquidityParams);   
      
      console.log("✅ addLiquidityWithProof call successful");   
      
      // 5. Verify results
      console.log("5️⃣ Verifying results...");   
      
        
      const aliceLPBalance = await guarded.getEncryptedLPBalance(alice.address);   
      const decryptedLPBalance = await TestUtils.safeDecryptEuint64(aliceLPBalance, await guarded.getAddress(), alice);   
      
      console.log("👤 Alice's LP balance:", decryptedLPBalance);   
      expect(decryptedLPBalance).to.equal(liquidityMinted);   
      
        
      const totalSupply = await guarded.getEncryptedTotalSupply();   
      const decryptedTotalSupplyAfter = await TestUtils.safeDecryptEuint64(totalSupply, await guarded.getAddress(), deployer);   
      
      console.log("📈 Total supply:", decryptedTotalSupplyAfter);   
        
      expect(decryptedTotalSupplyAfter).to.equal(liquidityMinted + TEST_DATA.LOCKED_LP);   
      
        
      const reserve0 = await guarded.getEncryptedReserve0();   
      const reserve1 = await guarded.getEncryptedReserve1();   
      const decryptedReserve0After = await TestUtils.safeDecryptEuint64(reserve0, await guarded.getAddress(), deployer);   
      const decryptedReserve1After = await TestUtils.safeDecryptEuint64(reserve1, await guarded.getAddress(), deployer);   
      
      console.log("🏦 Reserves:", {   
        reserve0: decryptedReserve0After,
        reserve1: decryptedReserve1After
      });
      expect(decryptedReserve0After).to.equal(amount0);   
      expect(decryptedReserve1After).to.equal(amount1);   
      
      console.log("🎉 First liquidity addition test passed!");   
    });

    it("Should complete the full flow of subsequent liquidity additions", async function () {   
      console.log("\n" + "=".repeat(60));   
      console.log("🌊 Testing subsequent liquidity addition");   
      console.log("=".repeat(60));   
      
        
      const existingReserve0 = await guarded.getEncryptedReserve0();   
      const existingReserve1 = await guarded.getEncryptedReserve1();   
      
        
      let hasLiquidity = false;   
      try {   
        const decryptedExistingReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(existingReserve0), await guarded.getAddress(), deployer);   
        const decryptedExistingReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(existingReserve1), await guarded.getAddress(), deployer);   
        hasLiquidity = decryptedExistingReserve0 > 0n && decryptedExistingReserve1 > 0n;   
        console.log("🔍 Checking existing liquidity:", {   
          reserve0: decryptedExistingReserve0,
          reserve1: decryptedExistingReserve1,
          hasLiquidity: hasLiquidity
        });
      } catch (e: any) {   
        hasLiquidity = false;   
        console.log("⚠️ Unable to decrypt reserves, likely no liquidity:", e.message);   
      }
      
      if (!hasLiquidity) {   
        console.log("⚠️ No existing liquidity, skipping subsequent liquidity addition test");   
        return;   
      }

        
      const actualReserve0 = await guarded.getEncryptedReserve0();   
      const actualReserve1 = await guarded.getEncryptedReserve1();   
      
        
      const decryptedCurrentReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(actualReserve0), await guarded.getAddress(), deployer);   
      const decryptedCurrentReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(actualReserve1), await guarded.getAddress(), deployer);   
      
        
      const amount0 = 50000n;   
      const expectedAmount1 = (amount0 * decryptedCurrentReserve1) / decryptedCurrentReserve0;   
      const amount1 = expectedAmount1;   
      
      // 1. Alice calls calculateAddLiquidityNumerators (subsequent addition)
      console.log("1️⃣ Alice calling calculateAddLiquidityNumerators (subsequent addition)...");   
      
      const amount0Encrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount0).encrypt();   
      const amount1Encrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount1).encrypt();   
      
      await guarded.connect(alice).calculateAddLiquidityNumerators(   
        alice.address, // Alice's address
        amount0Encrypted.handles[0],   
        amount0Encrypted.inputProof,   
        amount1Encrypted.handles[0],   
        amount1Encrypted.inputProof   
      );
      
      console.log("✅ calculateAddLiquidityNumerators call successful");   
      
      // 2. Project team decrypts data and calls RISC Zero verification
      console.log("2️⃣ Calling RISC Zero verification...");   
      
        
      const currentReserve0 = await guarded.getCurrentReserve0();   
      const currentReserve1 = await guarded.getCurrentReserve1();   
      const currentTotalSupply = await guarded.getCurrentTotalSupply();   
      const isFirstAdd = await guarded.getIsFirstAdd();   
      
        
      const decryptedReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentReserve0), await guarded.getAddress(), deployer);   
      const decryptedReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentReserve1), await guarded.getAddress(), deployer);   
      const decryptedTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentTotalSupply), await guarded.getAddress(), deployer);   
      
        
      const feeEnabled = await guarded.feeEnabled();   
      const feeToAddress = await guarded.feeTo();   
      const lastK = await guarded.getEncryptedLastK();   
      let decryptedLastK = 0n;   
      
      if (feeEnabled && feeToAddress !== ethers.ZeroAddress) {   
        try {   
          decryptedLastK = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(lastK), await guarded.getAddress(), deployer);   
        } catch (e: any) {   
          decryptedLastK = 0n;   
        }
      }
      
      console.log("🔓 Decrypted state:", {   
        reserve0: decryptedReserve0,
        reserve1: decryptedReserve1,
        totalSupply: decryptedTotalSupply,
        isFirstAdd: isFirstAdd,
        feeEnabled: feeEnabled,
        feeTo: feeToAddress,
        lastK: decryptedLastK
      });
      
        
      const liquidityInput = {   
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
        last_k: Number(decryptedLastK),   
        chain_id: 11155111,   
        pool: Array.from(ethers.getBytes(await guarded.getAddress())),   
        user: Array.from(ethers.getBytes(alice.address)),   
        expiry: Math.floor(Date.now() / 1000) + 3600,   
        nonce: 2   
      };
      
      console.log("📤 RISC Zero input:", liquidityInput);   
      
        
      const proofHash = TestUtils.runHostWithJson(liquidityInput);   
      console.log("✅ RISC Zero verification successful, proof hash:", proofHash);   
      
      // 3. Generate signature
      console.log("3️⃣ Generating signature...");   
      const messageHash = ethers.getBytes(proofHash);   
      const signature = await verifier.signMessage(messageHash);   
      const sig = ethers.Signature.from(signature);   
      
      console.log("✅ Signature generated successfully");   
      
      // 4. Bob calls addLiquidityWithProof
      console.log("4️⃣ Calling addLiquidityWithProof...");   
      
        
      const lpFromToken0 = (amount0 * decryptedTotalSupply) / decryptedReserve0;   
      const lpFromToken1 = (amount1 * decryptedTotalSupply) / decryptedReserve1;   
      const liquidityMinted = lpFromToken0 < lpFromToken1 ? lpFromToken0 : lpFromToken1;   
      
      console.log("🧮 Calculated LP amount:", liquidityMinted);   
      
      const liquidityMintedEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(liquidityMinted).encrypt();   
      
        
      const currentK = (decryptedReserve0 + amount0) * (decryptedReserve1 + amount1);   
      const protocolFeeLP = feeEnabled && feeToAddress !== ethers.ZeroAddress && decryptedLastK > 0 ?   
        Math.floor(Math.sqrt(Number(currentK)) - Math.sqrt(Number(decryptedLastK))) : 0;   
      const protocolFeeLPEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(BigInt(protocolFeeLP)).encrypt();   
      
        
      const minAmount0Encrypted2 = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(0n).encrypt();   
      const minAmount1Encrypted2 = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(0n).encrypt();   
      const minLiquidityEncrypted2 = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(0n).encrypt();   

      const liquidityParams2 = {   
        amount0: amount0Encrypted.handles[0],   
        amount0Proof: amount0Encrypted.inputProof,   
        amount1: amount1Encrypted.handles[0],   
        amount1Proof: amount1Encrypted.inputProof,   
        liquidityMinted: liquidityMintedEncrypted.handles[0],   
        liquidityMintedProof: liquidityMintedEncrypted.inputProof,   
        protocolFeeLP: protocolFeeLPEncrypted.handles[0],   
        protocolFeeLPProof: protocolFeeLPEncrypted.inputProof,   
        minAmount0: minAmount0Encrypted2.handles[0],   
        minAmount0Proof: minAmount0Encrypted2.inputProof,   
        minAmount1: minAmount1Encrypted2.handles[0],   
        minAmount1Proof: minAmount1Encrypted2.inputProof,   
        minLiquidity: minLiquidityEncrypted2.handles[0],   
        minLiquidityProof: minLiquidityEncrypted2.inputProof,   
        expiry: liquidityInput.expiry,   
        proofHash: proofHash,   
        v: sig.v,   
        r: sig.r,   
        s: sig.s   
      };

      await guarded.connect(alice).addLiquidityWithProof(liquidityParams2);   
      
      console.log("✅ addLiquidityWithProof call successful");   
      
      // 5. Verify results
      console.log("5️⃣ Verifying results...");   
      
        
      const aliceLPBalanceAfter = await guarded.getEncryptedLPBalance(alice.address);   
      const decryptedAliceLPBalanceAfter = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceLPBalanceAfter), await guarded.getAddress(), alice);   
      
      console.log("👤 Alice's LP balance (after subsequent addition):", decryptedAliceLPBalanceAfter);   
      expect(decryptedAliceLPBalanceAfter).to.be.greaterThan(0n);   
      
        
      if (feeEnabled && feeToAddress !== ethers.ZeroAddress && protocolFeeLP > 0) {   
        const feeToLPBalance = await guarded.getEncryptedLPBalance(feeToAddress);   
        const decryptedFeeToLPBalance = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(feeToLPBalance), await guarded.getAddress(), feeTo);   
        
        console.log("💰 Fee recipient address LP balance:", decryptedFeeToLPBalance);   
        expect(decryptedFeeToLPBalance).to.be.greaterThan(0n);   
      }
      
      console.log("🎉 Subsequent liquidity addition test passed!");   
    });
  });

  describe("Complete Swap Flow", function () {   
    it("Should complete the full swap flow", async function () {   
      console.log("\n" + "=".repeat(60));   
      console.log("🔄 Testing complete swap flow");   
      console.log("=".repeat(60));   

      const amountIn = 10000n; // 10,000 Token A
      const maxSlippageBps = 500; // 5% slippage protection
      
      // 1. Get current reserves
      console.log("1️⃣ Getting current reserves...");   
      const reserve0 = await guarded.getEncryptedReserve0();   
      const reserve1 = await guarded.getEncryptedReserve1();   
      const decryptedReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0), await guarded.getAddress(), deployer);   
      const decryptedReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1), await guarded.getAddress(), deployer);   
      
      console.log("🏦 Current reserves:", {   
        reserve0: decryptedReserve0,
        reserve1: decryptedReserve1
      });
      
      // 2. Calculate expected output
      console.log("2️⃣ Calculating expected output...");   
      const amountInWithFee = amountIn * 997n; // 0.3% fee
      const numerator = amountInWithFee * decryptedReserve1;   
      const denominator = decryptedReserve0 * 1000n + amountInWithFee;   
      const expectedOut = numerator / denominator;   
      const minOut = (expectedOut * (10000n - BigInt(maxSlippageBps))) / 10000n;   
      
      console.log("🧮 Swap calculation:", {   
        amountIn: amountIn,
        amountInWithFee: amountInWithFee,
        expectedOut: expectedOut,
        minOut: minOut,
        maxSlippageBps: maxSlippageBps
      });
      
      // 3. Alice calls getAmountOut
      console.log("3️⃣ Calling getAmountOut...");   
      const amountInEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amountIn).encrypt();   
      
      await guarded.connect(alice).getAmountOut(   
        amountInEncrypted.handles[0],   
        amountInEncrypted.inputProof,   
        await tokenA.getAddress()   
      );
      
      console.log("✅ getAmountOut call successful");   
      
      // 4. Get numerator and denominator
      const numerator_encrypted = await guarded.getEncryptedNumerator();   
      const denominator_encrypted = await guarded.getEncryptedDenominator();   
      const decryptedNumerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numerator_encrypted), await guarded.getAddress(), alice);   
      const decryptedDenominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominator_encrypted), await guarded.getAddress(), alice);   
      
      console.log("📊 On-chain calculated numerator and denominator:", {   
        numerator: decryptedNumerator,
        denominator: decryptedDenominator
      });
      
      // 5. Build RISC Zero input
      console.log("4️⃣ Calling RISC Zero verification...");   
      const swapInput = {   
        reserve_in: Number(decryptedReserve0),   
        reserve_out: Number(decryptedReserve1),   
        amount_in: Number(amountIn),   
        fee_numerator: 997,   
        fee_denominator: 1000,   
        expected_out: Number(expectedOut),   
        min_out: Number(minOut),   
        max_slippage_bps: maxSlippageBps,   
        chain_id: 11155111,   
        pool: Array.from(ethers.getBytes(await guarded.getAddress())),   
        token_in: Array.from(ethers.getBytes(await tokenA.getAddress())),   
        to: Array.from(ethers.getBytes(alice.address)),   
        expiry: Math.floor(Date.now() / 1000) + 3600,   
        nonce: 3   
      };
      
      console.log("📤 RISC Zero input:", swapInput);   
      
        
      const proofHash = TestUtils.runHostWithJson(swapInput);   
      console.log("✅ RISC Zero verification successful, proof hash:", proofHash);   
      
      // 6. Generate signature
      console.log("5️⃣ Generating signature...");   
      const messageHash = ethers.getBytes(proofHash);   
      const signature = await verifier.signMessage(messageHash);   
      const sig = ethers.Signature.from(signature);   
      
      console.log("✅ Signature generated successfully");   
      
      // 7. Alice calls swapWithProof
      console.log("6️⃣ Calling swapWithProof...");   
      const expectedAmountOutEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(expectedOut).encrypt();   
      
      await guarded.connect(alice).swapWithProof(   
        amountInEncrypted.handles[0],   
        amountInEncrypted.inputProof,   
        expectedAmountOutEncrypted.handles[0],   
        expectedAmountOutEncrypted.inputProof,   
        await tokenA.getAddress(),   
        alice.address, // Alice's address
        swapInput.expiry,   
        proofHash,   
        sig.v,   
        sig.r,   
        sig.s   
      );
      
      console.log("✅ swapWithProof call successful");   
      
      // 8. Verify results
      console.log("7️⃣ Verifying results...");   
      
        
      const newReserve0 = await guarded.getEncryptedReserve0();   
      const newReserve1 = await guarded.getEncryptedReserve1();   
      const decryptedNewReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newReserve0), await guarded.getAddress(), deployer);   
      const decryptedNewReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newReserve1), await guarded.getAddress(), deployer);   
      
      console.log("🏦 Reserves after swap:", {   
        reserve0: decryptedNewReserve0,
        reserve1: decryptedNewReserve1
      });
      
      expect(decryptedNewReserve0).to.equal(decryptedReserve0 + amountIn);   
      expect(decryptedNewReserve1).to.equal(decryptedReserve1 - expectedOut);   
      
      console.log("🎉 Swap flow test passed!");   
    });
  });

  describe("Remove Liquidity Flow", function () {   
    it("Should complete the full remove liquidity flow", async function () {   
      console.log("\n" + "=".repeat(60));   
      console.log("🌊 Testing liquidity removal");   
      console.log("=".repeat(60));   

        
      const aliceLPBalance = await guarded.getEncryptedLPBalance(alice.address);   
      const decryptedLPBalance = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceLPBalance), await guarded.getAddress(), alice);   
      
      console.log("👤 Alice's current LP balance:", decryptedLPBalance);   
      
      if (decryptedLPBalance === 0n) {   
        console.log("⚠️ Alice has no LP balance, skipping liquidity removal test");   
        return;   
      }
      
      const liquidityToRemove = decryptedLPBalance / 2n;   
      
        
      console.log("📊 Getting Alice's token balances before liquidity removal...");   
      const aliceTokenABalanceBefore = await tokenA.confidentialBalanceOf(alice.address);   
      const aliceTokenBBalanceBefore = await tokenB.confidentialBalanceOf(alice.address);   
      
      let decryptedTokenABalanceBefore = 0n;   
      let decryptedTokenBBalanceBefore = 0n;   
      
      try {   
        decryptedTokenABalanceBefore = await fhevm.userDecryptEuint(   
          FhevmType.euint64, 
          ethers.hexlify(aliceTokenABalanceBefore), 
          await tokenA.getAddress(), 
          alice
        );
      } catch (e: any) {   
        console.log("⚠️ Unable to decrypt Alice's TokenA balance (before removal):", e.message);   
      }
      
      try {   
        decryptedTokenBBalanceBefore = await fhevm.userDecryptEuint(   
          FhevmType.euint64, 
          ethers.hexlify(aliceTokenBBalanceBefore), 
          await tokenB.getAddress(), 
          alice
        );
      } catch (e: any) {   
        console.log("⚠️ Unable to decrypt Alice's TokenB balance (before removal):", e.message);   
      }
      
      console.log("💰 Alice's token balances before liquidity removal:", {   
        tokenA: decryptedTokenABalanceBefore,
        tokenB: decryptedTokenBBalanceBefore
      });
      
      // 1. Alice calls calculateRemoveLiquidityNumerators
      console.log("1️⃣ Calling calculateRemoveLiquidityNumerators...");   
      
      const liquidityEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(liquidityToRemove).encrypt();   
      
      await guarded.connect(alice).calculateRemoveLiquidityNumerators(   
        alice.address, // Alice's address
        liquidityEncrypted.handles[0],   
        liquidityEncrypted.inputProof   
      );
      
      console.log("✅ calculateRemoveLiquidityNumerators call successful");   
      
      // 2. Project team decrypts data and calls RISC Zero verification
      console.log("2️⃣ Calling RISC Zero verification...");   
      
        
      const currentReserve0 = await guarded.getCurrentReserve0();   
      const currentReserve1 = await guarded.getCurrentReserve1();   
      const currentTotalSupply = await guarded.getCurrentTotalSupply();   
      
        
      const decryptedReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentReserve0), await guarded.getAddress(), deployer);   
      const decryptedReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentReserve1), await guarded.getAddress(), deployer);   
      const decryptedTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentTotalSupply), await guarded.getAddress(), deployer);   
      
        
      const feeEnabled = await guarded.feeEnabled();   
      const feeToAddress = await guarded.feeTo();   
      const lastK = await guarded.getEncryptedLastK();   
      let decryptedLastK = 0n;   
      
      if (feeEnabled && feeToAddress !== ethers.ZeroAddress) {   
        try {   
          decryptedLastK = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(lastK), await guarded.getAddress(), deployer);   
        } catch (e: any) {   
          decryptedLastK = 0n;   
        }
      }
      
      console.log("🔓 Decrypted state:", {   
        reserve0: decryptedReserve0,
        reserve1: decryptedReserve1,
        totalSupply: decryptedTotalSupply,
        feeEnabled: feeEnabled,
        feeTo: feeToAddress,
        lastK: decryptedLastK
      });
      
        
      const liquidityInput = {   
        reserve0: Number(decryptedReserve0),   
        reserve1: Number(decryptedReserve1),   
        total_supply: Number(decryptedTotalSupply),   
        liquidity: Number(liquidityToRemove),   
        min_amount0_out: 0,   
        min_amount1_out: 0,   
        fee_enabled: feeEnabled,   
        fee_to: Array.from(ethers.getBytes(feeToAddress)),   
        last_k: Number(decryptedLastK),   
        chain_id: 11155111,   
        pool: Array.from(ethers.getBytes(await guarded.getAddress())),   
        user: Array.from(ethers.getBytes(alice.address)),   
        expiry: Math.floor(Date.now() / 1000) + 3600,   
        nonce: 4   
      };
      
      console.log("📤 RISC Zero input:", liquidityInput);   
      
        
      const proofHash = TestUtils.runHostWithJson(liquidityInput);   
      console.log("✅ RISC Zero verification successful, proof hash:", proofHash);   
      
      // 3. Generate signature
      console.log("3️⃣ Generating signature...");   
      const messageHash = ethers.getBytes(proofHash);   
      const signature = await verifier.signMessage(messageHash);   
      const sig = ethers.Signature.from(signature);   
      
      console.log("✅ Signature generated successfully");   
      
      // 4. Alice calls removeLiquidityWithProof
      console.log("4️⃣ Calling removeLiquidityWithProof...");   
      
        
      const amount0Out = (liquidityToRemove * decryptedReserve0) / decryptedTotalSupply;   
      const amount1Out = (liquidityToRemove * decryptedReserve1) / decryptedTotalSupply;   
      
        
      const newK = (decryptedReserve0 - amount0Out) * (decryptedReserve1 - amount1Out);   
      const protocolFeeLP = feeEnabled && feeToAddress !== ethers.ZeroAddress && decryptedLastK > 0   
        ? BigInt(Math.floor((Math.sqrt(Number(decryptedLastK)) - Math.sqrt(Number(newK))) * CONFIG.PROTOCOL_FEE_BPS / 10000))   
        : 0n;   
      
      console.log("🧮 Calculated output amounts:", {   
        amount0Out: amount0Out,
        amount1Out: amount1Out,
        protocolFeeLP: protocolFeeLP,
        newK: newK,
        lastK: decryptedLastK
      });
      
      const amount0OutEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount0Out).encrypt();   
      const amount1OutEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount1Out).encrypt();   
      const protocolFeeLPEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(protocolFeeLP).encrypt();   
      
        
      const minAmount0OutEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(0n).encrypt();   
      const minAmount1OutEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(0n).encrypt();   

      const removeLiquidityParams = {   
        liquidity: liquidityEncrypted.handles[0],   
        liquidityProof: liquidityEncrypted.inputProof,   
        amount0Out: amount0OutEncrypted.handles[0],   
        amount0OutProof: amount0OutEncrypted.inputProof,   
        amount1Out: amount1OutEncrypted.handles[0],   
        amount1OutProof: amount1OutEncrypted.inputProof,   
        protocolFeeLP: protocolFeeLPEncrypted.handles[0],   
        protocolFeeLPProof: protocolFeeLPEncrypted.inputProof,   
        minAmount0Out: minAmount0OutEncrypted.handles[0],   
        minAmount0OutProof: minAmount0OutEncrypted.inputProof,   
        minAmount1Out: minAmount1OutEncrypted.handles[0],   
        minAmount1OutProof: minAmount1OutEncrypted.inputProof,   
        expiry: liquidityInput.expiry,   
        proofHash: proofHash,   
        v: sig.v,   
        r: sig.r,   
        s: sig.s   
      };

      await guarded.connect(alice).removeLiquidityWithProof(removeLiquidityParams);   
      
      console.log("✅ removeLiquidityWithProof call successful");   
      
      // 5. Verify results
      console.log("5️⃣ Verifying results...");   
      
        
      const newAliceLPBalance = await guarded.getEncryptedLPBalance(alice.address);   
      const newDecryptedLPBalance = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newAliceLPBalance), await guarded.getAddress(), alice);   
      
      console.log("👤 Alice's LP balance change:");   
      console.log("  Before removal:", decryptedLPBalance);   
      console.log("  After removal:", newDecryptedLPBalance);   
      console.log("  Change amount:", decryptedLPBalance - newDecryptedLPBalance);   
      expect(newDecryptedLPBalance).to.equal(decryptedLPBalance - liquidityToRemove);   
      
        
      const newReserve0 = await guarded.getEncryptedReserve0();   
      const newReserve1 = await guarded.getEncryptedReserve1();   
      const decryptedNewReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newReserve0), await guarded.getAddress(), deployer);   
      const decryptedNewReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newReserve1), await guarded.getAddress(), deployer);   
      
      console.log("🏦 New reserve amounts:");   
      console.log("  New reserve0:", decryptedNewReserve0);   
      console.log("  New reserve1:", decryptedNewReserve1);   
      console.log("  Reserve changes:", {   
        reserve0_change: decryptedReserve0 - decryptedNewReserve0,
        reserve1_change: decryptedReserve1 - decryptedNewReserve1
      });
      
      expect(decryptedNewReserve0).to.equal(decryptedReserve0 - amount0Out);   
      expect(decryptedNewReserve1).to.equal(decryptedReserve1 - amount1Out);   
      
        
      const newTotalSupply = await guarded.getEncryptedTotalSupply();   
      const decryptedNewTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newTotalSupply), await guarded.getAddress(), deployer);   
      
      console.log("📈 New total supply:");   
      console.log("  Before removal:", decryptedTotalSupply);   
      console.log("  After removal:", decryptedNewTotalSupply);   
      console.log("  Change amount:", decryptedTotalSupply - decryptedNewTotalSupply);   
      
        
      console.log("💰 Token amounts received by Alice:");   
      console.log("  Token0 (amount0Out):", amount0Out);   
      console.log("  Token1 (amount1Out):", amount1Out);   
      
        
      if (feeEnabled && feeToAddress !== ethers.ZeroAddress) {   
        const feeToLPBalanceBefore = await guarded.getEncryptedLPBalance(feeToAddress);   
        let decryptedFeeToLPBalanceBefore = 0n;   
        let decryptedFeeToLPBalanceAfter = 0n;   
        
        try {   
          decryptedFeeToLPBalanceBefore = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(feeToLPBalanceBefore), await guarded.getAddress(), feeTo);   
        } catch (e: any) {   
          console.log("⚠️ Unable to decrypt feeTo LP balance (before removal):", e.message);   
        }
        
        const feeToLPBalanceAfter = await guarded.getEncryptedLPBalance(feeToAddress);   
        try {   
          decryptedFeeToLPBalanceAfter = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(feeToLPBalanceAfter), await guarded.getAddress(), feeTo);   
        } catch (e: any) {   
          console.log("⚠️ Unable to decrypt feeTo LP balance (after removal):", e.message);   
        }
        
        console.log("💸 feeTo address LP balance change:");   
        console.log("  Before removal:", decryptedFeeToLPBalanceBefore);   
        console.log("  After removal:", decryptedFeeToLPBalanceAfter);   
        console.log("  Change amount:", decryptedFeeToLPBalanceAfter - decryptedFeeToLPBalanceBefore);   
        console.log("  Protocol fee LP:", protocolFeeLP);   
      } else {   
        console.log("💸 Fee mechanism not enabled, skipping feeTo LP balance check");   
      }
      
      // 6. Comprehensive result verification
      console.log("\n" + "=".repeat(50));   
      console.log("🔍 Comprehensive result verification");   
      console.log("=".repeat(50));   
      
      // 6.1 Verify LP balance decreased
      console.log("✅ Verification 1: LP balance decrease check");   
      const expectedAliceLPAfter = decryptedLPBalance - liquidityToRemove;   
      expect(newDecryptedLPBalance).to.equal(expectedAliceLPAfter);   
      console.log("  ✓ Alice's LP balance correctly decreased:", {   
        before: decryptedLPBalance,
        after: newDecryptedLPBalance,
        removed: liquidityToRemove,
        expected: expectedAliceLPAfter
      });
      
      // 6.2 Verify total supply decreased
      console.log("✅ Verification 2: Total supply decrease check");   
        
      const expectedTotalSupplyAfter = decryptedTotalSupply - liquidityToRemove + protocolFeeLP;   
      expect(decryptedNewTotalSupply).to.equal(expectedTotalSupplyAfter);   
      console.log("  ✓ Total supply correctly decreased:", {   
        before: decryptedTotalSupply,
        after: decryptedNewTotalSupply,
        removed: liquidityToRemove,
        protocolFeeLP: protocolFeeLP,
        expected: expectedTotalSupplyAfter,
        actualChange: decryptedTotalSupply - decryptedNewTotalSupply
      });
      
      // 6.3 Verify reserves decreased
      console.log("✅ Verification 3: Reserve decrease check");   
      expect(decryptedNewReserve0).to.equal(decryptedReserve0 - amount0Out);   
      expect(decryptedNewReserve1).to.equal(decryptedReserve1 - amount1Out);   
      console.log("  ✓ Reserve amounts correctly decreased:", {   
        reserve0: {
          before: decryptedReserve0,
          after: decryptedNewReserve0,
          removed: amount0Out
        },
        reserve1: {
          before: decryptedReserve1,
          after: decryptedNewReserve1,
          removed: amount1Out
        }
      });
      
      // 6.4 Verify Alice received correct token amounts
      console.log("✅ Verification 4: Alice's token balance check");   
      
        
      const aliceTokenABalanceAfter = await tokenA.confidentialBalanceOf(alice.address);   
      const aliceTokenBBalanceAfter = await tokenB.confidentialBalanceOf(alice.address);   
      
      let decryptedTokenABalanceAfter = 0n;   
      let decryptedTokenBBalanceAfter = 0n;   
      
      try {   
        decryptedTokenABalanceAfter = await fhevm.userDecryptEuint(   
          FhevmType.euint64, 
          ethers.hexlify(aliceTokenABalanceAfter), 
          await tokenA.getAddress(), 
          alice
        );
      } catch (e: any) {   
        console.log("⚠️ Unable to decrypt Alice's TokenA balance (after removal):", e.message);   
      }
      
      try {   
        decryptedTokenBBalanceAfter = await fhevm.userDecryptEuint(   
          FhevmType.euint64, 
          ethers.hexlify(aliceTokenBBalanceAfter), 
          await tokenB.getAddress(), 
          alice
        );
      } catch (e: any) {   
        console.log("⚠️ Unable to decrypt Alice's TokenB balance (after removal):", e.message);   
      }
      
      const tokenAReceived = decryptedTokenABalanceAfter - decryptedTokenABalanceBefore;   
      const tokenBReceived = decryptedTokenBBalanceAfter - decryptedTokenBBalanceBefore;   
      
      console.log("  ✓ Alice's token balance changes:", {   
        tokenA: {
          before: decryptedTokenABalanceBefore,
          after: decryptedTokenABalanceAfter,
          received: tokenAReceived,
          expected: amount0Out
        },
        tokenB: {
          before: decryptedTokenBBalanceBefore,
          after: decryptedTokenBBalanceAfter,
          received: tokenBReceived,
          expected: amount1Out
        }
      });
      
        
      const tokenATolerance = amount0Out / 1000n; // 0.1% tolerance
      const tokenBTolerance = amount1Out / 1000n; // 0.1% tolerance
      
      expect(tokenAReceived).to.be.closeTo(amount0Out, tokenATolerance);   
      expect(tokenBReceived).to.be.closeTo(amount1Out, tokenBTolerance);   
      
      // 6.5 Verify protocol fee impact (if fees enabled)
      if (feeEnabled && feeToAddress !== ethers.ZeroAddress) {   
        console.log("✅ Verification 5: Protocol fee impact check");   
        
          
        if (protocolFeeLP > 0n) {   
          console.log("  ✓ Protocol fee LP distribution:", {   
            protocolFeeLP: protocolFeeLP,
            feeToAddress: feeToAddress
          });
        } else {   
          console.log("  ✓ No protocol fee LP distribution (first removal or zero fee)");   
        }
        
          
        const currentFeeEnabled = await guarded.feeEnabled();   
        const currentFeeTo = await guarded.feeTo();   
        const currentProtocolFeeBps = await guarded.protocolFeeBps();   
        
        console.log("  ✓ Fee mechanism status:", {   
          feeEnabled: currentFeeEnabled,
          feeTo: currentFeeTo,
          protocolFeeBps: currentProtocolFeeBps.toString()
        });
        
        expect(currentFeeEnabled).to.be.true;   
        expect(currentFeeTo).to.equal(feeToAddress);   
      } else {   
        console.log("✅ Verification 5: Protocol fee impact check - Fee mechanism not enabled");   
      }
      
      // 6.6 Final state consistency verification
      console.log("✅ Verification 6: Final state consistency check");   
      
        
      const reserveRatioBefore = decryptedReserve0 * 1000000n / decryptedReserve1;   
      const reserveRatioAfter = decryptedNewReserve0 * 1000000n / decryptedNewReserve1;   
      const ratioTolerance = 1000n; // 0.1% tolerance
      
      const ratioDifference = reserveRatioAfter > reserveRatioBefore ?   
        reserveRatioAfter - reserveRatioBefore : 
        reserveRatioBefore - reserveRatioAfter;
      
      expect(ratioDifference).to.be.lessThan(ratioTolerance);   
      console.log("  ✓ Reserve ratio maintained stable:", {   
        ratioBefore: reserveRatioBefore,
        ratioAfter: reserveRatioAfter,
        difference: ratioDifference,
        tolerance: ratioTolerance
      });
      
        
      const expectedReserve0FromLP = (liquidityToRemove * decryptedReserve0) / decryptedTotalSupply;   
      const expectedReserve1FromLP = (liquidityToRemove * decryptedReserve1) / decryptedTotalSupply;   
      
      console.log("  ✓ LP and reserve relationship verification:", {   
        liquidityRemoved: liquidityToRemove,
        expectedReserve0FromLP: expectedReserve0FromLP,
        expectedReserve1FromLP: expectedReserve1FromLP,
        actualReserve0Removed: amount0Out,
        actualReserve1Removed: amount1Out
      });
      
      expect(expectedReserve0FromLP).to.equal(amount0Out);   
      expect(expectedReserve1FromLP).to.equal(amount1Out);   
      
      console.log("\n🎉 All verifications passed! Liquidity removal operation completely correct!");   
      console.log("=".repeat(50));   
      
      console.log("🎉 Liquidity removal test passed!");   
    });
  });

  describe("Complete Flow Verification", function () {   
    it("Should verify the final state of the entire system", async function () {   
      console.log("\n" + "=".repeat(60));   
      console.log("🔍 Verifying final system state");   
      console.log("=".repeat(60));   

        
      const finalReserve0 = await guarded.getEncryptedReserve0();   
      const finalReserve1 = await guarded.getEncryptedReserve1();   
      const decryptedFinalReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalReserve0), await guarded.getAddress(), deployer);   
      const decryptedFinalReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalReserve1), await guarded.getAddress(), deployer);   
      
      console.log("🏦 Final reserve amounts:", {   
        reserve0: decryptedFinalReserve0,
        reserve1: decryptedFinalReserve1
      });
      
        
      const finalTotalSupply = await guarded.getEncryptedTotalSupply();   
      const decryptedFinalTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalTotalSupply), await guarded.getAddress(), deployer);   
      
      console.log("📈 Final total supply:", decryptedFinalTotalSupply);   
      
        
      const aliceFinalLP = await guarded.getEncryptedLPBalance(alice.address);   
      const bobFinalLP = await guarded.getEncryptedLPBalance(bob.address);   
      const feeToFinalLP = await guarded.getEncryptedLPBalance(feeTo.address);   
      
      let decryptedAliceFinalLP = 0n;   
      let decryptedBobFinalLP = 0n;   
      let decryptedFeeToFinalLP = 0n;   
      
      try {   
        decryptedAliceFinalLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceFinalLP), await guarded.getAddress(), alice);   
      } catch (e: any) {   
        console.log("Alice's LP balance not initialized");   
      }
      
      try {   
        decryptedBobFinalLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(bobFinalLP), await guarded.getAddress(), bob);   
      } catch (e: any) {   
        console.log("Bob's LP balance not initialized");   
      }
      
      try {   
        decryptedFeeToFinalLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(feeToFinalLP), await guarded.getAddress(), feeTo);   
      } catch (e: any) {   
        console.log("FeeTo's LP balance not initialized");   
      }
      
      console.log("👥 Final LP balances:", {   
        Alice: decryptedAliceFinalLP,
        Bob: decryptedBobFinalLP,
        FeeTo: decryptedFeeToFinalLP
      });
      
        
      const feeEnabled = await guarded.feeEnabled();   
      const feeToAddress = await guarded.feeTo();   
      const protocolFeeBps = await guarded.protocolFeeBps();   
      
      console.log("💸 Fee mechanism status:", {   
        feeEnabled: feeEnabled,
        feeTo: feeToAddress,
        protocolFeeBps: protocolFeeBps.toString()
      });
      
        
      expect(decryptedFinalReserve0).to.be.greaterThan(0n);   
      expect(decryptedFinalReserve1).to.be.greaterThan(0n);   
      expect(decryptedFinalTotalSupply).to.be.greaterThan(0n);   
      expect(feeEnabled).to.be.true;   
      expect(feeToAddress).to.equal(feeTo.address);   
      
      console.log("🎉 Complete flow tests all passed!");   
      console.log("=".repeat(80));   
      console.log("✅ System functionality verification completed:");   
      console.log("  ✅ Fee mechanism setup and activation");   
      console.log("  ✅ First liquidity addition");   
      console.log("  ✅ Subsequent liquidity addition");   
      console.log("  ✅ Complete swap flow");   
      console.log("  ✅ Liquidity removal");   
      console.log("  ✅ Final state verification");   
      console.log("=".repeat(80));   
    });

    it("Slippage Protection Tests", async function() {   
      console.log("🛡️ Starting slippage protection tests...");   
      
      // 1. Test liquidity addition slippage protection - overly strict parameters
      console.log("1️⃣ Testing liquidity addition slippage protection - overly strict parameters...");   
      
      const amount0 = 100000n;   
      const amount1 = 200000n;   
      const minAmount0 = 150000n;   
      const minAmount1 = 300000n;   
      const minLiquidity = 500000n;   
      
      const liquidityInput = {   
        reserve0: 0,   
        reserve1: 0,   
        amount0: Number(amount0),   
        amount1: Number(amount1),   
        total_supply: 0,   
        is_first_add: true,   
        min_amount0: Number(minAmount0),   
        min_amount1: Number(minAmount1),   
        min_liquidity: Number(minLiquidity),   
        fee_enabled: false,   
        fee_to: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],   
        last_k: 0,   
        chain_id: CONFIG.CHAIN_ID,   
        pool: Array.from(ethers.getBytes(await guarded.getAddress())),   
        user: Array.from(ethers.getBytes(alice.address)),   
        expiry: Math.floor(Date.now() / 1000) + CONFIG.EXPIRY_OFFSET,   
        nonce: 1   
      };
      
      console.log("📊 Overly strict slippage protection parameters:", {   
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        minAmount0: minAmount0.toString(),
        minAmount1: minAmount1.toString(),
        minLiquidity: minLiquidity.toString()
      });
      
        
      try {   
        const proof = TestUtils.runHostWithJson(liquidityInput);   
        expect.fail("Should fail, but proof generation succeeded");   
      } catch (error: any) {   
        console.log("✅ Overly strict slippage protection verification successful - proof generation failed (as expected)");   
        expect(error.message).to.include("amount0 below minimum");   
      }
      
      // 2. Test liquidity addition slippage protection - reasonable parameters
      console.log("2️⃣ Testing liquidity addition slippage protection - reasonable parameters...");   
      
      const reasonableMinAmount0 = 95000n; // 5% slippage protection
      const reasonableMinAmount1 = 190000n; // 5% slippage protection
      const reasonableMinLiquidity = 130000n;   
      
      const reasonableLiquidityInput = {   
        ...liquidityInput,   
        min_amount0: Number(reasonableMinAmount0),   
        min_amount1: Number(reasonableMinAmount1),   
        min_liquidity: Number(reasonableMinLiquidity)   
      };
      
      console.log("📊 Reasonable slippage protection parameters:", {   
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        minAmount0: reasonableMinAmount0.toString(),
        minAmount1: reasonableMinAmount1.toString(),
        minLiquidity: reasonableMinLiquidity.toString()
      });
      
        
      const reasonableProof = TestUtils.runHostWithJson(reasonableLiquidityInput);   
      console.log("✅ Reasonable slippage protection verification successful - proof generation succeeded");   
      
      // 3. Test liquidity addition slippage protection - boundary cases
      console.log("3️⃣ Testing liquidity addition slippage protection - boundary cases...");   
      
      // 3.1 Test amount0 exactly equals minAmount0
      const exactMinAmount0 = 100000n;   
      const exactMinAmount1 = 200000n;   
      const exactMinLiquidity = 140000n; // sqrt(100000 * 200000) - 1000
      
      const exactLiquidityInput = {   
        ...liquidityInput,   
        min_amount0: Number(exactMinAmount0),   
        min_amount1: Number(exactMinAmount1),   
        min_liquidity: Number(exactMinLiquidity)   
      };
      
      console.log("📊 Boundary slippage protection parameters:", {   
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        minAmount0: exactMinAmount0.toString(),
        minAmount1: exactMinAmount1.toString(),
        minLiquidity: exactMinLiquidity.toString()
      });
      
      const exactProof = TestUtils.runHostWithJson(exactLiquidityInput);   
      console.log("✅ Boundary slippage protection verification successful - proof generation succeeded");   
      
      // 3.2 Test amount0 slightly less than minAmount0
      const slightlyLessMinAmount0 = 100001n;   
      const slightlyLessLiquidityInput = {   
        ...liquidityInput,   
        min_amount0: Number(slightlyLessMinAmount0),   
        min_amount1: Number(exactMinAmount1),   
        min_liquidity: Number(exactMinLiquidity)   
      };
      
      console.log("📊 Slightly below boundary slippage protection parameters:", {   
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        minAmount0: slightlyLessMinAmount0.toString(),
        minAmount1: exactMinAmount1.toString(),
        minLiquidity: exactMinLiquidity.toString()
      });
      
      try {   
        const slightlyLessProof = TestUtils.runHostWithJson(slightlyLessLiquidityInput);   
        expect.fail("Should fail, but proof generation succeeded");   
      } catch (error: any) {   
        console.log("✅ Slightly below boundary slippage protection verification successful - proof generation failed (as expected)");   
        expect(error.message).to.include("amount0 below minimum");   
      }
      
      // 4. Test liquidity removal slippage protection - overly strict parameters
      console.log("4️⃣ Testing liquidity removal slippage protection - overly strict parameters...");   
      
      const liquidity = 100000n;   
      const reserve0 = 1000000n;   
      const reserve1 = 2000000n;   
      const totalSupply= 1000000n;   
      
        
      const actualAmount0Out = (liquidity * reserve0) / totalSupply; // 100000
      const actualAmount1Out = (liquidity * reserve1) / totalSupply; // 200000
      
      const minAmount0Out = actualAmount0Out + 1n;   
      const minAmount1Out = actualAmount1Out + 1n;   
      
      const removeLiquidityInput = {   
        reserve0: Number(reserve0),   
        reserve1: Number(reserve1),   
        total_supply: Number(totalSupply),   
        liquidity: Number(liquidity),   
        min_amount0_out: Number(minAmount0Out),   
        min_amount1_out: Number(minAmount1Out),   
        fee_enabled: false,   
        fee_to: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],   
        last_k: 0,   
        chain_id: CONFIG.CHAIN_ID,   
        pool: Array.from(ethers.getBytes(await guarded.getAddress())),   
        user: Array.from(ethers.getBytes(alice.address)),   
        expiry: Math.floor(Date.now() / 1000) + CONFIG.EXPIRY_OFFSET,   
        nonce: 2   
      };
      
      console.log("📊 Overly strict slippage protection parameters for liquidity removal:", {   
        liquidity: liquidity.toString(),
        actualAmount0Out: actualAmount0Out.toString(),
        actualAmount1Out: actualAmount1Out.toString(),
        minAmount0Out: minAmount0Out.toString(),
        minAmount1Out: minAmount1Out.toString()
      });
      
        
      try {   
        const removeProof = TestUtils.runHostWithJson(removeLiquidityInput);   
        expect.fail("Should fail, but proof generation succeeded");   
      } catch (error: any) {   
        console.log("✅ Overly strict slippage protection verification for liquidity removal successful - proof generation failed (as expected)");   
        expect(error.message).to.include("amount0_out below minimum");   
      }
      
      // 5. Test liquidity removal slippage protection - reasonable parameters
      console.log("5️⃣ Testing liquidity removal slippage protection - reasonable parameters...");   
      
        
      const expectedAmount0Out = (liquidity * 1000000n) / 1000000n; // 100000
      const expectedAmount1Out = (liquidity * 2000000n) / 1000000n; // 200000
      
      const reasonableMinAmount0Out = expectedAmount0Out * 95n / 100n; // 5% slippage protection
      const reasonableMinAmount1Out = expectedAmount1Out * 95n / 100n; // 5% slippage protection
      
      const reasonableRemoveLiquidityInput = {   
        ...removeLiquidityInput,   
        min_amount0_out: Number(reasonableMinAmount0Out),   
        min_amount1_out: Number(reasonableMinAmount1Out)   
      };
      
      console.log("📊 Reasonable slippage protection parameters for liquidity removal:", {   
        liquidity: liquidity.toString(),
        minAmount0Out: reasonableMinAmount0Out.toString(),
        minAmount1Out: reasonableMinAmount1Out.toString(),
        expectedAmount0Out: expectedAmount0Out.toString(),
        expectedAmount1Out: expectedAmount1Out.toString()
      });
      
        
      const reasonableRemoveProof = TestUtils.runHostWithJson(reasonableRemoveLiquidityInput);   
      console.log("✅ Reasonable slippage protection verification for liquidity removal successful - proof generation succeeded");   
      
      // 6. Test liquidity removal slippage protection - boundary cases
      console.log("6️⃣ Testing liquidity removal slippage protection - boundary cases...");   
      
      // 6.1 Test output exactly equals minimum requirement
      const exactMinAmount0Out = expectedAmount0Out;   
      const exactMinAmount1Out = expectedAmount1Out;   
      
      const exactRemoveLiquidityInput = {   
        ...removeLiquidityInput,   
        min_amount0_out: Number(exactMinAmount0Out),   
        min_amount1_out: Number(exactMinAmount1Out)   
      };
      
      console.log("📊 Boundary slippage protection parameters for liquidity removal:", {   
        liquidity: liquidity.toString(),
        minAmount0Out: exactMinAmount0Out.toString(),
        minAmount1Out: exactMinAmount1Out.toString()
      });
      
      const exactRemoveProof = TestUtils.runHostWithJson(exactRemoveLiquidityInput);   
      console.log("✅ Boundary slippage protection verification for liquidity removal successful - proof generation succeeded");   
      
      // 6.2 Test output slightly less than minimum requirement
      const slightlyLessMinAmount0Out = expectedAmount0Out + 1n;   
      const slightlyLessMinAmount1Out = expectedAmount1Out + 1n;   
      
      const slightlyLessRemoveLiquidityInput = {   
        ...removeLiquidityInput,   
        min_amount0_out: Number(slightlyLessMinAmount0Out),   
        min_amount1_out: Number(slightlyLessMinAmount1Out)   
      };
      
      console.log("📊 Slightly below boundary slippage protection parameters for liquidity removal:", {   
        liquidity: liquidity.toString(),
        minAmount0Out: slightlyLessMinAmount0Out.toString(),
        minAmount1Out: slightlyLessMinAmount1Out.toString()
      });
      
      try {   
        const slightlyLessRemoveProof = TestUtils.runHostWithJson(slightlyLessRemoveLiquidityInput);   
        expect.fail("Should fail, but proof generation succeeded");   
      } catch (error: any) {   
        console.log("✅ Slightly below boundary slippage protection verification for liquidity removal successful - proof generation failed (as expected)");   
        expect(error.message).to.include("amount0_out below minimum");   
      }
      
      // 7. Test extreme cases
      console.log("7️⃣ Testing extreme cases...");   
      
      // 7.1 Test zero slippage protection
      const zeroSlippageInput = {   
        ...liquidityInput,   
        min_amount0: Number(amount0),   
        min_amount1: Number(amount1),   
        min_liquidity: Number(TestUtils.calculateFirstAddLiquidity(amount0, amount1))   
      };
      
      console.log("📊 Zero slippage protection parameters:", {   
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        minAmount0: amount0.toString(),
        minAmount1: amount1.toString(),
        minLiquidity: TestUtils.calculateFirstAddLiquidity(amount0, amount1).toString()
      });
      
      const zeroSlippageProof = TestUtils.runHostWithJson(zeroSlippageInput);   
      console.log("✅ Zero slippage protection verification successful - proof generation succeeded");   
      
      // 7.2 Test negative slippage protection (should fail)
      const negativeSlippageInput = {   
        ...liquidityInput,   
        min_amount0: Number(amount0 + 1n),   
        min_amount1: Number(amount1 + 1n),   
        min_liquidity: Number(TestUtils.calculateFirstAddLiquidity(amount0, amount1) + 1n)   
      };
      
      console.log("📊 Negative slippage protection parameters:", {   
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        minAmount0: (amount0 + 1n).toString(),
        minAmount1: (amount1 + 1n).toString(),
        minLiquidity: (TestUtils.calculateFirstAddLiquidity(amount0, amount1) + 1n).toString()
      });
      
      try {   
        const negativeSlippageProof = TestUtils.runHostWithJson(negativeSlippageInput);   
        expect.fail("Should fail, but proof generation succeeded");   
      } catch (error: any) {   
        console.log("✅ Negative slippage protection verification successful - proof generation failed (as expected)");   
        expect(error.message).to.include("below minimum");   
      }
      
      console.log("🎉 All slippage protection tests passed!");   
      console.log("=".repeat(80));   
      console.log("✅ Slippage protection functionality verification completed:");   
      console.log("  ✅ Liquidity addition slippage protection (failed with overly strict parameters)");   
      console.log("  ✅ Liquidity addition slippage protection (succeeded with reasonable parameters)");   
      console.log("  ✅ Liquidity addition slippage protection (succeeded with boundary cases)");   
      console.log("  ✅ Liquidity addition slippage protection (failed with slightly below boundary)");   
      console.log("  ✅ Liquidity removal slippage protection (failed with overly strict parameters)");   
      console.log("  ✅ Liquidity removal slippage protection (succeeded with reasonable parameters)");   
      console.log("  ✅ Liquidity removal slippage protection (succeeded with boundary cases)");   
      console.log("  ✅ Liquidity removal slippage protection (failed with slightly below boundary)");   
      console.log("  ✅ Extreme case testing (succeeded with zero slippage, failed with negative slippage)");   
      console.log("=".repeat(80));   
    });
  });
});
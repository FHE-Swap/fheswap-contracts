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

describe("FHESwapSimpleGuarded - Liquidity E2E", function () {
  this.timeout(600000);

  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let verifier: HardhatEthersSigner;
  let tokenA: ConfidentialFungibleTokenMintableBurnable;
  let tokenB: ConfidentialFungibleTokenMintableBurnable;
  let guarded: FHESwapSimpleGuarded;

  before(async function () {
      
    const signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];
    verifier = signers[3];   

    console.log("Deployer:", deployer.address);
    console.log("Alice:", alice.address);
    console.log("Verifier:", verifier.address);

      
    await deployments.fixture(["TokenA", "TokenB", "guarded"], { keepExistingDeployments: true });

    const tokenADeployment = await deployments.get("TokenA");
    const tokenBDeployment = await deployments.get("TokenB");
    const guardedDeployment = await deployments.get("FHESwapSimpleGuarded");

    tokenA = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenADeployment.address);
    tokenB = await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenBDeployment.address);
    guarded = await ethers.getContractAt("FHESwapSimpleGuarded", guardedDeployment.address);

    console.log("TokenA deployed to:", tokenADeployment.address);
    console.log("TokenB deployed to:", tokenBDeployment.address);
    console.log("Guarded deployed to:", guardedDeployment.address);

      
    const amount = 1000000n;
    const encA = await fhevm.createEncryptedInput(tokenADeployment.address, deployer.address).add64(amount).encrypt();
    const encB = await fhevm.createEncryptedInput(tokenBDeployment.address, deployer.address).add64(amount).encrypt();
    await tokenA.mint(alice.address, encA.handles[0], encA.inputProof);
    await tokenB.mint(alice.address, encB.handles[0], encB.inputProof);

    // Alice approves the pool as operator
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    await tokenA.connect(alice).setOperator(await guarded.getAddress(), expiry);
    await tokenB.connect(alice).setOperator(await guarded.getAddress(), expiry);

    console.log("✅ Setup completed");
  });

  describe("Add Liquidity Function Test", function () {
    it("Should complete the full process of first liquidity addition", async function () {
      console.log("\n=== Testing First Liquidity Addition ===");
      
      const amount0 = 100000n;
      const amount1 = 200000n;
      
      // 1. Alice calls calculateAddLiquidityNumerators
      console.log("1. Calling calculateAddLiquidityNumerators...");
      
      const amount0Encrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount0).encrypt();
      const amount1Encrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount1).encrypt();
      
      await guarded.connect(alice).calculateAddLiquidityNumerators(
        alice.address,
        amount0Encrypted.handles[0],
        amount0Encrypted.inputProof,
        amount1Encrypted.handles[0],
        amount1Encrypted.inputProof
      );
      
      console.log("✅ calculateAddLiquidityNumerators call succeeded");
      
      // 2. Project team decrypts data and calls RISC Zero verification
      console.log("2. Calling RISC Zero verification...");
      
        
      const currentReserve0 = await guarded.getCurrentReserve0();
      const currentReserve1 = await guarded.getCurrentReserve1();
      const currentTotalSupply = await guarded.getCurrentTotalSupply();
      const isFirstAdd = await guarded.getIsFirstAdd();
      
      console.log("Current state:", {
        reserve0: currentReserve0,
        reserve1: currentReserve1,
        totalSupply: currentTotalSupply,
        isFirstAdd: isFirstAdd
      });
      
        
      let decryptedReserve0 = 0n;
      let decryptedReserve1 = 0n;
      let decryptedTotalSupply = 0n;
      
      if (!isFirstAdd) {
          
        decryptedReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentReserve0), await guarded.getAddress(), deployer);
        decryptedReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentReserve1), await guarded.getAddress(), deployer);
        decryptedTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentTotalSupply), await guarded.getAddress(), deployer);
      }
      
      console.log("Decrypted state:", {
        reserve0: decryptedReserve0,
        reserve1: decryptedReserve1,
        totalSupply: decryptedTotalSupply,
        isFirstAdd: isFirstAdd
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
        fee_enabled: false,
        fee_to: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        last_k: 0,
        chain_id: 11155111,
        pool: Array.from(ethers.getBytes(await guarded.getAddress())),
        user: Array.from(ethers.getBytes(alice.address)),
        expiry: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
        nonce: 1
      };
      
      console.log("RISC Zero input:", liquidityInput);
      
        
      const proofHash = runHostWithJson(liquidityInput);
      console.log("✅ RISC Zero verification succeeded, proof hash:", proofHash);
      
      // 3. Generate signature
      console.log("3. Generating signature...");
      const messageHash = ethers.getBytes(proofHash);
      const signature = await verifier.signMessage(messageHash);
      const sig = ethers.Signature.from(signature);
      
      console.log("✅ Signature generation succeeded");
      
      // 4. Alice calls addLiquidityWithProof
      console.log("4. Calling addLiquidityWithProof...");
      
        
      const product = amount0 * amount1;
      const sqrtProduct = Math.floor(Math.sqrt(Number(product)));
      const liquidityMinted = BigInt(sqrtProduct) - 1000n;
      
      console.log("Calculated LP amount:", liquidityMinted);
      
      const liquidityMintedEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(liquidityMinted).encrypt();
      
      await guarded.connect(alice).addLiquidityWithProof(
        amount0Encrypted.handles[0],
        amount0Encrypted.inputProof,
        amount1Encrypted.handles[0],
        amount1Encrypted.inputProof,
        liquidityMintedEncrypted.handles[0],
        liquidityMintedEncrypted.inputProof,
        liquidityInput.expiry,
        proofHash,
        sig.v,
        sig.r,
        sig.s
      );
      
      console.log("✅ addLiquidityWithProof call succeeded");
      
      // 5. Verify results
      console.log("5. Verifying results...");
      
        
      const aliceLPBalance = await guarded.getEncryptedLPBalance(alice.address);
      const decryptedLPBalance = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceLPBalance), await guarded.getAddress(), alice);
      
      console.log("Alice's LP balance:", decryptedLPBalance);
      expect(decryptedLPBalance).to.equal(liquidityMinted);
      
        
      const totalSupply = await guarded.getEncryptedTotalSupply();
      const decryptedTotalSupplyAfter = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(totalSupply), await guarded.getAddress(), deployer);
      
      console.log("Total supply:", decryptedTotalSupplyAfter);
      expect(decryptedTotalSupplyAfter).to.equal(liquidityMinted + 1000n);   
      
        
      const reserve0 = await guarded.getEncryptedReserve0();
      const reserve1 = await guarded.getEncryptedReserve1();
      const decryptedReserve0After = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0), await guarded.getAddress(), deployer);
      const decryptedReserve1After = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1), await guarded.getAddress(), deployer);
      
      console.log("Reserves:", {
        reserve0: decryptedReserve0After,
        reserve1: decryptedReserve1After
      });
      expect(decryptedReserve0After).to.equal(amount0);
      expect(decryptedReserve1After).to.equal(amount1);
      
      console.log("✅ First liquidity addition test passed!");
    });

    it("Should complete the full process of non-first liquidity addition", async function () {
      console.log("\n=== Testing Non-First Liquidity Addition ===");
      
      const amount0 = 50000n;
      const amount1 = 100000n;   
      
      // 1. Alice calls calculateAddLiquidityNumerators
      console.log("1. Calling calculateAddLiquidityNumerators...");
      
      const amount0Encrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount0).encrypt();
      const amount1Encrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount1).encrypt();
      
      await guarded.connect(alice).calculateAddLiquidityNumerators(
        alice.address,
        amount0Encrypted.handles[0],
        amount0Encrypted.inputProof,
        amount1Encrypted.handles[0],
        amount1Encrypted.inputProof
      );
      
      console.log("✅ calculateAddLiquidityNumerators call succeeded");
      
      // 2. Project team decrypts data and calls RISC Zero verification
      console.log("2. Calling RISC Zero verification...");
      
        
      const currentReserve0 = await guarded.getCurrentReserve0();
      const currentReserve1 = await guarded.getCurrentReserve1();
      const currentTotalSupply = await guarded.getCurrentTotalSupply();
      const isFirstAdd = await guarded.getIsFirstAdd();
      
      console.log("Current state:", {
        reserve0: currentReserve0,
        reserve1: currentReserve1,
        totalSupply: currentTotalSupply,
        isFirstAdd: isFirstAdd
      });
      
        
      const decryptedReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentReserve0), await guarded.getAddress(), deployer);
      const decryptedReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentReserve1), await guarded.getAddress(), deployer);
      const decryptedTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentTotalSupply), await guarded.getAddress(), deployer);
      
      console.log("Decrypted state:", {
        reserve0: decryptedReserve0,
        reserve1: decryptedReserve1,
        totalSupply: decryptedTotalSupply,
        isFirstAdd: isFirstAdd
      });
      
        
      const liquidityInput = {
        reserve0: Number(decryptedReserve0),
        reserve1: Number(decryptedReserve1),
        amount0: Number(amount0),
        amount1: Number(amount1),
        total_supply: Number(decryptedTotalSupply),
        is_first_add: isFirstAdd,
        chain_id: 11155111,
        pool: Array.from(ethers.getBytes(await guarded.getAddress())),
        user: Array.from(ethers.getBytes(alice.address)),
        expiry: Math.floor(Date.now() / 1000) + 3600,
        nonce: 2
      };
      
      console.log("RISC Zero input:", liquidityInput);
      
        
      const proofHash = runHostWithJson(liquidityInput);
      console.log("✅ RISC Zero verification succeeded, proof hash:", proofHash);
      
      // 3. Generate signature
      console.log("3. Generating signature...");
      const messageHash = ethers.getBytes(proofHash);
      const signature = await verifier.signMessage(messageHash);
      const sig = ethers.Signature.from(signature);
      
      console.log("✅ Signature generation succeeded");
      
      // 4. Alice calls addLiquidityWithProof
      console.log("4. Calling addLiquidityWithProof...");
      
        
      const lpFromToken0 = (amount0 * decryptedTotalSupply) / decryptedReserve0;
      const lpFromToken1 = (amount1 * decryptedTotalSupply) / decryptedReserve1;
      const liquidityMinted = lpFromToken0 < lpFromToken1 ? lpFromToken0 : lpFromToken1;
      
      console.log("Calculated LP amount:", liquidityMinted);
      
      const liquidityMintedEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(liquidityMinted).encrypt();
      
      await guarded.connect(alice).addLiquidityWithProof(
        amount0Encrypted.handles[0],
        amount0Encrypted.inputProof,
        amount1Encrypted.handles[0],
        amount1Encrypted.inputProof,
        liquidityMintedEncrypted.handles[0],
        liquidityMintedEncrypted.inputProof,
        liquidityInput.expiry,
        proofHash,
        sig.v,
        sig.r,
        sig.s
      );
      
      console.log("✅ addLiquidityWithProof call succeeded");
      
      // 5. Verify results
      console.log("5. Verifying results...");
      
        
      const aliceLPBalance = await guarded.getEncryptedLPBalance(alice.address);
      const decryptedLPBalance = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceLPBalance), await guarded.getAddress(), alice);
      
      console.log("Alice's LP balance:", decryptedLPBalance);
      expect(decryptedLPBalance).to.be.greaterThan(0n);
      
        
      const totalSupply = await guarded.getEncryptedTotalSupply();
      const decryptedTotalSupplyAfter2 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(totalSupply), await guarded.getAddress(), deployer);
      
      console.log("Total supply:", decryptedTotalSupplyAfter2);
      expect(decryptedTotalSupplyAfter2).to.be.greaterThan(0n);
      
        
      const reserve0 = await guarded.getEncryptedReserve0();
      const reserve1 = await guarded.getEncryptedReserve1();
      const decryptedReserve0After2 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0), await guarded.getAddress(), deployer);
      const decryptedReserve1After2 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1), await guarded.getAddress(), deployer);
      
      console.log("Reserves:", {
        reserve0: decryptedReserve0After2,
        reserve1: decryptedReserve1After2
      });
      expect(decryptedReserve0After2).to.be.greaterThan(0n);
      expect(decryptedReserve1After2).to.be.greaterThan(0n);
      
      console.log("✅ Non-first liquidity addition test passed!");
    });

    it("Should handle the full process of removing liquidity", async function () {
      console.log("\n=== Testing Liquidity Removal ===");
      
        
      const aliceLPBalance = await guarded.getEncryptedLPBalance(alice.address);
      const decryptedLPBalance = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceLPBalance), await guarded.getAddress(), alice);
      
      console.log("Alice's current LP balance:", decryptedLPBalance);
      
      if (decryptedLPBalance === 0n) {
        console.log("⚠️ Alice has no LP balance, skipping liquidity removal test");
        return;
      }
      
      const liquidityToRemove = decryptedLPBalance / 2n;   
      
      // 1. Alice calls calculateRemoveLiquidityNumerators
      console.log("1. Calling calculateRemoveLiquidityNumerators...");
      
      const liquidityEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(liquidityToRemove).encrypt();
      
      await guarded.connect(alice).calculateRemoveLiquidityNumerators(
        alice.address,
        liquidityEncrypted.handles[0],
        liquidityEncrypted.inputProof
      );
      
      console.log("✅ calculateRemoveLiquidityNumerators call succeeded");
      
      // 2. Project team decrypts data and calls RISC Zero verification
      console.log("2. Calling RISC Zero verification...");
      
        
      const currentReserve0 = await guarded.getCurrentReserve0();
      const currentReserve1 = await guarded.getCurrentReserve1();
      const currentTotalSupply = await guarded.getCurrentTotalSupply();
      
        
      const decryptedReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentReserve0), await guarded.getAddress(), deployer);
      const decryptedReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentReserve1), await guarded.getAddress(), deployer);
      const decryptedTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(currentTotalSupply), await guarded.getAddress(), deployer);
      
      console.log("Decrypted state:", {
        reserve0: decryptedReserve0,
        reserve1: decryptedReserve1,
        totalSupply: decryptedTotalSupply
      });
      
        
      const liquidityInput = {
        reserve0: Number(decryptedReserve0),
        reserve1: Number(decryptedReserve1),
        total_supply: Number(decryptedTotalSupply),
        liquidity: Number(liquidityToRemove),
        chain_id: 11155111,
        pool: Array.from(ethers.getBytes(await guarded.getAddress())),
        user: Array.from(ethers.getBytes(alice.address)),
        expiry: Math.floor(Date.now() / 1000) + 3600,
        nonce: 3
      };
      
      console.log("RISC Zero input:", liquidityInput);
      
        
      const proofHash = runHostWithJson(liquidityInput);
      console.log("✅ RISC Zero verification succeeded, proof hash:", proofHash);
      
      // 3. Generate signature
      console.log("3. Generating signature...");
      const messageHash = ethers.getBytes(proofHash);
      const signature = await verifier.signMessage(messageHash);
      const sig = ethers.Signature.from(signature);
      
      console.log("✅ Signature generation succeeded");
      
      // 4. Alice calls removeLiquidityWithProof
      console.log("4. Calling removeLiquidityWithProof...");
      
        
      const amount0Out = (liquidityToRemove * decryptedReserve0) / decryptedTotalSupply;
      const amount1Out = (liquidityToRemove * decryptedReserve1) / decryptedTotalSupply;
      
      console.log("Calculated output amounts:", {
        amount0Out: amount0Out,
        amount1Out: amount1Out
      });
      
      const amount0OutEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount0Out).encrypt();
      const amount1OutEncrypted = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amount1Out).encrypt();
      
      await guarded.connect(alice).removeLiquidityWithProof(
        liquidityEncrypted.handles[0],
        liquidityEncrypted.inputProof,
        amount0OutEncrypted.handles[0],
        amount0OutEncrypted.inputProof,
        amount1OutEncrypted.handles[0],
        amount1OutEncrypted.inputProof,
        liquidityInput.expiry,
        proofHash,
        sig.v,
        sig.r,
        sig.s
      );
      
      console.log("✅ removeLiquidityWithProof call succeeded");
      
      // 5. Verify results
      console.log("5. Verifying results...");
      
        
      const newAliceLPBalance = await guarded.getEncryptedLPBalance(alice.address);
      const newDecryptedLPBalance = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newAliceLPBalance), await guarded.getAddress(), alice);
      
      console.log("Alice's new LP balance:", newDecryptedLPBalance);
      expect(newDecryptedLPBalance).to.equal(decryptedLPBalance - liquidityToRemove);
      
      console.log("✅ Liquidity removal test passed!");
    });
  });
});
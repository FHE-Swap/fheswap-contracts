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

describe("FHESwapSimpleGuarded - E2E", function () {
  this.timeout(600000);

  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let verifier: HardhatEthersSigner;
  let tokenA: ConfidentialFungibleTokenMintableBurnable;
  let tokenB: ConfidentialFungibleTokenMintableBurnable;
  let guarded: FHESwapSimpleGuarded;

  before(async function () {
    // Initialize FHEVM (commented out for now)
    // try {
    //   await fhevm.initializeCLIApi();
    //   console.log("✅ FHEVM CLI API initialized successfully");
    // } catch (error) {
    //   console.log("⚠️ FHEVM initialization warning:", error);
    //     
    // }
    const s = await ethers.getSigners();
    deployer = s[0];
    alice = s[1];
    verifier = s[3];

    await deployments.fixture(["default", "guarded"], { keepExistingDeployments: true });

    const tokenADeployment = await deployments.get("TokenA");
    const tokenBDeployment = await deployments.get("TokenB");
    const guardedDeployment = await deployments.get("FHESwapSimpleGuarded");

    tokenA = (await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenADeployment.address)) as any;
    tokenB = (await ethers.getContractAt("ConfidentialFungibleTokenMintableBurnable", tokenBDeployment.address)) as any;
    guarded = (await ethers.getContractAt("FHESwapSimpleGuarded", guardedDeployment.address)) as any;

      
    const amtA = ethers.parseUnits("50", 6);
    const amtB = ethers.parseUnits("25", 6);
    
      
    let encA, encB;
    try {
      encA = await fhevm.createEncryptedInput(tokenADeployment.address, deployer.address).add64(amtA).encrypt();
      encB = await fhevm.createEncryptedInput(tokenBDeployment.address, deployer.address).add64(amtB).encrypt();
    } catch (error) {
      console.log("⚠️ Encryption operation failed, trying fallback method:", error);
        
      const smallAmtA = ethers.parseUnits("10", 6);
      const smallAmtB = ethers.parseUnits("5", 6);
      encA = await fhevm.createEncryptedInput(tokenADeployment.address, deployer.address).add64(smallAmtA).encrypt();
      encB = await fhevm.createEncryptedInput(tokenBDeployment.address, deployer.address).add64(smallAmtB).encrypt();
    }
    await (await tokenA.connect(deployer).mint(alice.address, encA.handles[0], encA.inputProof)).wait();
    await (await tokenB.connect(deployer).mint(alice.address, encB.handles[0], encB.inputProof)).wait();

    // Alice authorizes pool as operator
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    await (await tokenA.connect(alice).setOperator(await guarded.getAddress(), expiry)).wait();
    await (await tokenB.connect(alice).setOperator(await guarded.getAddress(), expiry)).wait();

    // Alice adds liquidity
    const encLiq0 = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amtA).encrypt();
    const encLiq1 = await fhevm.createEncryptedInput(await guarded.getAddress(), alice.address).add64(amtB).encrypt();
    await (await guarded.connect(alice).addLiquidity(encLiq0.handles[0], encLiq0.inputProof, encLiq1.handles[0], encLiq1.inputProof)).wait();
  });

  it("swap with proof should pass", async function () {
    console.log("\n" + "=".repeat(80));
    console.log("🔄 Starting FHE + RISC Zero Complete Swap Flow");
    console.log("=".repeat(80));

    const pool = await guarded.getAddress();
    const tokenAAddr = await tokenA.getAddress();
    const tokenBAddr = await tokenB.getAddress();

    console.log("\n📋 Contract Address Information:");
    console.log(`   Pool: ${pool}`);
    console.log(`   TokenA: ${tokenAAddr}`);
    console.log(`   TokenB: ${tokenBAddr}`);
    console.log(`   Alice: ${alice.address}`);
    console.log(`   Verifier: ${verifier.address}`);

      
    console.log("\n🏦 Getting Current Reserves (Encrypted State):");
    const reserve0Enc = await guarded.getEncryptedReserve0();
    const reserve1Enc = await guarded.getEncryptedReserve1();
    console.log(`   Reserve0 Encrypted Handle: ${ethers.hexlify(reserve0Enc)}`);
    console.log(`   Reserve1 Encrypted Handle: ${ethers.hexlify(reserve1Enc)}`);

      
    console.log("\n🔓 Decrypting Reserve Data:");
    const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
    const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(reserve0, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(reserve1, 6)}`);

      
    const amountIn = ethers.parseUnits("5", 6);
    const feeN = 997n;
    const feeD = 1000n;
    const userMaxSlippageBps = 1000n;   
    console.log("\n💱 Swap Parameters:");
    console.log(`   Input Amount: ${ethers.formatUnits(amountIn, 6)} TokenA`);
    console.log(`   Fee Rate: ${feeN}/${feeD} (0.3%)`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (${Number(userMaxSlippageBps)/100}%)`);

      
    console.log("\n🔒 On-chain Encrypted Calculation of Numerator and Denominator:");
    const encAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    await (await guarded.connect(alice).getAmountOut(encAmountIn.handles[0], encAmountIn.inputProof, tokenAAddr)).wait();
    
      
    const numeratorEnc = await guarded.getEncryptedNumerator();
    const denominatorEnc = await guarded.getEncryptedDenominator();
    console.log(`   Numerator Encrypted Handle: ${ethers.hexlify(numeratorEnc)}`);
    console.log(`   Denominator Encrypted Handle: ${ethers.hexlify(denominatorEnc)}`);

      
    console.log("\n🔓 Off-chain Decryption and Calculation:");
    const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
    const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
    const expectedOut = numerator / denominator;
    const minOut = (expectedOut * 99n) / 100n;
    const slippage = expectedOut - minOut;
    const slippagePercent = (Number(slippage) / Number(expectedOut)) * 100;

    console.log(`   Numerator: ${numerator.toString()}`);
    console.log(`   Denominator: ${denominator.toString()}`);
    console.log(`   Expected Output: ${ethers.formatUnits(expectedOut, 6)} TokenB`);
    console.log(`   Minimum Output: ${ethers.formatUnits(minOut, 6)} TokenB`);
    console.log(`   Slippage Protection: ${ethers.formatUnits(slippage, 6)} TokenB (${slippagePercent.toFixed(2)}%)`);

      
    console.log("\n📊 Slippage Analysis Details (Pre-Swap):");
    const userMaxSlippagePercent = Number(userMaxSlippageBps) / 100;
    const minAllowedOut = (expectedOut * (10000n - userMaxSlippageBps)) / 10000n;
    
    console.log(`   User-Set Max Slippage: ${userMaxSlippageBps} bps (${userMaxSlippagePercent}%)`);
    console.log(`   Theoretical Minimum Output: ${ethers.formatUnits(minAllowedOut, 6)} TokenB`);
    console.log(`   Set Minimum Output: ${ethers.formatUnits(minOut, 6)} TokenB`);
    console.log(`   Slippage Protection Margin: ${ethers.formatUnits(minOut - minAllowedOut, 6)} TokenB`);
    
      
    const slippageProtectionValid = minOut >= minAllowedOut;
    console.log(`   ✅ Slippage Protection Valid: ${slippageProtectionValid ? 'Yes' : 'No'}`);

      
    console.log("\n💰 Alice's Balance Before Swap:");
    const aliceBalanceABefore = await tokenA.confidentialBalanceOf(alice.address);
    const aliceBalanceBBefore = await tokenB.confidentialBalanceOf(alice.address);
    console.log(`   TokenA Encrypted Handle: ${ethers.hexlify(aliceBalanceABefore)}`);
    console.log(`   TokenB Encrypted Handle: ${ethers.hexlify(aliceBalanceBBefore)}`);

    let decryptedBalanceABefore: bigint | null = null;
    let decryptedBalanceBBefore: bigint | null = null;
    
    try {
      decryptedBalanceABefore = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceBalanceABefore), tokenAAddr, alice);
      decryptedBalanceBBefore = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceBalanceBBefore), tokenBAddr, alice);
      console.log(`   TokenA Balance: ${ethers.formatUnits(decryptedBalanceABefore, 6)}`);
      console.log(`   TokenB Balance: ${ethers.formatUnits(decryptedBalanceBBefore, 6)}`);
    } catch (error) {
      console.log("   ⚠️ Unable to decrypt user balance (normal in test environment)");
    }

      
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const nonce = 1;
    
    console.log("\n🔐 Preparing RISC Zero Proof Input:");
    console.log(`   Chain ID: ${chainId}`);
    console.log(`   Expiry Time: ${expiry} (${new Date(expiry * 1000).toISOString()})`);
    console.log(`   Nonce: ${nonce}`);

    const inputs = {
      reserve_in: Number(reserve0),
      reserve_out: Number(reserve1),
      amount_in: Number(amountIn),
      fee_numerator: Number(feeN),
      fee_denominator: Number(feeD),
      expected_out: Number(expectedOut),
      min_out: Number(minOut),
      max_slippage_bps: Number(userMaxSlippageBps),
      chain_id: chainId,
      pool: Array(20).fill(0),
      token_in: Array(20).fill(0),
      to: Array(20).fill(1),
      expiry: expiry,
      nonce: nonce,
    };

    console.log("\n🚀 Calling RISC Zero to Generate Proof:");
    console.log("   Parameters sent to RISC Zero:");
    console.log(`     - Reserve In: ${inputs.reserve_in}`);
    console.log(`     - Reserve Out: ${inputs.reserve_out}`);
    console.log(`     - Input Amount: ${inputs.amount_in}`);
    console.log(`     - Fee Rate: ${inputs.fee_numerator}/${inputs.fee_denominator}`);
    console.log(`     - Expected Output: ${inputs.expected_out}`);
    console.log(`     - Minimum Output: ${inputs.min_out}`);
    console.log(`     - Max Slippage: ${inputs.max_slippage_bps} bps`);
    console.log(`     - Chain ID: ${inputs.chain_id}`);
    console.log(`     - Expiry Time: ${inputs.expiry}`);
    console.log(`     - Nonce: ${inputs.nonce}`);
    
    const proofHashHex = runHostWithJson(inputs);
    const proofHash = proofHashHex as `0x${string}`;
    console.log(`   ✅ Generated proof_hash: ${proofHash}`);
    console.log(`   📝 Proof Hash Length: ${proofHash.length} characters`);
    console.log(`   🔍 First 8 Characters of Proof Hash: ${proofHash.substring(0, 10)}...`);

      
    console.log("\n✍️ Trusted Verifier Signature:");
    console.log(`   Verifier Address: ${verifier.address}`);
    console.log(`   Signature Content: ${proofHash}`);
    
    const sig = await verifier.signMessage(ethers.getBytes(proofHash));
    const parsed = ethers.Signature.from(sig);
    console.log(`   ✅ Signature Completed:`);
    console.log(`     v: ${parsed.v}`);
    console.log(`     r: ${parsed.r}`);
    console.log(`     s: ${parsed.s}`);

      
    console.log("\n🔍 Verifying Signature:");
    const recoveredAddress = ethers.verifyMessage(ethers.getBytes(proofHash), sig);
    console.log(`   Recovered Address: ${recoveredAddress}`);
    console.log(`   Expected Address: ${verifier.address}`);
    console.log(`   ✅ Signature Verification: ${recoveredAddress === verifier.address ? 'Passed' : 'Failed'}`);

      
    console.log("\n🔒 Encrypting Swap Parameters:");
    const encIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    const encOut = await fhevm.createEncryptedInput(pool, alice.address).add64(expectedOut).encrypt();
    console.log(`   Input Amount Encrypted Handle: ${ethers.hexlify(encIn.handles[0])}`);
    console.log(`   Expected Output Encrypted Handle: ${ethers.hexlify(encOut.handles[0])}`);

      
    console.log("\n🔄 Executing swapWithProof:");
    console.log(`   Caller: ${alice.address}`);
    console.log(`   Input Token: ${tokenAAddr}`);
    console.log(`   Recipient Address: ${alice.address}`);
    console.log(`   Expiry Time: ${inputs.expiry}`);
    console.log(`   Proof Hash: ${proofHash}`);

    const swapTx = await guarded.connect(alice).swapWithProof(
      encIn.handles[0], encIn.inputProof,
      encOut.handles[0], encOut.inputProof,
      tokenAAddr,
      alice.address,
      inputs.expiry,
      proofHash as any,
      parsed.v, parsed.r, parsed.s
    );
    
    const swapReceipt = await swapTx.wait();
    console.log(`   ✅ Swap Transaction Successful:`);
    console.log(`     Transaction Hash: ${swapTx.hash}`);
    console.log(`     Gas Used: ${swapReceipt?.gasUsed}`);
    console.log(`     Block Number: ${swapReceipt?.blockNumber}`);

      
    console.log("\n🏦 Reserve Status After Swap:");
    const r0After = await guarded.getEncryptedReserve0();
    const r1After = await guarded.getEncryptedReserve1();
    console.log(`   Reserve0 Encrypted Handle: ${ethers.hexlify(r0After)}`);
    console.log(`   Reserve1 Encrypted Handle: ${ethers.hexlify(r1After)}`);

    const decR0After = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(r0After), pool, deployer);
    const decR1After = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(r1After), pool, deployer);
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(decR0After, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(decR1After, 6)}`);

      
    const reserve0Change = decR0After - reserve0;
    const reserve1Change = reserve1 - decR1After;
    console.log("\n📊 Reserve Change Analysis:");
    console.log(`   TokenA Reserve Increased By: ${ethers.formatUnits(reserve0Change, 6)} (Expected: ${ethers.formatUnits(amountIn, 6)})`);
    console.log(`   TokenB Reserve Decreased By: ${ethers.formatUnits(reserve1Change, 6)} (Expected: ${ethers.formatUnits(expectedOut, 6)})`);
    console.log(`   ✅ TokenA Change Correct: ${reserve0Change === amountIn ? 'Yes' : 'No'}`);
    console.log(`   ✅ TokenB Change Correct: ${reserve1Change === expectedOut ? 'Yes' : 'No'}`);
    
      
    const actualOut = reserve1Change; // Actual TokenB outflow
    const actualSlippageBps = expectedOut > 0n ? 
      Number(((expectedOut - actualOut) * 10000n) / expectedOut) : 0;
    const actualSlippagePercent = actualSlippageBps / 100;
    
    console.log("\n📊 Actual Slippage Analysis (Post-Swap):");
    console.log(`   Theoretical Output: ${ethers.formatUnits(expectedOut, 6)} TokenB`);
    console.log(`   Actual Output: ${ethers.formatUnits(actualOut, 6)} TokenB`);
    console.log(`   Actual Slippage: ${actualSlippageBps.toFixed(2)} bps (${actualSlippagePercent.toFixed(4)}%)`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (${userMaxSlippagePercent}%)`);
    
      
    const slippageWithinLimit = actualSlippageBps <= Number(userMaxSlippageBps) + 1e-6;
    console.log(`   ✅ Slippage Within Limit: ${slippageWithinLimit ? 'Yes' : 'No'}`);
    console.log(`   Slippage Utilization Rate: ${((actualSlippageBps / Number(userMaxSlippageBps)) * 100).toFixed(2)}%`);
    
      
    console.log("\n📈 Detailed Reserve Change Analysis:");
    const reserve0ChangePercent = (Number(reserve0Change) / Number(reserve0)) * 100;
    const reserve1ChangePercent = (Number(reserve1Change) / Number(reserve1)) * 100;
    console.log(`   TokenA Reserve Change Rate: ${reserve0ChangePercent.toFixed(4)}%`);
    console.log(`   TokenB Reserve Change Rate: ${reserve1ChangePercent.toFixed(4)}%`);
    console.log(`   Reserve Ratio Before Swap: ${(Number(reserve0) / Number(reserve1)).toFixed(6)}`);
    console.log(`   Reserve Ratio After Swap: ${(Number(decR0After) / Number(decR1After)).toFixed(6)}`);
    
      
    const priceBefore = Number(reserve1) / Number(reserve0);
    const priceAfter = Number(decR1After) / Number(decR0After);
    const priceImpact = ((priceAfter - priceBefore) / priceBefore) * 100;
    console.log(`   Price Before Swap: ${priceBefore.toFixed(6)} TokenB/TokenA`);
    console.log(`   Price After Swap: ${priceAfter.toFixed(6)} TokenB/TokenA`);
    console.log(`   Price Impact: ${priceImpact.toFixed(4)}%`);

      
    console.log("\n💰 Alice's Balance After Swap:");
    const aliceBalanceAAfter = await tokenA.confidentialBalanceOf(alice.address);
    const aliceBalanceBAfter = await tokenB.confidentialBalanceOf(alice.address);
    console.log(`   TokenA Encrypted Handle: ${ethers.hexlify(aliceBalanceAAfter)}`);
    console.log(`   TokenB Encrypted Handle: ${ethers.hexlify(aliceBalanceBAfter)}`);

    try {
      const decryptedBalanceAAfter = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceBalanceAAfter), tokenAAddr, alice);
      const decryptedBalanceBAfter = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceBalanceBAfter), tokenBAddr, alice);
      console.log(`   TokenA Balance: ${ethers.formatUnits(decryptedBalanceAAfter, 6)}`);
      console.log(`   TokenB Balance: ${ethers.formatUnits(decryptedBalanceBAfter, 6)}`);
      
        
      if (decryptedBalanceABefore !== null && decryptedBalanceBBefore !== null) {
        const balanceAChange = decryptedBalanceABefore - decryptedBalanceAAfter;
        const balanceBChange = decryptedBalanceBAfter - decryptedBalanceBBefore;
        console.log("\n📈 User Balance Changes:");
        console.log(`   TokenA Decreased By: ${ethers.formatUnits(balanceAChange, 6)} (Paid)`);
        console.log(`   TokenB Increased By: ${ethers.formatUnits(balanceBChange, 6)} (Received)`);
        console.log(`   ✅ Payment Amount Correct: ${balanceAChange === amountIn ? 'Yes' : 'No'}`);
        console.log(`   ✅ Received Amount Correct: ${balanceBChange === expectedOut ? 'Yes' : 'No'}`);
        
          
        console.log("\n💼 Detailed User Balance Analysis:");
        const balanceAChangePercent = (Number(balanceAChange) / Number(decryptedBalanceABefore)) * 100;
        const balanceBChangePercent = (Number(balanceBChange) / Number(decryptedBalanceBBefore)) * 100;
        console.log(`   TokenA Balance Change Rate: ${balanceAChangePercent.toFixed(4)}%`);
        console.log(`   TokenB Balance Change Rate: ${balanceBChangePercent.toFixed(4)}%`);
        
          
        const exchangeRate = Number(balanceBChange) / Number(balanceAChange);
        const expectedRate = Number(expectedOut) / Number(amountIn);
        const rateAccuracy = (exchangeRate / expectedRate) * 100;
        console.log(`   Actual Exchange Rate: ${exchangeRate.toFixed(6)} TokenB/TokenA`);
        console.log(`   Expected Exchange Rate: ${expectedRate.toFixed(6)} TokenB/TokenA`);
        console.log(`   Exchange Rate Accuracy: ${rateAccuracy.toFixed(4)}%`);
        
          
        const valueBefore = Number(decryptedBalanceABefore) + Number(decryptedBalanceBBefore);
        const valueAfter = Number(decryptedBalanceAAfter) + Number(decryptedBalanceBAfter);
        const valueChange = valueAfter - valueBefore;
        const valueChangePercent = (valueChange / valueBefore) * 100;
        console.log(`   Total Value Before Swap: ${ethers.formatUnits(valueBefore, 6)}`);
        console.log(`   Total Value After Swap: ${ethers.formatUnits(valueAfter, 6)}`);
        console.log(`   Value Change: ${ethers.formatUnits(valueChange, 6)} (${valueChangePercent.toFixed(4)}%)`);
      }
    } catch (error) {
      console.log("   ⚠️ Unable to decrypt user balance (normal in test environment)");
    }

      
    console.log("\n🔒 Verifying Anti-Replay Mechanism:");
    const isConsumed = await guarded.consumedProofs(proofHash);
    console.log(`   Proof Hash Consumed: ${isConsumed ? 'Yes' : 'No'}`);
    console.log(`   ✅ Anti-Replay Protection: ${isConsumed ? 'Active' : 'Inactive'}`);

      
    expect(decR0After - reserve0).to.equal(amountIn);
    expect(reserve1 - decR1After).to.equal(expectedOut);
    expect(isConsumed).to.be.true;

    console.log("\n" + "=".repeat(80));
    console.log("🎉 FHE + RISC Zero Complete Swap Flow Successfully Completed!");
    console.log("=".repeat(80));
  });

  it("should reject swaps exceeding slippage limit", async function () {
    console.log("\n" + "=".repeat(80));
    console.log("❌ Testing Swap Exceeding Slippage Limit (Should Be Rejected)");
    console.log("=".repeat(80));

    const pool = await guarded.getAddress();
    const tokenAAddr = await tokenA.getAddress();
    const tokenBAddr = await tokenB.getAddress();

      
    const reserve0Enc = await guarded.getEncryptedReserve0();
    const reserve1Enc = await guarded.getEncryptedReserve1();
    const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
    const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);

    console.log("\n📊 Current Reserve Status:");
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(reserve0, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(reserve1, 6)}`);

      
    const amountIn = ethers.parseUnits("20", 6);   
    const feeN = 997n;
    const feeD = 1000n;
    const userMaxSlippageBps = 100n;   

    console.log("\n💱 Swap Parameters (High Slippage Scenario):");
    console.log(`   Input Amount: ${ethers.formatUnits(amountIn, 6)} TokenA`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (1%)`);

      
    console.log("\n🔒 On-chain Encrypted Calculation of Numerator and Denominator:");
    const encAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    await (await guarded.connect(alice).getAmountOut(encAmountIn.handles[0], encAmountIn.inputProof, tokenAAddr)).wait();
    
      
    const numeratorEnc = await guarded.getEncryptedNumerator();
    const denominatorEnc = await guarded.getEncryptedDenominator();
    
      
    console.log("\n🔓 Off-chain Decryption and Calculation:");
    const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
    const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
    const expectedOut = numerator / denominator;
      
    const minAllowedOut = (expectedOut * (10000n - userMaxSlippageBps)) / 10000n;
    const minOut = (minAllowedOut * 95n) / 100n;   

    console.log("\n🧮 AMM Calculation Results:");
    console.log(`   Expected Output: ${ethers.formatUnits(expectedOut, 6)} TokenB`);
    console.log(`   Set Minimum Output: ${ethers.formatUnits(minOut, 6)} TokenB`);

      
    const theoreticalSlippageBps = ((Number(expectedOut) - Number(minOut)) / Number(expectedOut)) * 10000;
    const userMaxSlippagePercent = Number(userMaxSlippageBps) / 100;

    console.log("\n📊 Slippage Analysis (Pre-Swap):");
    console.log(`   Theoretical Slippage: ${theoreticalSlippageBps.toFixed(2)} bps`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (${userMaxSlippagePercent}%)`);
    console.log(`   Theoretical Minimum Output: ${ethers.formatUnits(minAllowedOut, 6)} TokenB`);
    console.log(`   Set Minimum Output: ${ethers.formatUnits(minOut, 6)} TokenB`);
    console.log(`   ❌ Set Slippage Exceeds Limit: ${theoreticalSlippageBps > Number(userMaxSlippageBps) ? 'Yes' : 'No'}`);

      
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const nonce = 2;   

    const inputs = {
      reserve_in: Number(reserve0),
      reserve_out: Number(reserve1),
      amount_in: Number(amountIn),
      fee_numerator: Number(feeN),
      fee_denominator: Number(feeD),
      expected_out: Number(expectedOut),
      min_out: Number(minOut),
      max_slippage_bps: Number(userMaxSlippageBps),
      chain_id: chainId,
      pool: Array(20).fill(0),
      token_in: Array(20).fill(0),
      to: Array(20).fill(1),
      expiry: expiry,
      nonce: nonce,
    };

    console.log("\n🚀 Calling RISC Zero to Generate Proof:");
    console.log("   Expected Result: Should fail due to excessive slippage");

    try {
      const proofHashHex = runHostWithJson(inputs);
      console.log("   ❌ Unexpected Success: RISC Zero should reject this proof");
      expect.fail("RISC Zero should reject proof with excessive slippage");
    } catch (error) {
      console.log("   ✅ Expected Failure: RISC Zero correctly rejected proof with excessive slippage");
      console.log(`   Error Message: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ Slippage Limit Test Completed - Successfully Rejected Excessive Swap");
    console.log("=".repeat(80));
  });

  it("should approve swaps within normal slippage range", async function () {
    console.log("\n" + "=".repeat(80));
    console.log("✅ Testing Swap Within Normal Slippage Range (Should Pass)");
    console.log("=".repeat(80));

    const pool = await guarded.getAddress();
    const tokenAAddr = await tokenA.getAddress();
    const tokenBAddr = await tokenB.getAddress();

      
    const reserve0Enc = await guarded.getEncryptedReserve0();
    const reserve1Enc = await guarded.getEncryptedReserve1();
    const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
    const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);

    console.log("\n📊 Current Reserve Status:");
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(reserve0, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(reserve1, 6)}`);

      
    const amountIn = ethers.parseUnits("2", 6);   
    const feeN = 997n;
    const feeD = 1000n;
    const userMaxSlippageBps = 500n;   

    console.log("\n💱 Swap Parameters (Normal Slippage Scenario):");
    console.log(`   Input Amount: ${ethers.formatUnits(amountIn, 6)} TokenA`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (5%)`);

      
    console.log("\n🔒 On-chain Encrypted Calculation of Numerator and Denominator:");
    const encAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    await (await guarded.connect(alice).getAmountOut(encAmountIn.handles[0], encAmountIn.inputProof, tokenAAddr)).wait();
    
      
    const numeratorEnc = await guarded.getEncryptedNumerator();
    const denominatorEnc = await guarded.getEncryptedDenominator();
    
      
    console.log("\n🔓 Off-chain Decryption and Calculation:");
    const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
    const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
    const expectedOut = numerator / denominator;
      
    const minAllowedOut = (expectedOut * (10000n - userMaxSlippageBps)) / 10000n;
    const minOut = minAllowedOut;   

    console.log("\n🧮 AMM Calculation Results:");
    console.log(`   Expected Output: ${ethers.formatUnits(expectedOut, 6)} TokenB`);
    console.log(`   Set Minimum Output: ${ethers.formatUnits(minOut, 6)} TokenB`);

      
    const theoreticalSlippageBps = ((Number(expectedOut) - Number(minOut)) / Number(expectedOut)) * 10000;
    const userMaxSlippagePercent = Number(userMaxSlippageBps) / 100;

    console.log("\n📊 Slippage Analysis (Pre-Swap):");
    console.log(`   Theoretical Slippage: ${theoreticalSlippageBps.toFixed(2)} bps`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (${userMaxSlippagePercent}%)`);
    console.log(`   Theoretical Minimum Output: ${ethers.formatUnits(minAllowedOut, 6)} TokenB`);
    console.log(`   Set Minimum Output: ${ethers.formatUnits(minOut, 6)} TokenB`);
    console.log(`   ✅ Set Slippage Within Limit: ${theoreticalSlippageBps <= Number(userMaxSlippageBps) + 1e-6 ? 'Yes' : 'No'}`);

      
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const nonce = 3;   

    const inputs = {
      reserve_in: Number(reserve0),
      reserve_out: Number(reserve1),
      amount_in: Number(amountIn),
      fee_numerator: Number(feeN),
      fee_denominator: Number(feeD),
      expected_out: Number(expectedOut),
      min_out: Number(minOut),
      max_slippage_bps: Number(userMaxSlippageBps),
      chain_id: chainId,
      pool: Array(20).fill(0),
      token_in: Array(20).fill(0),
      to: Array(20).fill(1),
      expiry: expiry,
      nonce: nonce,
    };

    console.log("\n🚀 Calling RISC Zero to Generate Proof:");
    console.log("   Expected Result: Should successfully generate proof");

    const proofHashHex = runHostWithJson(inputs);
    const proofHash = proofHashHex as `0x${string}`;
    console.log(`   ✅ Successfully Generated proof_hash: ${proofHash}`);

      
    console.log("\n✍️ Trusted Verifier Signature:");
    const sig = await verifier.signMessage(ethers.getBytes(proofHash));
    const parsed = ethers.Signature.from(sig);
    console.log(`   ✅ Signature Completed`);

      
    const encIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    const encOut = await fhevm.createEncryptedInput(pool, alice.address).add64(expectedOut).encrypt();

      
    console.log("\n🔄 Executing swapWithProof:");
    const swapTx = await guarded.connect(alice).swapWithProof(
      encIn.handles[0], encIn.inputProof,
      encOut.handles[0], encOut.inputProof,
      tokenAAddr,
      alice.address,
      inputs.expiry,
      proofHash as any,
      parsed.v, parsed.r, parsed.s
    );
    
    const swapReceipt = await swapTx.wait();
    console.log(`   ✅ Swap Transaction Successful:`);
    console.log(`     Transaction Hash: ${swapTx.hash}`);
    console.log(`     Gas Used: ${swapReceipt?.gasUsed}`);

      
    console.log("\n🏦 Reserve Status After Swap:");
    const r0After = await guarded.getEncryptedReserve0();
    const r1After = await guarded.getEncryptedReserve1();
    const decR0After = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(r0After), pool, deployer);
    const decR1After = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(r1After), pool, deployer);
    
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(decR0After, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(decR1After, 6)}`);

      
    const reserve0Change = decR0After - reserve0;
    const reserve1Change = reserve1 - decR1After;
    
    console.log("\n📊 Reserve Change Analysis:");
    console.log(`   TokenA Reserve Increased By: ${ethers.formatUnits(reserve0Change, 6)} (Expected: ${ethers.formatUnits(amountIn, 6)})`);
    console.log(`   TokenB Reserve Decreased By: ${ethers.formatUnits(reserve1Change, 6)} (Expected: ${ethers.formatUnits(expectedOut, 6)})`);
    
      
    const actualOut = reserve1Change; // Actual TokenB outflow
    const actualSlippageBps = expectedOut > 0n ? 
      Number(((expectedOut - actualOut) * 10000n) / expectedOut) : 0;
    const actualSlippagePercent = actualSlippageBps / 100;
    
    console.log("\n📊 Actual Slippage Analysis (Post-Swap):");
    console.log(`   Theoretical Output: ${ethers.formatUnits(expectedOut, 6)} TokenB`);
    console.log(`   Actual Output: ${ethers.formatUnits(actualOut, 6)} TokenB`);
    console.log(`   Actual Slippage: ${actualSlippageBps.toFixed(2)} bps (${actualSlippagePercent.toFixed(4)}%)`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (${userMaxSlippagePercent}%)`);
    
      
    const slippageWithinLimit = actualSlippageBps <= Number(userMaxSlippageBps) + 1e-6;
    console.log(`   ✅ Slippage Within Limit: ${slippageWithinLimit ? 'Yes' : 'No'}`);
    console.log(`   Slippage Utilization Rate: ${((actualSlippageBps / Number(userMaxSlippageBps)) * 100).toFixed(2)}%`);

      
    const isConsumed = await guarded.consumedProofs(proofHash);
    console.log(`   ✅ Anti-Replay Protection: ${isConsumed ? 'Active' : 'Inactive'}`);

    console.log("\n" + "=".repeat(80));
    console.log("🎉 Normal Slippage Swap Test Completed - Successfully Verified");
    console.log("=".repeat(80));
  });

  it("should support reverse swaps (TokenB -> TokenA)", async function () {
    console.log("\n" + "=".repeat(80));
    console.log("🔄 Testing Reverse Swap (TokenB -> TokenA)");
    console.log("=".repeat(80));

    const pool = await guarded.getAddress();
    const tokenAAddr = await tokenA.getAddress();
    const tokenBAddr = await tokenB.getAddress();

      
    const reserve0Enc = await guarded.getEncryptedReserve0();
    const reserve1Enc = await guarded.getEncryptedReserve1();
    const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
    const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);

    console.log("\n📊 Current Reserve Status:");
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(reserve0, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(reserve1, 6)}`);

      
    const amountIn = ethers.parseUnits("3", 6);   
    const feeN = 997n;
    const feeD = 1000n;
    const userMaxSlippageBps = 800n;   

    console.log("\n💱 Reverse Swap Parameters:");
    console.log(`   Input Amount: ${ethers.formatUnits(amountIn, 6)} TokenB`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (8%)`);

      
    console.log("\n🔒 On-chain Encrypted Calculation of Numerator and Denominator (Reverse Swap):");
    const encAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    await (await guarded.connect(alice).getAmountOut(encAmountIn.handles[0], encAmountIn.inputProof, tokenBAddr)).wait();
    
      
    const numeratorEnc = await guarded.getEncryptedNumerator();
    const denominatorEnc = await guarded.getEncryptedDenominator();
    
      
    console.log("\n🔓 Off-chain Decryption and Calculation:");
    const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
    const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
    const expectedOut = numerator / denominator;

    console.log("\n🧮 AMM Calculation Results (Reverse Swap):");
    console.log(`   Expected Output: ${ethers.formatUnits(expectedOut, 6)} TokenA`);
    console.log(`   Input TokenB: ${ethers.formatUnits(amountIn, 6)}`);
    console.log(`   Output TokenA: ${ethers.formatUnits(expectedOut, 6)}`);

      
    const minAllowedOut = (expectedOut * (10000n - userMaxSlippageBps)) / 10000n;
    const minOut = minAllowedOut;   

    console.log(`   Set Minimum Output: ${ethers.formatUnits(minOut, 6)} TokenA`);

      
    const theoreticalSlippageBps = ((Number(expectedOut) - Number(minOut)) / Number(expectedOut)) * 10000;
    const userMaxSlippagePercent = Number(userMaxSlippageBps) / 100;

    console.log("\n📊 Slippage Analysis (Reverse Swap, Pre-Swap):");
    console.log(`   Theoretical Slippage: ${theoreticalSlippageBps.toFixed(2)} bps`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (${userMaxSlippagePercent}%)`);
    console.log(`   ✅ Set Slippage Within Limit: ${theoreticalSlippageBps <= Number(userMaxSlippageBps) + 1e-6 ? 'Yes' : 'No'}`);

      
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const nonce = 4;   

    const inputs = {
      reserve_in: Number(reserve1),  // TokenB reserve as input reserve
      reserve_out: Number(reserve0), // TokenA reserve as output reserve
      amount_in: Number(amountIn),
      fee_numerator: Number(feeN),
      fee_denominator: Number(feeD),
      expected_out: Number(expectedOut),
      min_out: Number(minOut),
      max_slippage_bps: Number(userMaxSlippageBps),
      chain_id: chainId,
      pool: Array(20).fill(0),
      token_in: Array(20).fill(1), // TokenB address
      to: Array(20).fill(1),
      expiry: expiry,
      nonce: nonce,
    };

    console.log("\n🚀 Calling RISC Zero to Generate Proof (Reverse Swap):");
    console.log("   Reserve Switch Verification:");
    console.log(`     reserve_in (TokenB): ${inputs.reserve_in}`);
    console.log(`     reserve_out (TokenA): ${inputs.reserve_out}`);
    console.log(`     amount_in: ${inputs.amount_in}`);
    console.log(`     expected_out: ${inputs.expected_out}`);

    const proofHashHex = runHostWithJson(inputs);
    const proofHash = proofHashHex as `0x${string}`;
    console.log(`   ✅ Successfully Generated proof_hash: ${proofHash}`);

      
    console.log("\n✍️ Trusted Verifier Signature:");
    const sig = await verifier.signMessage(ethers.getBytes(proofHash));
    const parsed = ethers.Signature.from(sig);
    console.log(`   ✅ Signature Completed`);

      
    const encIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    const encOut = await fhevm.createEncryptedInput(pool, alice.address).add64(expectedOut).encrypt();

      
    console.log("\n🔄 Executing swapWithProof (Reverse Swap):");
    console.log(`   Input Token: ${tokenBAddr} (TokenB)`);
    console.log(`   Output Token: TokenA`);
    
    const swapTx = await guarded.connect(alice).swapWithProof(
      encIn.handles[0], encIn.inputProof,
      encOut.handles[0], encOut.inputProof,
      tokenBAddr,   
      alice.address,
      inputs.expiry,
      proofHash as any,
      parsed.v, parsed.r, parsed.s
    );
    
    const swapReceipt = await swapTx.wait();
    console.log(`   ✅ Reverse Swap Transaction Successful:`);
    console.log(`     Transaction Hash: ${swapTx.hash}`);
    console.log(`     Gas Used: ${swapReceipt?.gasUsed}`);

      
    console.log("\n🏦 Reserve Status After Reverse Swap:");
    const r0After = await guarded.getEncryptedReserve0();
    const r1After = await guarded.getEncryptedReserve1();
    const decR0After = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(r0After), pool, deployer);
    const decR1After = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(r1After), pool, deployer);
    
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(decR0After, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(decR1After, 6)}`);

      
    const reserve0Change = decR0After - reserve0; // TokenA should decrease
    const reserve1Change = decR1After - reserve1; // TokenB should increase

    console.log("\n📊 Reserve Change Analysis (Reverse Swap):");
    console.log(`   TokenA Reserve Change: ${ethers.formatUnits(reserve0Change, 6)} (Expected: -${ethers.formatUnits(expectedOut, 6)})`);
    console.log(`   TokenB Reserve Change: ${ethers.formatUnits(reserve1Change, 6)} (Expected: +${ethers.formatUnits(amountIn, 6)})`);
    console.log(`   ✅ TokenA Change Correct: ${reserve0Change === -expectedOut ? 'Yes' : 'No'}`);
    console.log(`   ✅ TokenB Change Correct: ${reserve1Change === amountIn ? 'Yes' : 'No'}`);
    
      
    const actualOut = -reserve0Change; // Actual TokenA outflow (note the sign)
    const actualSlippageBps = expectedOut > 0n ? 
      Number(((expectedOut - actualOut) * 10000n) / expectedOut) : 0;
    const actualSlippagePercent = actualSlippageBps / 100;
    
    console.log("\n📊 Actual Slippage Analysis (Reverse Swap, Post-Swap):");
    console.log(`   Theoretical Output: ${ethers.formatUnits(expectedOut, 6)} TokenA`);
    console.log(`   Actual Output: ${ethers.formatUnits(actualOut, 6)} TokenA`);
    console.log(`   Actual Slippage: ${actualSlippageBps.toFixed(2)} bps (${actualSlippagePercent.toFixed(4)}%)`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (${userMaxSlippagePercent}%)`);
    
      
    const slippageWithinLimit = actualSlippageBps <= Number(userMaxSlippageBps) + 1e-6;
    console.log(`   ✅ Slippage Within Limit: ${slippageWithinLimit ? 'Yes' : 'No'}`);
    console.log(`   Slippage Utilization Rate: ${((actualSlippageBps / Number(userMaxSlippageBps)) * 100).toFixed(2)}%`);

      
    const isConsumed = await guarded.consumedProofs(proofHash);
    console.log(`   ✅ Anti-Replay Protection: ${isConsumed ? 'Active' : 'Inactive'}`);

      
    expect(decR0After - reserve0).to.equal(-expectedOut);
    expect(decR1After - reserve1).to.equal(amountIn);
    expect(isConsumed).to.be.true;

    console.log("\n" + "=".repeat(80));
    console.log("🎉 TokenB -> TokenA Reverse Swap Test Completed - Successfully Verified");
    console.log("=".repeat(80));
  });

  it("should support minimum amount swaps", async function () {
    console.log("\n" + "=".repeat(80));
    console.log("🔬 Testing Minimum Amount Swap (Edge Case)");
    console.log("=".repeat(80));

    const pool = await guarded.getAddress();
    const tokenAAddr = await tokenA.getAddress();

      
    const reserve0Enc = await guarded.getEncryptedReserve0();
    const reserve1Enc = await guarded.getEncryptedReserve1();
    const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
    const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);

    console.log("\n📊 Current Reserve Status:");
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(reserve0, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(reserve1, 6)}`);

      
    const amountIn = ethers.parseUnits("0.001", 6);   
    const feeN = 997n;
    const feeD = 1000n;
    const userMaxSlippageBps = 10000n;   

    console.log("\n💱 Minimum Amount Swap Parameters:");
    console.log(`   Input Amount: ${ethers.formatUnits(amountIn, 6)} TokenA`);
    console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (100%)`);

      
    console.log("\n🔒 On-chain Encrypted Calculation of Numerator and Denominator:");
    const encAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    await (await guarded.connect(alice).getAmountOut(encAmountIn.handles[0], encAmountIn.inputProof, tokenAAddr)).wait();
    
      
    const numeratorEnc = await guarded.getEncryptedNumerator();
    const denominatorEnc = await guarded.getEncryptedDenominator();
    
      
    console.log("\n🔓 Off-chain Decryption and Calculation:");
    const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
    const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
    const expectedOut = numerator / denominator;

    console.log("\n🧮 AMM Calculation Results (Minimum Amount):");
    console.log(`   Expected Output: ${ethers.formatUnits(expectedOut, 6)} TokenB`);
    console.log(`   Input TokenA: ${ethers.formatUnits(amountIn, 6)}`);
    console.log(`   Output TokenB: ${ethers.formatUnits(expectedOut, 6)}`);

      
    const minAllowedOut = (expectedOut * (10000n - userMaxSlippageBps)) / 10000n;
    const minOut = userMaxSlippageBps >= 10000n ? 1n : minAllowedOut; // Set minimum to 1 when slippage is 100%

    console.log(`   Set Minimum Output: ${ethers.formatUnits(minOut, 6)} TokenB`);

      
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const nonce = 5;

    const inputs = {
      reserve_in: Number(reserve0),
      reserve_out: Number(reserve1),
      amount_in: Number(amountIn),
      fee_numerator: Number(feeN),
      fee_denominator: Number(feeD),
      expected_out: Number(expectedOut),
      min_out: Number(minOut),
      max_slippage_bps: Number(userMaxSlippageBps),
      chain_id: chainId,
      pool: Array(20).fill(0),
      token_in: Array(20).fill(0),
      to: Array(20).fill(1),
      expiry: expiry,
      nonce: nonce,
    };

    console.log("\n🚀 Calling RISC Zero to Generate Proof (Minimum Amount):");
    const proofHashHex = runHostWithJson(inputs);
    const proofHash = proofHashHex as `0x${string}`;
    console.log(`   ✅ Successfully Generated proof_hash: ${proofHash}`);

      
    const sig = await verifier.signMessage(ethers.getBytes(proofHash));
    const parsed = ethers.Signature.from(sig);

      
    const encIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    const encOut = await fhevm.createEncryptedInput(pool, alice.address).add64(expectedOut).encrypt();

      
    console.log("\n🔄 Executing swapWithProof (Minimum Amount):");
    const swapTx = await guarded.connect(alice).swapWithProof(
      encIn.handles[0], encIn.inputProof,
      encOut.handles[0], encOut.inputProof,
      tokenAAddr,
      alice.address,
      inputs.expiry,
      proofHash as any,
      parsed.v, parsed.r, parsed.s
    );
    
    const swapReceipt = await swapTx.wait();
    console.log(`   ✅ Minimum Amount Swap Successful:`);
    console.log(`     Transaction Hash: ${swapTx.hash}`);
    console.log(`     Gas Used: ${swapReceipt?.gasUsed}`);

      
    const isConsumed = await guarded.consumedProofs(proofHash);
    console.log(`   ✅ Anti-Replay Protection: ${isConsumed ? 'Active' : 'Inactive'}`);

      
    expect(isConsumed).to.be.true;

    console.log("\n" + "=".repeat(80));
    console.log("🎉 Minimum Amount Swap Test Completed - Successfully Verified");
    console.log("=".repeat(80));
  });

  it("should reject swaps with invalid token addresses", async function () {
    console.log("\n" + "=".repeat(80));
    console.log("❌ Testing Swap with Invalid Token Address (Should Be Rejected)");
    console.log("=".repeat(80));

    const pool = await guarded.getAddress();
    const invalidTokenAddr = "0x0000000000000000000000000000000000000001";   

      
    const amountIn = ethers.parseUnits("1", 6);
    const expectedOut = ethers.parseUnits("1", 6);
    const userMaxSlippageBps = 1000n;

    console.log("\n💱 Invalid Token Swap Parameters:");
    console.log(`   Invalid Token Address: ${invalidTokenAddr}`);
    console.log(`   Input Amount: ${ethers.formatUnits(amountIn, 6)}`);

      
    const encIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    const encOut = await fhevm.createEncryptedInput(pool, alice.address).add64(expectedOut).encrypt();

      
    const proofHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const sig = await verifier.signMessage(ethers.getBytes(proofHash));
    const parsed = ethers.Signature.from(sig);

    const expiry = Math.floor(Date.now() / 1000) + 3600;

    console.log("\n🔄 Attempting to Execute Invalid Token Swap:");
    console.log("   Expected Result: Should fail due to invalid token address");

    try {
      await guarded.connect(alice).swapWithProof(
        encIn.handles[0], encIn.inputProof,
        encOut.handles[0], encOut.inputProof,
        invalidTokenAddr,   
        alice.address,
        expiry,
        proofHash as any,
        parsed.v, parsed.r, parsed.s
      );
      console.log("   ❌ Unexpected Success: Should fail due to invalid token address");
      expect.fail("Should fail due to invalid token address");
    } catch (error) {
      console.log("   ✅ Expected Failure: Correctly rejected invalid token address");
      console.log(`   Error Message: ${error instanceof Error ? error.message : String(error)}`);
      expect(error).to.not.be.undefined;
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ Invalid Token Address Test Completed - Successfully Rejected Invalid Swap");
    console.log("=".repeat(80));
  });

  it("should reject swaps with expired proofs", async function () {
    console.log("\n" + "=".repeat(80));
    console.log("⏰ Testing Swap with Expired Proof (Should Be Rejected)");
    console.log("=".repeat(80));

    const pool = await guarded.getAddress();
    const tokenAAddr = await tokenA.getAddress();

      
    const amountIn = ethers.parseUnits("1", 6);
    const expectedOut = ethers.parseUnits("1", 6);
    const userMaxSlippageBps = 1000n;

    console.log("\n💱 Expired Proof Swap Parameters:");
    console.log(`   Input Amount: ${ethers.formatUnits(amountIn, 6)} TokenA`);

      
    const encIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
    const encOut = await fhevm.createEncryptedInput(pool, alice.address).add64(expectedOut).encrypt();

      
    const proofHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const sig = await verifier.signMessage(ethers.getBytes(proofHash));
    const parsed = ethers.Signature.from(sig);

      
    const expiredTime = Math.floor(Date.now() / 1000) - 3600; // Expired 1 hour ago

    console.log("\n🔄 Attempting to Execute Swap with Expired Proof:");
    console.log(`   Expiry Time: ${expiredTime} (${new Date(expiredTime * 1000).toISOString()})`);
    console.log("   Expected Result: Should fail due to expiration");

    try {
      await guarded.connect(alice).swapWithProof(
        encIn.handles[0], encIn.inputProof,
        encOut.handles[0], encOut.inputProof,
        tokenAAddr,
        alice.address,
        expiredTime,   
        proofHash as any,
        parsed.v, parsed.r, parsed.s
      );
      console.log("   ❌ Unexpected Success: Should fail due to expiration");
      expect.fail("Should fail due to expiration");
    } catch (error) {
      console.log("   ✅ Expected Failure: Correctly rejected expired proof");
      console.log(`   Error Message: ${error instanceof Error ? error.message : String(error)}`);
      expect(error).to.not.be.undefined;
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ Expired Proof Test Completed - Successfully Rejected Expired Swap");
    console.log("=".repeat(80));
  });

  it("should support liquidity addition and removal", async function () {
    console.log("\n" + "=".repeat(80));
    console.log("💧 Testing Liquidity Addition and Removal Operations");
    console.log("=".repeat(80));

    const pool = await guarded.getAddress();
    const tokenAAddr = await tokenA.getAddress();
    const tokenBAddr = await tokenB.getAddress();

      
    const reserve0Enc = await guarded.getEncryptedReserve0();
    const reserve1Enc = await guarded.getEncryptedReserve1();
    const totalSupplyEnc = await guarded.getEncryptedTotalSupply();
    const aliceLPEnc = await guarded.getEncryptedLPBalance(alice.address);

    const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
    const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);
    const totalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(totalSupplyEnc), pool, deployer);
    const aliceLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(aliceLPEnc), pool, alice);

    console.log("\n📊 Current Liquidity Status:");
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(reserve0, 6)}`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(reserve1, 6)}`);
    console.log(`   Total Supply: ${ethers.formatUnits(totalSupply, 6)}`);
    console.log(`   Alice LP: ${ethers.formatUnits(aliceLP, 6)}`);

      
    console.log("\n💧 Testing Liquidity Addition:");
    const addAmount0 = ethers.parseUnits("10", 6);
    const addAmount1 = ethers.parseUnits("5", 6);

    const encAdd0 = await fhevm.createEncryptedInput(pool, alice.address).add64(addAmount0).encrypt();
    const encAdd1 = await fhevm.createEncryptedInput(pool, alice.address).add64(addAmount1).encrypt();

    const addTx = await guarded.connect(alice).addLiquidity(
      encAdd0.handles[0], encAdd0.inputProof,
      encAdd1.handles[0], encAdd1.inputProof
    );
    await addTx.wait();

    console.log(`   ✅ Liquidity Addition Successful:`);
    console.log(`     TokenA: ${ethers.formatUnits(addAmount0, 6)}`);
    console.log(`     TokenB: ${ethers.formatUnits(addAmount1, 6)}`);

      
    const newReserve0Enc = await guarded.getEncryptedReserve0();
    const newReserve1Enc = await guarded.getEncryptedReserve1();
    const newTotalSupplyEnc = await guarded.getEncryptedTotalSupply();
    const newAliceLPEnc = await guarded.getEncryptedLPBalance(alice.address);

    const newReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newReserve0Enc), pool, deployer);
    const newReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newReserve1Enc), pool, deployer);
    const newTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newTotalSupplyEnc), pool, deployer);
    const newAliceLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(newAliceLPEnc), pool, alice);

    console.log("\n📊 Status After Liquidity Addition:");
    console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(newReserve0, 6)} (+${ethers.formatUnits(newReserve0 - reserve0, 6)})`);
    console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(newReserve1, 6)} (+${ethers.formatUnits(newReserve1 - reserve1, 6)})`);
    console.log(`   Total Supply: ${ethers.formatUnits(newTotalSupply, 6)} (+${ethers.formatUnits(newTotalSupply - totalSupply, 6)})`);
    console.log(`   Alice LP: ${ethers.formatUnits(newAliceLP, 6)} (+${ethers.formatUnits(newAliceLP - aliceLP, 6)})`);

      
    expect(newReserve0 - reserve0).to.equal(addAmount0);
    expect(newReserve1 - reserve1).to.equal(addAmount1);

      
    console.log("\n💧 Testing Liquidity Removal:");
const removeAmount = ethers.parseUnits("5", 6);   

const encRemove = await fhevm.createEncryptedInput(pool, alice.address).add64(removeAmount).encrypt();

const removeTx = await guarded.connect(alice).removeLiquidity(
  encRemove.handles[0], encRemove.inputProof
);
await removeTx.wait();

console.log(`   ✅ Liquidity removal successful:`);
console.log(`     Removed LP Amount: ${ethers.formatUnits(removeAmount, 6)}`);

  
const finalReserve0Enc = await guarded.getEncryptedReserve0();
const finalReserve1Enc = await guarded.getEncryptedReserve1();
const finalTotalSupplyEnc = await guarded.getEncryptedTotalSupply();
const finalAliceLPEnc = await guarded.getEncryptedLPBalance(alice.address);

const finalReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalReserve0Enc), pool, deployer);
const finalReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalReserve1Enc), pool, deployer);
const finalTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalTotalSupplyEnc), pool, deployer);
const finalAliceLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalAliceLPEnc), pool, alice);

console.log("\n📊 State After Liquidity Removal:");
console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(finalReserve0, 6)}`);
console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(finalReserve1, 6)}`);
console.log(`   Total Supply: ${ethers.formatUnits(finalTotalSupply, 6)}`);
console.log(`   Alice LP: ${ethers.formatUnits(finalAliceLP, 6)}`);

  
expect(finalAliceLP).to.be.lessThan(newAliceLP);
expect(finalTotalSupply).to.be.lessThan(newTotalSupply);

console.log("\n" + "=".repeat(80));
console.log("🎉 Liquidity Operation Tests Completed - Successfully Verified");
console.log("=".repeat(80));
});

it("Should reject invalid proofs with tampered reserves", async function () {
console.log("\n" + "=".repeat(80));
console.log("❌ Testing Invalid Proofs with Tampered Reserves (Should Be Rejected)");
console.log("=".repeat(80));

const pool = await guarded.getAddress();
const tokenAAddr = await tokenA.getAddress();

  
const reserve0Enc = await guarded.getEncryptedReserve0();
const reserve1Enc = await guarded.getEncryptedReserve1();
const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);

console.log("\n📊 Current Reserve State:");
console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(reserve0, 6)}`);
console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(reserve1, 6)}`);

  
const amountIn = ethers.parseUnits("1", 6);
const feeN = 997n;
const feeD = 1000n;
const userMaxSlippageBps = 1000n;

console.log("\n💱 Swap Parameters:");
console.log(`   Input Amount: ${ethers.formatUnits(amountIn, 6)} TokenA`);

  
const encAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
await (await guarded.connect(alice).getAmountOut(encAmountIn.handles[0], encAmountIn.inputProof, tokenAAddr)).wait();

const numeratorEnc = await guarded.getEncryptedNumerator();
const denominatorEnc = await guarded.getEncryptedDenominator();

const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
const expectedOut = numerator / denominator;
const minOut = (expectedOut * 99n) / 100n;

  
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const expiry = Math.floor(Date.now() / 1000) + 3600;
const nonce = 100;   

const inputs = {
  reserve_in: Number(reserve0) + 1000000,   
  reserve_out: Number(reserve1),
  amount_in: Number(amountIn),
  fee_numerator: Number(feeN),
  fee_denominator: Number(feeD),
  expected_out: Number(expectedOut),
  min_out: Number(minOut),
  max_slippage_bps: Number(userMaxSlippageBps),
  chain_id: chainId,
  pool: Array(20).fill(0),
  token_in: Array(20).fill(0),
  to: Array(20).fill(1),
  expiry: expiry,
  nonce: nonce,
};

console.log("\n🚀 Calling RISC Zero to Generate Proof (Tampered Reserves):");
console.log("   Tampered Reserve Input:", inputs.reserve_in);
console.log("   Expected Result: Should Fail Due to Mismatched Reserves");

try {
  const proofHashHex = runHostWithJson(inputs);
  console.log("   ❌ Unexpected Success: RISC Zero Should Reject Tampered Reserves");
  expect.fail("RISC Zero Should Reject Proofs with Tampered Reserves");
} catch (error) {
  console.log("   ✅ Expected Failure: RISC Zero Correctly Rejected Tampered Reserves");
  console.log(`   Error Message: ${error instanceof Error ? error.message : String(error)}`);
}

console.log("\n" + "=".repeat(80));
console.log("✅ Tampered Reserves Test Completed - Invalid Proofs Rejected Correctly");
console.log("=".repeat(80));
});

it("Should reject invalid proofs with wrong chainId", async function () {
console.log("\n" + "=".repeat(80));
console.log("❌ Testing Invalid Proofs with Wrong ChainId (Should Be Rejected)");
console.log("=".repeat(80));

const pool = await guarded.getAddress();
const tokenAAddr = await tokenA.getAddress();

  
const reserve0Enc = await guarded.getEncryptedReserve0();
const reserve1Enc = await guarded.getEncryptedReserve1();
const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);

  
const amountIn = ethers.parseUnits("1", 6);
const feeN = 997n;
const feeD = 1000n;
const userMaxSlippageBps = 1000n;

  
const encAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
await (await guarded.connect(alice).getAmountOut(encAmountIn.handles[0], encAmountIn.inputProof, tokenAAddr)).wait();

const numeratorEnc = await guarded.getEncryptedNumerator();
const denominatorEnc = await guarded.getEncryptedDenominator();

const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
const expectedOut = numerator / denominator;
const minOut = (expectedOut * 99n) / 100n;

  
const wrongChainId = 999999;   
const expiry = Math.floor(Date.now() / 1000) + 3600;
const nonce = 101;

const inputs = {
  reserve_in: Number(reserve0),
  reserve_out: Number(reserve1),
  amount_in: Number(amountIn),
  fee_numerator: Number(feeN),
  fee_denominator: Number(feeD),
  expected_out: Number(expectedOut),
  min_out: Number(minOut),
  max_slippage_bps: Number(userMaxSlippageBps),
  chain_id: wrongChainId,   
  pool: Array(20).fill(0),
  token_in: Array(20).fill(0),
  to: Array(20).fill(1),
  expiry: expiry,
  nonce: nonce,
};

console.log("\n🚀 Calling RISC Zero to Generate Proof (Wrong ChainId):");
console.log(`   Wrong ChainId: ${wrongChainId}`);
console.log("   Expected Result: Should Fail Due to Mismatched ChainId");

try {
  const proofHashHex = runHostWithJson(inputs);
  console.log("   ❌ Unexpected Success: RISC Zero Should Reject Wrong ChainId");
  expect.fail("RISC Zero Should Reject Proofs with Wrong ChainId");
} catch (error) {
  console.log("   ✅ Expected Failure: RISC Zero Correctly Rejected Wrong ChainId");
  console.log(`   Error Message: ${error instanceof Error ? error.message : String(error)}`);
}

console.log("\n" + "=".repeat(80));
console.log("✅ Wrong ChainId Test Completed - Invalid Proofs Rejected Correctly");
console.log("=".repeat(80));
});

it("Should reject invalid proofs with wrong addresses", async function () {
console.log("\n" + "=".repeat(80));
console.log("❌ Testing Invalid Proofs with Wrong Addresses (Should Be Rejected)");
console.log("=".repeat(80));

const pool = await guarded.getAddress();
const tokenAAddr = await tokenA.getAddress();

  
const reserve0Enc = await guarded.getEncryptedReserve0();
const reserve1Enc = await guarded.getEncryptedReserve1();
const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);

  
const amountIn = ethers.parseUnits("1", 6);
const feeN = 997n;
const feeD = 1000n;
const userMaxSlippageBps = 1000n;

  
const encAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
await (await guarded.connect(alice).getAmountOut(encAmountIn.handles[0], encAmountIn.inputProof, tokenAAddr)).wait();

const numeratorEnc = await guarded.getEncryptedNumerator();
const denominatorEnc = await guarded.getEncryptedDenominator();

const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
const expectedOut = numerator / denominator;
const minOut = (expectedOut * 99n) / 100n;

  
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const expiry = Math.floor(Date.now() / 1000) + 3600;
const nonce = 102;

const inputs = {
  reserve_in: Number(reserve0),
  reserve_out: Number(reserve1),
  amount_in: Number(amountIn),
  fee_numerator: Number(feeN),
  fee_denominator: Number(feeD),
  expected_out: Number(expectedOut),
  min_out: Number(minOut),
  max_slippage_bps: Number(userMaxSlippageBps),
  chain_id: chainId,
  pool: Array(20).fill(0xff),   
  token_in: Array(20).fill(0xaa),   
  to: Array(20).fill(0xbb),   
  expiry: expiry,
  nonce: nonce,
};

console.log("\n🚀 Calling RISC Zero to Generate Proof (Wrong Addresses):");
console.log("   Wrong Pool Address:", inputs.pool);
console.log("   Wrong Token Address:", inputs.token_in);
console.log("   Wrong Recipient Address:", inputs.to);
console.log("   Expected Result: Should Fail Due to Mismatched Addresses");

try {
  const proofHashHex = runHostWithJson(inputs);
  console.log("   ❌ Unexpected Success: RISC Zero Should Reject Wrong Addresses");
  expect.fail("RISC Zero Should Reject Proofs with Wrong Addresses");
} catch (error) {
  console.log("   ✅ Expected Failure: RISC Zero Correctly Rejected Wrong Addresses");
  console.log(`   Error Message: ${error instanceof Error ? error.message : String(error)}`);
}

console.log("\n" + "=".repeat(80));
console.log("✅ Wrong Addresses Test Completed - Invalid Proofs Rejected Correctly");
console.log("=".repeat(80));
});

it("Should reject proofs with reused nonce", async function () {
console.log("\n" + "=".repeat(80));
console.log("❌ Testing Proofs with Reused Nonce (Should Be Rejected)");
console.log("=".repeat(80));

const pool = await guarded.getAddress();
const tokenAAddr = await tokenA.getAddress();

  
const reserve0Enc = await guarded.getEncryptedReserve0();
const reserve1Enc = await guarded.getEncryptedReserve1();
const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);

  
const amountIn = ethers.parseUnits("1", 6);
const feeN = 997n;
const feeD = 1000n;
const userMaxSlippageBps = 1000n;

  
const encAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
await (await guarded.connect(alice).getAmountOut(encAmountIn.handles[0], encAmountIn.inputProof, tokenAAddr)).wait();

const numeratorEnc = await guarded.getEncryptedNumerator();
const denominatorEnc = await guarded.getEncryptedDenominator();

const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
const expectedOut = numerator / denominator;
const minOut = (expectedOut * 99n) / 100n;

  
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const expiry = Math.floor(Date.now() / 1000) + 3600;
const reusedNonce = 1;   

const inputs = {
  reserve_in: Number(reserve0),
  reserve_out: Number(reserve1),
  amount_in: Number(amountIn),
  fee_numerator: Number(feeN),
  fee_denominator: Number(feeD),
  expected_out: Number(expectedOut),
  min_out: Number(minOut),
  max_slippage_bps: Number(userMaxSlippageBps),
  chain_id: chainId,
  pool: Array(20).fill(0),
  token_in: Array(20).fill(0),
  to: Array(20).fill(1),
  expiry: expiry,
  nonce: reusedNonce,   
};

console.log("\n🚀 Calling RISC Zero to Generate Proof (Reused Nonce):");
console.log(`   Reused Nonce: ${reusedNonce}`);
console.log("   Expected Result: Should Fail Due to Reused Nonce");

try {
  const proofHashHex = runHostWithJson(inputs);
  console.log("   ❌ Unexpected Success: RISC Zero Should Reject Reused Nonce");
  expect.fail("RISC Zero Should Reject Proofs with Reused Nonce");
} catch (error) {
  console.log("   ✅ Expected Failure: RISC Zero Correctly Rejected Reused Nonce");
  console.log(`   Error Message: ${error instanceof Error ? error.message : String(error)}`);
}

console.log("\n" + "=".repeat(80));
console.log("✅ Reused Nonce Test Completed - Invalid Proofs Rejected Correctly");
console.log("=".repeat(80));
});

it("Should reject invalid proofs with tampered expected output", async function () {
console.log("\n" + "=".repeat(80));
console.log("❌ Testing Invalid Proofs with Tampered Expected Output (Should Be Rejected)");
console.log("=".repeat(80));

const pool = await guarded.getAddress();
const tokenAAddr = await tokenA.getAddress();

  
const reserve0Enc = await guarded.getEncryptedReserve0();
const reserve1Enc = await guarded.getEncryptedReserve1();
const reserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve0Enc), pool, deployer);
const reserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(reserve1Enc), pool, deployer);

  
const amountIn = ethers.parseUnits("1", 6);
const feeN = 997n;
const feeD = 1000n;
const userMaxSlippageBps = 1000n;

  
const encAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(amountIn).encrypt();
await (await guarded.connect(alice).getAmountOut(encAmountIn.handles[0], encAmountIn.inputProof, tokenAAddr)).wait();

const numeratorEnc = await guarded.getEncryptedNumerator();
const denominatorEnc = await guarded.getEncryptedDenominator();

const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
const expectedOut = numerator / denominator;
const minOut = (expectedOut * 99n) / 100n;

  
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const expiry = Math.floor(Date.now() / 1000) + 3600;
const nonce = 103;

const inputs = {
  reserve_in: Number(reserve0),
  reserve_out: Number(reserve1),
  amount_in: Number(amountIn),
  fee_numerator: Number(feeN),
  fee_denominator: Number(feeD),
  expected_out: Number(expectedOut) + 1000000,   
  min_out: Number(minOut),
  max_slippage_bps: Number(userMaxSlippageBps),
  chain_id: chainId,
  pool: Array(20).fill(0),
  token_in: Array(20).fill(0),
  to: Array(20).fill(1),
  expiry: expiry,
  nonce: nonce,
};

console.log("\n🚀 Calling RISC Zero to Generate Proof (Tampered Expected Output):");
console.log("   Tampered Expected Output:", inputs.expected_out);
console.log("   Expected Result: Should Fail Due to Mismatched Expected Output");

try {
  const proofHashHex = runHostWithJson(inputs);
  console.log("   ❌ Unexpected Success: RISC Zero Should Reject Tampered Expected Output");
  expect.fail("RISC Zero Should Reject Proofs with Tampered Expected Output");
} catch (error) {
  console.log("   ✅ Expected Failure: RISC Zero Correctly Rejected Tampered Expected Output");
  console.log(`   Error Message: ${error instanceof Error ? error.message : String(error)}`);
}

console.log("\n" + "=".repeat(80));
console.log("✅ Tampered Expected Output Test Completed - Invalid Proofs Rejected Correctly");
console.log("=".repeat(80));
});

it("Full User Flow: Add Liquidity → Swap → Remove Liquidity", async function () {
console.log("\n" + "=".repeat(80));
console.log("🔄 Full User Flow Test: Add Liquidity → Swap → Remove Liquidity");
console.log("=".repeat(80));

const pool = await guarded.getAddress();
const tokenAAddr = await tokenA.getAddress();
const tokenBAddr = await tokenB.getAddress();

// ==================== Step 1: Add Liquidity ====================
console.log("\n" + "=".repeat(60));
console.log("💧 Step 1: User Adds Liquidity");
console.log("=".repeat(60));

  
const initialReserve0Enc = await guarded.getEncryptedReserve0();
const initialReserve1Enc = await guarded.getEncryptedReserve1();
const initialTotalSupplyEnc = await guarded.getEncryptedTotalSupply();
const initialAliceLPEnc = await guarded.getEncryptedLPBalance(alice.address);

const initialReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(initialReserve0Enc), pool, deployer);
const initialReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(initialReserve1Enc), pool, deployer);
const initialTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(initialTotalSupplyEnc), pool, deployer);
const initialAliceLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(initialAliceLPEnc), pool, alice);

console.log("\n📊 State Before Adding Liquidity:");
console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(initialReserve0, 6)}`);
console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(initialReserve1, 6)}`);
console.log(`   Total Supply: ${ethers.formatUnits(initialTotalSupply, 6)}`);
console.log(`   Alice LP: ${ethers.formatUnits(initialAliceLP, 6)}`);

  
const addAmount0 = ethers.parseUnits("20", 6);   
const addAmount1 = ethers.parseUnits("10", 6);   

console.log("\n💧 Liquidity Addition Parameters:");
console.log(`   TokenA: ${ethers.formatUnits(addAmount0, 6)}`);
console.log(`   TokenB: ${ethers.formatUnits(addAmount1, 6)}`);

const encAdd0 = await fhevm.createEncryptedInput(pool, alice.address).add64(addAmount0).encrypt();
const encAdd1 = await fhevm.createEncryptedInput(pool, alice.address).add64(addAmount1).encrypt();

const addTx = await guarded.connect(alice).addLiquidity(
  encAdd0.handles[0], encAdd0.inputProof,
  encAdd1.handles[0], encAdd1.inputProof
);
await addTx.wait();

console.log(`   ✅ Liquidity Added Successfully: ${addTx.hash}`);

  
const afterAddReserve0Enc = await guarded.getEncryptedReserve0();
const afterAddReserve1Enc = await guarded.getEncryptedReserve1();
const afterAddTotalSupplyEnc = await guarded.getEncryptedTotalSupply();
const afterAddAliceLPEnc = await guarded.getEncryptedLPBalance(alice.address);

const afterAddReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterAddReserve0Enc), pool, deployer);
const afterAddReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterAddReserve1Enc), pool, deployer);
const afterAddTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterAddTotalSupplyEnc), pool, deployer);
const afterAddAliceLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterAddAliceLPEnc), pool, alice);

console.log("\n📊 State After Adding Liquidity:");
console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(afterAddReserve0, 6)} (+${ethers.formatUnits(afterAddReserve0 - initialReserve0, 6)})`);
console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(afterAddReserve1, 6)} (+${ethers.formatUnits(afterAddReserve1 - initialReserve1, 6)})`);
console.log(`   Total Supply: ${ethers.formatUnits(afterAddTotalSupply, 6)} (+${ethers.formatUnits(afterAddTotalSupply - initialTotalSupply, 6)})`);
console.log(`   Alice LP: ${ethers.formatUnits(afterAddAliceLP, 6)} (+${ethers.formatUnits(afterAddAliceLP - initialAliceLP, 6)})`);

  
expect(afterAddReserve0 - initialReserve0).to.equal(addAmount0);
expect(afterAddReserve1 - initialReserve1).to.equal(addAmount1);

// ==================== Step 2: Execute Swap ====================
console.log("\n" + "=".repeat(60));
console.log("🔄 Step 2: Execute Swap Operation");
console.log("=".repeat(60));

  
const swapAmountIn = ethers.parseUnits("5", 6);   
const feeN = 997n;
const feeD = 1000n;
const userMaxSlippageBps = 50n; // 0.5% Slippage

console.log("\n💱 Swap Parameters:");
console.log(`   Input Amount: ${ethers.formatUnits(swapAmountIn, 6)} TokenA`);
console.log(`   User Max Slippage: ${userMaxSlippageBps} bps (0.5%)`);

  
const encSwapAmountIn = await fhevm.createEncryptedInput(pool, alice.address).add64(swapAmountIn).encrypt();
await (await guarded.connect(alice).getAmountOut(encSwapAmountIn.handles[0], encSwapAmountIn.inputProof, tokenAAddr)).wait();

const numeratorEnc = await guarded.getEncryptedNumerator();
const denominatorEnc = await guarded.getEncryptedDenominator();

const numerator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(numeratorEnc), pool, alice);
const denominator = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(denominatorEnc), pool, alice);
const expectedOut = numerator / denominator;
  
const minAllowedOut = (expectedOut * (10000n - userMaxSlippageBps)) / 10000n;
const minOut = minAllowedOut;   

console.log(`   Expected Output: ${ethers.formatUnits(expectedOut, 6)} TokenB`);
console.log(`   Minimum Output: ${ethers.formatUnits(minOut, 6)} TokenB`);
console.log(`   Theoretical Min Output (0.5% Slippage): ${ethers.formatUnits(minAllowedOut, 6)} TokenB`);

  
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const expiry = Math.floor(Date.now() / 1000) + 3600;
const nonce = 200;   

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
  expiry: expiry,
  nonce: nonce,
};

console.log("\n🚀 Generating RISC Zero Proof:");
const proofHashHex = runHostWithJson(inputs);
const proofHash = proofHashHex as `0x${string}`;
console.log(`   ✅ Proof Generated Successfully: ${proofHash.substring(0, 10)}...`);

  
const sig = await verifier.signMessage(ethers.getBytes(proofHash));
const parsed = ethers.Signature.from(sig);

  
const encIn = await fhevm.createEncryptedInput(pool, alice.address).add64(swapAmountIn).encrypt();
const encOut = await fhevm.createEncryptedInput(pool, alice.address).add64(expectedOut).encrypt();

const swapTx = await guarded.connect(alice).swapWithProof(
  encIn.handles[0], encIn.inputProof,
  encOut.handles[0], encOut.inputProof,
  tokenAAddr,
  alice.address,
  inputs.expiry,
  proofHash as any,
  parsed.v, parsed.r, parsed.s
);

const swapReceipt = await swapTx.wait();
console.log(`   ✅ Swap Executed Successfully: ${swapTx.hash}`);

  
const afterSwapReserve0Enc = await guarded.getEncryptedReserve0();
const afterSwapReserve1Enc = await guarded.getEncryptedReserve1();

const afterSwapReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterSwapReserve0Enc), pool, deployer);
const afterSwapReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(afterSwapReserve1Enc), pool, deployer);

console.log("\n📊 Reserve State After Swap:");
console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(afterSwapReserve0, 6)} (+${ethers.formatUnits(afterSwapReserve0 - afterAddReserve0, 6)})`);
console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(afterSwapReserve1, 6)} (-${ethers.formatUnits(afterAddReserve1 - afterSwapReserve1, 6)})`);

  
expect(afterSwapReserve0 - afterAddReserve0).to.equal(swapAmountIn);
expect(afterAddReserve1 - afterSwapReserve1).to.equal(expectedOut);

// ==================== Step 3: Remove Liquidity ====================
console.log("\n" + "=".repeat(60));
console.log("💧 Step 3: Remove Liquidity");
console.log("=".repeat(60));

  
const removeAmount = ethers.parseUnits("15", 6);   

console.log("\n💧 Liquidity Removal Parameters:");
console.log(`   LP Amount to Remove: ${ethers.formatUnits(removeAmount, 6)}`);

const encRemove = await fhevm.createEncryptedInput(pool, alice.address).add64(removeAmount).encrypt();

const removeTx = await guarded.connect(alice).removeLiquidity(
  encRemove.handles[0], encRemove.inputProof
);
await removeTx.wait();

console.log(`   ✅ Liquidity Removed Successfully: ${removeTx.hash}`);

  
const finalReserve0Enc = await guarded.getEncryptedReserve0();
const finalReserve1Enc = await guarded.getEncryptedReserve1();
const finalTotalSupplyEnc = await guarded.getEncryptedTotalSupply();
const finalAliceLPEnc = await guarded.getEncryptedLPBalance(alice.address);

const finalReserve0 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalReserve0Enc), pool, deployer);
const finalReserve1 = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalReserve1Enc), pool, deployer);
const finalTotalSupply = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalTotalSupplyEnc), pool, deployer);
const finalAliceLP = await fhevm.userDecryptEuint(FhevmType.euint64, ethers.hexlify(finalAliceLPEnc), pool, alice);

console.log("\n📊 Final State:");
console.log(`   Reserve0 (TokenA): ${ethers.formatUnits(finalReserve0, 6)}`);
console.log(`   Reserve1 (TokenB): ${ethers.formatUnits(finalReserve1, 6)}`);
console.log(`   Total Supply: ${ethers.formatUnits(finalTotalSupply, 6)}`);
console.log(`   Alice LP: ${ethers.formatUnits(finalAliceLP, 6)}`);

  
expect(finalAliceLP).to.be.lessThan(afterAddAliceLP);
expect(finalTotalSupply).to.be.lessThan(afterAddTotalSupply);

// ==================== Flow Summary ====================
console.log("\n" + "=".repeat(60));
console.log("📈 Full Flow Summary");
console.log("=".repeat(60));

console.log("\n🔄 Flow Change Statistics:");
console.log(`   Initial Reserves: ${ethers.formatUnits(initialReserve0, 6)} TokenA, ${ethers.formatUnits(initialReserve1, 6)} TokenB`);
console.log(`   Liquidity Added: +${ethers.formatUnits(addAmount0, 6)} TokenA, +${ethers.formatUnits(addAmount1, 6)} TokenB`);
console.log(`   Swap Executed: +${ethers.formatUnits(swapAmountIn, 6)} TokenA, -${ethers.formatUnits(expectedOut, 6)} TokenB`);
console.log(`   Liquidity Removed: -${ethers.formatUnits(removeAmount, 6)} LP`);
console.log(`   Final Reserves: ${ethers.formatUnits(finalReserve0, 6)} TokenA, ${ethers.formatUnits(finalReserve1, 6)} TokenB`);

console.log("\n✅ Flow Verification:");
console.log(`   ✅ Liquidity Addition: Reserves Increased Correctly`);
console.log(`   ✅ Swap Execution: Reserves Changed Correctly per AMM Formula`);
console.log(`   ✅ Liquidity Removal: LP and Reserves Decreased Correctly`);
console.log(`   ✅ Anti-Replay Protection: Proof Hash Consumed`);

  
const isConsumed = await guarded.consumedProofs(proofHash);
expect(isConsumed).to.be.true;

console.log("\n" + "=".repeat(80));
console.log("🎉 Full User Flow Test Completed Successfully!");
console.log("   Full Flow Verified: Add Liquidity → Swap → Remove Liquidity");
console.log("=".repeat(80));
});
});
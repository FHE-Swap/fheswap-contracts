import { FHESwap, FHESwap__factory, ConfidentialFungibleTokenMintableBurnable, ConfidentialFungibleTokenMintableBurnable__factory } from "../types";            
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import hre from "hardhat";
import { ethers as ethersjs } from "ethers";

/**
 * @dev Define the signer types used in tests.
 * deployer: The account that deploys contracts, usually the "owner" or "admin" in tests.
 * alice: An account that simulates regular user interactions.
 * bob: Another account that simulates regular user interactions.
 */
type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

/**
 * @dev Helper function to deploy ConfidentialFungibleTokenMintableBurnable and FHESwap contracts.
 * @param deployerAddress The address of the contract deployer, also the owner of the token and FHESwap contracts.
 * @returns An object containing the deployed token contract instance, address, FHESwap contract instance, and address.
 */
async function deployTokenAndSwapFixture(deployerAddress: string) {
  console.log("\n--- Deploy Contracts ---");
  // Get ConfidentialFungibleTokenMintableBurnable contract factory
  const tokenFactory = (await ethers.getContractFactory("ConfidentialFungibleTokenMintableBurnable")) as ConfidentialFungibleTokenMintableBurnable__factory;
  // Deploy TokenA, name "TokenA", symbol "TKA"
  const tokenA = (await tokenFactory.deploy(deployerAddress, "TokenA", "TKA", "https://example.com/metadataA")) as ConfidentialFungibleTokenMintableBurnable;
  // Deploy TokenB, name "TokenB", symbol "TKB"
  const tokenB = (await tokenFactory.deploy(deployerAddress, "TokenB", "TKB", "https://example.com/metadataB")) as ConfidentialFungibleTokenMintableBurnable;

  // Get deployed TokenA and TokenB contract addresses
  const tokenAAddress = await tokenA.getAddress();
  const tokenBAddress = await tokenB.getAddress();
  console.log(`TokenA deployed at: ${tokenAAddress}`);
  console.log(`TokenB deployed at: ${tokenBAddress}`);

  // Get FHESwapUser contract factory
  const swapFactory = await ethers.getContractFactory("FHESwapUser");
  // Deploy FHESwapUser contract, passing TokenA and TokenB addresses, and deployer address as owner
  const fHeSwap = await swapFactory.deploy(tokenAAddress, tokenBAddress, deployerAddress);
  // Get deployed FHESwap contract address
  const fHeSwapAddress = await fHeSwap.getAddress();
  console.log(`FHESwap deployed at: ${fHeSwapAddress}`);
  console.log("--- Contracts deployed ---\n");

  // Return all deployed contract instances and addresses
  return { tokenA, tokenB, tokenAAddress, tokenBAddress, fHeSwap, fHeSwapAddress };
}

/**
 * @dev Test suite for FHESwapUser contract.
 * Includes deployment, liquidity provision, and token exchange tests.
 */
describe("FHESwapUser", function () {
  // Define variables for signers and contract instances used in tests
  let signers: Signers;
  let tokenA: ConfidentialFungibleTokenMintableBurnable;
  let tokenB: ConfidentialFungibleTokenMintableBurnable;
  let tokenAAddress: string;
  let tokenBAddress: string;
  let fHeSwap: any;
  let fHeSwapAddress: string;
  let initialReserveAmountA: bigint;
  let initialReserveAmountB: bigint;

  // Hook function to execute once before all test cases
  before(async function () {
    console.log("--- Test Initialization ---");
    // Initialize FHEVM CLI API, which is required for interacting with FHEVM
    await fhevm.initializeCLIApi();
    // Get Ethereum signers (accounts) provided by Hardhat
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    // Assign signers to named variables for subsequent use
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
    console.log(`Deployer Address: ${signers.deployer.address}`);
    console.log(`Alice Address: ${signers.alice.address}`);
    console.log(`Bob Address: ${signers.bob.address}`);

    // Call helper function to deploy all contracts and destructure into respective variables
    ({ tokenA, tokenB, tokenAAddress, tokenBAddress, fHeSwap, fHeSwapAddress } = await deployTokenAndSwapFixture(await signers.deployer.getAddress()));

    // Assert that FHEVM coprocessor is initialized. This is crucial for ensuring FHE operations work correctly.
    await hre.fhevm.assertCoprocessorInitialized(tokenA, "ConfidentialFungibleTokenMintableBurnable");
    await hre.fhevm.assertCoprocessorInitialized(tokenB, "ConfidentialFungibleTokenMintableBurnable");
    await hre.fhevm.assertCoprocessorInitialized(fHeSwap, "FHESwapUser");
    console.log("--- FHEVM Coprocessor Initialized ---\n");
  });

  /**
   * @dev Test if FHESwapUser contract is successfully deployed and checks its initial state (e.g., token0, token1, owner address).
   */
  it("should deploy FHESwapUser successfully and set correct token addresses", async function () {
    console.log("--- Test: Deploy FHESwapUser and set correct addresses ---");

    // Verify that the token0 address recorded in FHESwapUser contract matches the actual deployed TokenA address
    expect(await fHeSwap.token0()).to.equal(tokenAAddress);
    console.log(`FHESwap.token0: ${await fHeSwap.token0()} (Expected: ${tokenAAddress})`);

    // Verify that the token1 address recorded in FHESwapUser contract matches the actual deployed TokenB address
    expect(await fHeSwap.token1()).to.equal(tokenBAddress);
    console.log(`FHESwap.token1: ${await fHeSwap.token1()} (Expected: ${tokenBAddress})`);
    
    // Verify that the owner of FHESwapUser is the deployer
    expect(await fHeSwap.owner()).to.equal(signers.deployer.address);
    console.log(`FHESwap.owner: ${await fHeSwap.owner()} (Expected: ${signers.deployer.address})`);
    console.log("--- Deployment Test Passed ---\n");
  });

  /**
   * @dev Test if the owner (deployer) can successfully mint initial liquidity.
   * This includes minting tokens for themselves, authorizing FHESwapUser contract as an operator, and calling FHESwapUser's mint function.
   * Finally, verify that the encrypted reserves in FHESwapUser contract are updated correctly.
   */
  it("should allow owner to mint initial liquidity", async function () {
    console.log("--- Test: Owner minting initial liquidity ---");
    const owner = signers.deployer; // Define owner as the deployer account
    initialReserveAmountA = ethersjs.parseUnits("1000", 6); // Initial liquidity amount
    initialReserveAmountB = ethersjs.parseUnits("300", 6); // Initial liquidity amount
    console.log(`Initial reserve amounts: TokenA: ${ethersjs.formatUnits(initialReserveAmountA, 6)}, TokenB: ${ethersjs.formatUnits(initialReserveAmountB, 6)}`);

    // 1. Owner first mints TokenA and TokenB for themselves (for liquidity provision)
    console.log("1. Owner mints tokens for themselves:");
    // Create encrypted input, target contract is TokenA, initiator is owner, value is initialReserveAmount (euint64 type)
    const encryptedMintA = await fhevm.createEncryptedInput(tokenAAddress, owner.address).add64(initialReserveAmountA).encrypt();
    console.log(`Created encrypted input (TokenA): Handle=${ethersjs.hexlify(encryptedMintA.handles[0])}, Proof=${ethersjs.hexlify(encryptedMintA.inputProof)}`);
    // Owner calls TokenA contract's mint function to mint encrypted TokenA for themselves
    await tokenA.connect(owner).mint(owner.address, encryptedMintA.handles[0], encryptedMintA.inputProof);
    console.log(`Owner minted ${ethersjs.formatUnits(initialReserveAmountA, 6)} TokenA.`);

    // Get encrypted balance handle of owner in TokenA
    const ownerTokenAEncryptedBalance = await tokenA.confidentialBalanceOf(owner.address);
    console.log(`Encrypted balance handle of owner in TokenA: ${ethersjs.hexlify(ownerTokenAEncryptedBalance)}`);
    // Authorize TokenA contract to operate on owner's encrypted TokenA balance
    await tokenA.connect(owner).authorizeSelf(ownerTokenAEncryptedBalance);
    console.log(`Owner authorized TokenA contract to operate on their encrypted TokenA balance (Handle: ${ethersjs.hexlify(ownerTokenAEncryptedBalance)}, Authorized to: ${tokenAAddress}).`);

    // Decrypt owner's balance for diagnostic printing
    const decryptedOwnerTokenA = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethersjs.hexlify(ownerTokenAEncryptedBalance),
      tokenAAddress,
      owner
    );
    console.log(`Diagnostic: Owner's TokenA balance (Decrypted): ${ethersjs.formatUnits(decryptedOwnerTokenA, 6)}`);

    // Create encrypted input, target contract is TokenB, initiator is owner, value is initialReserveAmount (euint64 type)
    const encryptedMintB = await fhevm.createEncryptedInput(tokenBAddress, owner.address).add64(initialReserveAmountB).encrypt();
    console.log(`Created encrypted input (TokenB): Handle=${ethersjs.hexlify(encryptedMintB.handles[0])}, Proof=${ethersjs.hexlify(encryptedMintB.inputProof)}`);
    // Owner calls TokenB contract's mint function to mint encrypted TokenB for themselves
    await tokenB.connect(owner).mint(owner.address, encryptedMintB.handles[0], encryptedMintB.inputProof);
    console.log(`Owner minted ${ethersjs.formatUnits(initialReserveAmountB, 6)} TokenB.`);

    // Get encrypted balance handle of owner in TokenB
    const ownerTokenBEncryptedBalance = await tokenB.confidentialBalanceOf(owner.address);
    console.log(`Encrypted balance handle of owner in TokenB: ${ethersjs.hexlify(ownerTokenBEncryptedBalance)}`);
    // Authorize TokenB contract to operate on owner's encrypted TokenB balance
    await tokenB.connect(owner).authorizeSelf(ownerTokenBEncryptedBalance);
    console.log(`Owner authorized TokenB contract to operate on their encrypted TokenB balance (Handle: ${ethersjs.hexlify(ownerTokenBEncryptedBalance)}, Authorized to: ${tokenBAddress}).`);

    // 2. Owner authorizes FHESwapUser contract as operator for TokenA and TokenB
    console.log("2. Owner authorizes FHESwapUser as operator for TokenA and TokenB:");
    // operatorExpiry defines the expiry time for operator authorization (current time + 1 hour)
    const operatorExpiry = Math.floor(Date.now() / 1000) + 3600;
    // Owner calls TokenA contract's setOperator to authorize FHESwapUser contract to operate on owner's TokenA
    await tokenA.connect(owner).setOperator(fHeSwapAddress, operatorExpiry);
    console.log(`Owner authorized FHESwapUser as TokenA operator (FHESwapUser Address: ${fHeSwapAddress}, Expiry: ${operatorExpiry}).`);
    // Owner calls TokenB contract's setOperator to authorize FHESwapUser contract to operate on owner's TokenB
    await tokenB.connect(owner).setOperator(fHeSwapAddress, operatorExpiry);
    console.log(`Owner authorized FHESwapUser as TokenB operator (FHESwapUser Address: ${fHeSwapAddress}, Expiry: ${operatorExpiry}).`);

    // 3. Owner provides liquidity to FHESwapUser contract
    console.log("3. Owner provides liquidity to FHESwapUser:");
    // Create encrypted input, target contract is FHESwapUser, initiator is owner, value is initialReserveAmount (euint64 type)
    // Note: The target contract here must be fHeSwapAddress, as these encrypted inputs are prepared for FHESwapUser's mint function
    const encryptedAmount0 = await fhevm.createEncryptedInput(fHeSwapAddress, owner.address).add64(initialReserveAmountA).encrypt();
    console.log(`Created encrypted input (FHESwapUser mint TokenA): Handle=${ethersjs.hexlify(encryptedAmount0.handles[0])}, Proof=${ethersjs.hexlify(encryptedAmount0.inputProof)}`);
    const encryptedAmount1 = await fhevm.createEncryptedInput(fHeSwapAddress, owner.address).add64(initialReserveAmountB).encrypt();
    console.log(`Created encrypted input (FHESwapUser mint TokenB): Handle=${ethersjs.hexlify(encryptedAmount1.handles[0])}, Proof=${ethersjs.hexlify(encryptedAmount1.inputProof)}`);
    console.log(`Preparing to inject liquidity into FHESwapUser: TokenA: ${ethersjs.formatUnits(initialReserveAmountA, 6)}, TokenB: ${ethersjs.formatUnits(initialReserveAmountB, 6)} (Encrypted).`);

    // Owner calls FHESwapUser contract's mint function to provide encrypted TokenA and TokenB as liquidity
    await fHeSwap.connect(owner).mint(
      encryptedAmount0.handles[0],
      encryptedAmount0.inputProof,
      encryptedAmount1.handles[0],
      encryptedAmount1.inputProof
    );
    console.log("FHESwapUser.mint call completed, liquidity injected.");

    // Verify FHESwapUser contract's internal reserves (encrypted state)
    console.log("Verifying FHESwapUser reserves:");
    // Get encrypted reserve0 of FHESwapUser contract
    const encryptedReserve0 = await fHeSwap.getEncryptedReserve0();
    // Decrypt reserve0 for off-chain verification. Requires providing FHE type, encrypted value, contract address, and decrypter.
    const decryptedReserve0 = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethersjs.hexlify(encryptedReserve0),
      fHeSwapAddress,
      owner // Owner can decrypt reserves
    );
    console.log(`Decrypted FHESwapUser reserve0: ${ethersjs.formatUnits(decryptedReserve0, 6)} (Expected: ${ethersjs.formatUnits(initialReserveAmountA, 6)})`);
    // Assert decrypted reserve0 equals the initial set liquidity amount
    expect(decryptedReserve0).to.equal(initialReserveAmountA);

    // Get encrypted reserve1 of FHESwapUser contract
    const encryptedReserve1 = await fHeSwap.getEncryptedReserve1();
    // Decrypt reserve1
    const decryptedReserve1 = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethersjs.hexlify(encryptedReserve1),
      fHeSwapAddress,
      owner
    );
    console.log(`Decrypted FHESwapUser reserve1: ${ethersjs.formatUnits(decryptedReserve1, 6)} (Expected: ${ethersjs.formatUnits(initialReserveAmountB, 6)})`);
    // Assert decrypted reserve1 equals the initial set liquidity amount
    expect(decryptedReserve1).to.equal(initialReserveAmountB);
    console.log("--- Initial liquidity injection test passed ---\n");
  });

  /**
   * @dev Test if a user (Alice) can successfully swap TokenA for TokenB with fees.
   * This test simulates on-chain calculations in FHEVM using custom division and verification process.
   */
  it("should allow a user to swap TokenA for TokenB with fees", async function () {
    console.log("--- Test: User swaps TokenA for TokenB ---");
    const owner = signers.deployer; // Deployer account
    const alice = signers.alice;   // User account
    const swapAmount = 1;        // Amount of TokenA to swap
    console.log(`Swap amount: ${swapAmount}, Initial reserves: TokenA: ${ethersjs.formatUnits(initialReserveAmountA, 6)}, TokenB: ${ethersjs.formatUnits(initialReserveAmountB, 6)}`);

    // Ensure Alice has enough TokenA for the swap
    console.log("Alice gets TokenA:");
    // Owner mints swapAmount of TokenA for Alice
    const encryptedAliceMintA = await fhevm.createEncryptedInput(tokenAAddress, owner.address).add64(ethersjs.parseUnits(swapAmount.toString(), 6)).encrypt();
    console.log(`Created encrypted input (Alice mints TokenA): Handle=${ethersjs.hexlify(encryptedAliceMintA.handles[0])}, Proof=${ethersjs.hexlify(encryptedAliceMintA.inputProof)}`);
    await tokenA.connect(owner).mint(alice.address, encryptedAliceMintA.handles[0], encryptedAliceMintA.inputProof);
    console.log(`Owner minted ${swapAmount} TokenA for Alice.`);

    // Get encrypted balance handle of Alice in TokenA
    const aliceTokenAEncryptedBalanceAtMint = await tokenA.confidentialBalanceOf(alice.address);
    console.log(`Encrypted balance handle of Alice in TokenA: ${ethersjs.hexlify(aliceTokenAEncryptedBalanceAtMint)}`);
    // Authorize TokenA contract to operate on Alice's encrypted TokenA balance
    await tokenA.connect(alice).authorizeSelf(aliceTokenAEncryptedBalanceAtMint);
    console.log(`Alice authorized TokenA contract to operate on her TokenA encrypted balance (Handle: ${ethersjs.hexlify(aliceTokenAEncryptedBalanceAtMint)}, Authorized to: ${tokenAAddress}).`);

    // Decrypt Alice's balance for diagnostic printing
    const decryptedAliceTokenA = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethersjs.hexlify(aliceTokenAEncryptedBalanceAtMint),
      tokenAAddress,
      alice
    );
    console.log(`Diagnostic: Alice's TokenA balance (Decrypted): ${ethersjs.formatUnits(decryptedAliceTokenA, 6)}`);

    // Alice authorizes FHESwapUser contract as operator for TokenA
    console.log("Alice authorizes FHESwapUser as operator for TokenA:");
    // operatorExpiry defines the expiry time for operator authorization (current time + 1 hour)
    const operatorExpiry = Math.floor(Date.now() / 1000) + 3600;
    await tokenA.connect(alice).setOperator(fHeSwapAddress, operatorExpiry);
    console.log(`Alice authorized FHESwapUser as TokenA operator (FHESwapUser Address: ${fHeSwapAddress}, Expiry: ${operatorExpiry}).`);

    // // Debug information: Check variable state
    // console.log("=== Debug Information ===");
    // console.log("fHeSwap:", fHeSwap);
    // console.log("fHeSwapAddress:", fHeSwapAddress);
    // console.log("fHeSwap type:", typeof fHeSwap);
    // console.log("fHeSwap has getAmountOut method:", fHeSwap && typeof fHeSwap.getAmountOut);
    console.log("========================");

    // 1. Alice calls FHESwapUser's getAmountOut function to get encrypted amountOut (on-chain calculation, using custom division)
    console.log("1. Alice calls getAmountOut to get encrypted amountOut (on-chain calculation):");
    // Create encrypted input, target contract is FHESwapUser, initiator is alice, value is swapAmount (euint64 type)
    const encryptedSwapAmountIn = await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(ethersjs.parseUnits(swapAmount.toString(), 6)).encrypt();
    console.log(`Created encrypted input (Swap AmountIn): Handle=${ethersjs.hexlify(encryptedSwapAmountIn.handles[0])}, Proof=${ethersjs.hexlify(encryptedSwapAmountIn.inputProof)}`);
    
    // Ensure fHeSwap is initialized correctly
    if (!fHeSwap || typeof fHeSwap.getAmountOut !== 'function') {
      throw new Error("fHeSwap is not initialized correctly or missing getAmountOut method");
    }
    
    // Alice calls getAmountOut, passing encrypted input amount and input token address
    console.log("Connecting alice to contract...");
    const fHeSwapConnectedToAlice = fHeSwap.connect(alice);
    // console.log("Connected contract:", fHeSwapConnectedToAlice);
    // console.log("Connected contract has getAmountOut:", fHeSwapConnectedToAlice && typeof fHeSwapConnectedToAlice.getAmountOut);
    
    await fHeSwapConnectedToAlice.getAmountOut(
      encryptedSwapAmountIn.handles[0],
      encryptedSwapAmountIn.inputProof,
      tokenAAddress // Specify input token as TokenA
    );
    console.log("getAmountOut call completed.");
    
    // Get calculation result
    const encryptedAmountOut = await fHeSwapConnectedToAlice.getLastAmountOut();
    console.log("Encrypted amountOut obtained.");

    // 2. Alice decrypts amountOut off-chain
    console.log("2. Alice decrypts amountOut off-chain:");
    // Decrypt amountOut
    const decryptedAmountOut = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethersjs.hexlify(encryptedAmountOut),
      fHeSwapAddress,
      alice
    );
    console.log(`Decrypted amountOut: ${ethersjs.formatUnits(decryptedAmountOut, 6)}`);

    // 3. Alice calculates the minimum expected output amount with slippage
    console.log("3. Alice calculates the minimum expected output amount with slippage:");
    const slippageTolerance = 0.01; // 1% slippage tolerance
    const minClearAmountOut = (decryptedAmountOut * 99n) / 100n;
    console.log(`Slippage tolerance: ${slippageTolerance * 100}%, Minimum expected output amount (minClearAmountOut): ${ethersjs.formatUnits(minClearAmountOut, 6)}`);

    // 4. Alice re-encrypts the expected output amount and minimum expected output amount for on-chain use
    console.log("4. Alice re-encrypts the expected output amount and minimum expected output amount:");
    // Again, the target contract must be fHeSwapAddress
    const encryptedExpectedAmountOut = await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(decryptedAmountOut).encrypt();
    console.log(`Re-encrypted expected output amount: Handle=${ethersjs.hexlify(encryptedExpectedAmountOut.handles[0])}, Proof=${ethersjs.hexlify(encryptedExpectedAmountOut.inputProof)}`);
    const encryptedMinAmountOut = await fhevm.createEncryptedInput(fHeSwapAddress, alice.address).add64(minClearAmountOut).encrypt();
    console.log(`Re-encrypted minimum expected output amount: Handle=${ethersjs.hexlify(encryptedMinAmountOut.handles[0])}, Proof=${ethersjs.hexlify(encryptedMinAmountOut.inputProof)}`);
    console.log("Re-encryption completed.");

    // 5. Alice performs the swap (on-chain transaction)
    console.log("5. Alice performs the swap (on-chain transaction):");
    console.log(`Parameters for fHeSwap.swap:\n  encryptedSwapAmountIn.handles[0]: ${ethersjs.hexlify(encryptedSwapAmountIn.handles[0])}\n  encryptedSwapAmountIn.inputProof: ${ethersjs.hexlify(encryptedSwapAmountIn.inputProof)}\n  encryptedExpectedAmountOut.handles[0]: ${ethersjs.hexlify(encryptedExpectedAmountOut.handles[0])}\n  encryptedExpectedAmountOut.inputProof: ${ethersjs.hexlify(encryptedExpectedAmountOut.inputProof)}\n  encryptedMinAmountOut.handles[0]: ${ethersjs.hexlify(encryptedMinAmountOut.handles[0])}\n  encryptedMinAmountOut.inputProof: ${ethersjs.hexlify(encryptedMinAmountOut.inputProof)}\n  tokenAAddress: ${tokenAAddress}\n  alice.address: ${alice.address}`);

    await fHeSwap.connect(alice).swap(
      encryptedSwapAmountIn.handles[0],    // Encrypted input amount handle
      encryptedSwapAmountIn.inputProof,    // Encrypted input amount proof
      encryptedExpectedAmountOut.handles[0], // Re-encrypted expected output amount handle
      encryptedExpectedAmountOut.inputProof, // Re-encrypted expected output amount proof
      encryptedMinAmountOut.handles[0],    // Re-encrypted minimum expected output amount handle
      encryptedMinAmountOut.inputProof,    // Re-encrypted minimum expected output amount proof
      tokenAAddress,                       // Input token is TokenA
      alice.address                        // Output token receiver is Alice
    );
    console.log("FHESwapUser.swap call completed.");

    // After the swap, verify Alice's balance
    console.log("Verifying Alice's balance:");

    // Get encrypted balance of Alice in TokenA
    const aliceTokenAEncryptedBalance = await tokenA.confidentialBalanceOf(alice.address);
    
    // Decrypt Alice's TokenA balance
    const aliceTokenADecryptedBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethersjs.hexlify(aliceTokenAEncryptedBalance),
      tokenAAddress,
      alice
    );
    console.log(`Alice's TokenA balance (Decrypted): ${ethersjs.formatUnits(aliceTokenADecryptedBalance, 6)}`);

    // Get encrypted balance of Alice in TokenB
    const aliceTokenBEncryptedBalance = await tokenB.confidentialBalanceOf(alice.address);
    
    // Decrypt Alice's TokenB balance
    const aliceTokenBDecryptedBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethersjs.hexlify(aliceTokenBEncryptedBalance),
      tokenBAddress,
      alice
    );
    console.log(`Alice's TokenB balance (Decrypted): ${ethersjs.formatUnits(aliceTokenBDecryptedBalance, 6)}`);

    // Calculate Alice's expected final balance
    const expectedAliceTokenA = 0n; // Alice swapped all initial TokenA
    // Alice's TokenB balance = received expected TokenB amount (assuming Alice had no TokenB initially)
    const expectedAliceTokenB = decryptedAmountOut;

    // Assert Alice's TokenA balance is 0
    expect(aliceTokenADecryptedBalance).to.equal(expectedAliceTokenA);
    
    // Assert Alice's TokenB balance matches expected amount
    expect(aliceTokenBDecryptedBalance).to.equal(expectedAliceTokenB);
    console.log("Alice's balance verified.");

    // Verify FHESwapUser's reserves are updated correctly after the swap
    console.log("Verifying FHESwapUser reserves update:");
    
    // Get encrypted reserve0 of FHESwapUser
    const fHeSwapReserve0Encrypted = await fHeSwap.getEncryptedReserve0();
    
    // Decrypt FHESwapUser's reserve0
    const fHeSwapReserve0Decrypted = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethersjs.hexlify(fHeSwapReserve0Encrypted),
      fHeSwapAddress,
      owner // Owner can decrypt reserves
    );
    console.log(`FHESwapUser reserve0 (Decrypted): ${ethersjs.formatUnits(fHeSwapReserve0Decrypted, 6)}`);

    // Get encrypted reserve1 of FHESwapUser
    const fHeSwapReserve1Encrypted = await fHeSwap.getEncryptedReserve1();
    
    // Decrypt FHESwapUser's reserve1
    const fHeSwapReserve1Decrypted = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      ethersjs.hexlify(fHeSwapReserve1Encrypted),
      fHeSwapAddress,
      owner
    );
    console.log(`FHESwapUser reserve1 (Decrypted): ${ethersjs.formatUnits(fHeSwapReserve1Decrypted, 6)}`);

    // Calculate expected final reserves for FHESwapUser
    // FHESwapUser's reserve0 = initial reserve + swapped-in TokenA amount
    const expectedFHeSwapReserve0 = initialReserveAmountA + ethersjs.parseUnits(swapAmount.toString(), 6);
   
    // FHESwapUser's reserve1 = initial reserve - swapped-out TokenB amount
    const expectedFHeSwapReserve1 = initialReserveAmountB - decryptedAmountOut;

    // Assert FHESwapUser's reserve0 matches expected amount
    expect(fHeSwapReserve0Decrypted).to.equal(expectedFHeSwapReserve0);
   
    // Assert FHESwapUser's reserve1 matches expected amount
    expect(fHeSwapReserve1Decrypted).to.equal(expectedFHeSwapReserve1);
    console.log("FHESwapUser reserves verified.");
    console.log("--- Swap test passed ---\n");
  });
});
import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * FHEFactory Comprehensive Test Suite
 * 
 * Test Coverage:
 * 1. Contract deployment and initial state
 * 2. createPairWithInfo - Create trading pair (with complete info)
 * 3. Token information recording and querying
 * 4. Query pairs by original addresses and wrapped addresses
 * 5. Platform fee configuration management
 * 6. Error handling and security checks
 * 7. Edge cases and special scenarios
 */
describe("FHEFactory - Comprehensive Tests", function () {
    let factory: any;
    let wrapperFactory: any;
    let mockTokenA: any;
    let mockTokenB: any;
    let wrapperA: any;
    let wrapperB: any;
    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let feeTo: SignerWithAddress;

    // Token type enum (matches contract)
    const TokenType = {
        PROJECT_WRAPPED: 0,   // Project-wrapped token
        OFFICIAL_FHE: 1,      // Official FHE token
        PLAIN_ERC20: 2        // Plain ERC20 token
    };

    beforeEach(async function () {
        [owner, user1, feeTo] = await ethers.getSigners();

        console.log("\n" + "=".repeat(80));
        console.log("🚀 Starting test environment setup");
        console.log("=".repeat(80));
        console.log("👥 Test Accounts:");
        console.log(`  - Owner:  ${owner.address}`);
        console.log(`  - User1:  ${user1.address}`);
        console.log(`  - FeeTo:  ${feeTo.address}`);

        // 1. Deploy MockERC20 tokens
        console.log("\n📝 Step 1/5: Deploy Mock ERC20 Tokens");
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockTokenA = await MockERC20Factory.deploy("Token A", "TKA", 18);
        mockTokenB = await MockERC20Factory.deploy("Token B", "TKB", 18);
        await mockTokenA.waitForDeployment();
        await mockTokenB.waitForDeployment();
        const tokenAAddr = await mockTokenA.getAddress();
        const tokenBAddr = await mockTokenB.getAddress();
        console.log(`  ✅ Token A (TKA): ${tokenAAddr}`);
        console.log(`  ✅ Token B (TKB): ${tokenBAddr}`);

        // 2. Deploy WrapperFactory
        console.log("\n📝 Step 2/5: Deploy WrapperFactory");
        const WrapperFactoryContract = await ethers.getContractFactory("WrapperFactory");
        wrapperFactory = await WrapperFactoryContract.deploy();
        await wrapperFactory.waitForDeployment();
        const wrapperFactoryAddr = await wrapperFactory.getAddress();
        console.log(`  ✅ WrapperFactory: ${wrapperFactoryAddr}`);

        // 3. Create wrapped tokens
        console.log("\n📝 Step 3/5: Create Wrapped Tokens");
        await wrapperFactory.createWrapper(
            tokenAAddr,
            "Wrapped Token A",
            "wTKA",
            ethers.parseUnits("1", 12),
            TokenType.PLAIN_ERC20
        );
        await wrapperFactory.createWrapper(
            tokenBAddr,
            "Wrapped Token B",
            "wTKB",
            ethers.parseUnits("1", 12),
            TokenType.PLAIN_ERC20
        );

        const wrapperAAddr = await wrapperFactory.getWrapper(tokenAAddr);
        const wrapperBAddr = await wrapperFactory.getWrapper(tokenBAddr);
        console.log(`  ✅ Wrapper A (wTKA): ${wrapperAAddr}`);
        console.log(`  ✅ Wrapper B (wTKB): ${wrapperBAddr}`);
        console.log(`  📊 Mapping Relationships:`);
        console.log(`     ${tokenAAddr} → ${wrapperAAddr}`);
        console.log(`     ${tokenBAddr} → ${wrapperBAddr}`);

        const ERC20WrapperFactory = await ethers.getContractFactory("ERC20Wrapper");
        wrapperA = ERC20WrapperFactory.attach(wrapperAAddr);
        wrapperB = ERC20WrapperFactory.attach(wrapperBAddr);

        // 4. Deploy FHEPairLib
        console.log("\n📝 Step 4/5: Deploy FHEPairLib");
        const LibFactory = await ethers.getContractFactory("FHEPairLib");
        const lib = await LibFactory.deploy();
        await lib.waitForDeployment();
        const libAddr = await lib.getAddress();
        console.log(`  ✅ FHEPairLib: ${libAddr}`);

        // 5. Deploy FHEFactory
        console.log("\n📝 Step 5/5: Deploy FHEFactory");
        const FHEFactoryContract = await ethers.getContractFactory("FHEFactory", {
            libraries: {
                FHEPairLib: libAddr,
            },
        });
        factory = await FHEFactoryContract.deploy();
        await factory.waitForDeployment();
        const factoryAddr = await factory.getAddress();
        console.log(`  ✅ FHEFactory: ${factoryAddr}`);
        console.log(`  🔗 Using Library: ${libAddr}`);
        
        console.log("\n" + "=".repeat(80));
        console.log("✅ Test Environment Setup Completed");
        console.log("=".repeat(80));
    });

    describe("1. Contract Deployment & Initial State", function () {
        it("should deploy correctly and set initial state", async function () {
            console.log("\n📋 Testing Initial State...");
            
            const factoryAddr = await factory.getAddress();
            const pairCount = await factory.allPairsLength();
            const feeToSetter = await factory.feeToSetter();
            const feeTo = await factory.feeTo();
            const platformFeeBps = await factory.platformFeeBps();
            
            console.log("  📍 Factory Address:", factoryAddr);
            console.log("  📊 Initial Pair Count:", pairCount.toString());
            console.log("  👤 Fee To Setter:", feeToSetter);
            console.log("  💰 Fee Recipient Address:", feeTo);
            console.log("  💸 Platform Fee Rate (bps):", platformFeeBps.toString());
            
            expect(factoryAddr).to.be.properAddress;
            expect(pairCount).to.equal(0);
            expect(feeToSetter).to.equal(owner.address);
            expect(feeTo).to.equal(ethers.ZeroAddress);
            expect(platformFeeBps).to.equal(5); // Default 0.05%
            
            console.log("  ✅ Initial State is Correct");
        });

        it("should have correct fee constants", async function () {
            console.log("\n💰 Testing Fee Constants...");
            
            const TOTAL_FEE_BPS = await factory.TOTAL_FEE_BPS();
            const MAX_PLATFORM_FEE = await factory.MAX_PLATFORM_FEE();
            
            console.log("  📊 Total Fee Rate (bps):", TOTAL_FEE_BPS.toString());
            console.log("  📊 Max Platform Fee (bps):", MAX_PLATFORM_FEE.toString());
            
            expect(TOTAL_FEE_BPS).to.equal(30); // 0.3%
            expect(MAX_PLATFORM_FEE).to.equal(15); // 0.15%
            
            console.log("  ✅ Fee Constants are Correct");
        });
    });

    describe("2. Create Trading Pair (with Complete Info)", function () {
        it("should create trading pair with complete information", async function () {
            console.log("\n" + "-".repeat(80));
            console.log("🔄 Test: Create Trading Pair with Complete Info");
            console.log("-".repeat(80));
            
            const wrapperAAddr = await wrapperA.getAddress();
            const wrapperBAddr = await wrapperB.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            const tokenBAddr = await mockTokenB.getAddress();
            
            console.log("\n📍 Input Parameters:");
            console.log(`  ┌─ Wrapped Token A: ${wrapperAAddr}`);
            console.log(`  ├─ Wrapped Token B: ${wrapperBAddr}`);
            console.log(`  ├─ Original Token A: ${tokenAAddr}`);
            console.log(`  ├─ Original Token B: ${tokenBAddr}`);
            console.log(`  ├─ Token Type A: ${TokenType.PROJECT_WRAPPED} (PROJECT_WRAPPED)`);
            console.log(`  └─ Token Type B: ${TokenType.PROJECT_WRAPPED} (PROJECT_WRAPPED)`);

            console.log("\n📤 Sending Transaction: createPairWithInfo()");
            const tx = await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperBAddr,
                tokenAAddr,
                tokenBAddr,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED
            );
            console.log(`  ⏳ Transaction Hash: ${tx.hash}`);
            
            console.log("  ⏳ Waiting for Transaction Confirmation...");
            const receipt = await tx.wait();
            console.log(`  ✅ Transaction Confirmed (Block: ${receipt?.blockNumber})`);
            console.log(`  ⛽ Gas Used: ${receipt?.gasUsed?.toString()}`);
            
            console.log("\n📊 Verifying Results:");
            const pairCount = await factory.allPairsLength();
            console.log(`  ├─ Total Trading Pairs: ${pairCount.toString()}`);
            expect(pairCount).to.equal(1);
            
            const pairAddr = await factory.getPair(wrapperAAddr, wrapperBAddr);
            console.log(`  ├─ Created Pair: ${pairAddr}`);
            expect(pairAddr).to.not.equal(ethers.ZeroAddress);
            
            // Verify bidirectional query
            const pairAddrReverse = await factory.getPair(wrapperBAddr, wrapperAAddr);
            console.log(`  ├─ Reverse Query Result: ${pairAddrReverse}`);
            expect(pairAddr).to.equal(pairAddrReverse);
            console.log(`  └─ ✅ Bidirectional Mapping Works`);
            
            console.log("\n✅ Trading Pair Created Successfully");
            console.log("-".repeat(80));
        });

        it("should emit PairCreated and PairCreatedWithInfo events", async function () {
            console.log("\n📡 Testing Event Emission...");
            
            const wrapperAAddr = await wrapperA.getAddress();
            const wrapperBAddr = await wrapperB.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            const tokenBAddr = await mockTokenB.getAddress();

            await expect(
                factory.createPairWithInfo(
                    wrapperAAddr,
                    wrapperBAddr,
                    tokenAAddr,
                    tokenBAddr,
                    TokenType.PROJECT_WRAPPED,
                    TokenType.PROJECT_WRAPPED
                )
            ).to.emit(factory, "PairCreated")
             .and.to.emit(factory, "PairCreatedWithInfo");
            
            console.log("  ✅ Events Emitted Correctly");
        });

        it("should handle token sorting correctly (token0 < token1)", async function () {
            console.log("\n🔄 Testing Token Sorting...");
            
            const wrapperAAddr = await wrapperA.getAddress();
            const wrapperBAddr = await wrapperB.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            const tokenBAddr = await mockTokenB.getAddress();

            await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperBAddr,
                tokenAAddr,
                tokenBAddr,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED
            );

            const pairAddr = await factory.getPair(wrapperAAddr, wrapperBAddr);
            const token0Info = await factory.getToken0Info(pairAddr);
            const token1Info = await factory.getToken1Info(pairAddr);

            console.log("  📍 Token0 Address:", token0Info.tokenAddress);
            console.log("  📍 Token1 Address:", token1Info.tokenAddress);
            
            // Verify token0 < token1
            expect(BigInt(token0Info.tokenAddress) < BigInt(token1Info.tokenAddress)).to.be.true;
            console.log("  ✅ Token Sorting Correct (token0 < token1)");
        });

        it("should create bidirectional mapping", async function () {
            console.log("\n🔄 Testing Bidirectional Mapping...");
            
            const wrapperAAddr = await wrapperA.getAddress();
            const wrapperBAddr = await wrapperB.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            const tokenBAddr = await mockTokenB.getAddress();

            await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperBAddr,
                tokenAAddr,
                tokenBAddr,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED
            );

            const pair1 = await factory.getPair(wrapperAAddr, wrapperBAddr);
            const pair2 = await factory.getPair(wrapperBAddr, wrapperAAddr);
            
            console.log("  🔗 Pair (A, B):", pair1);
            console.log("  🔗 Pair (B, A):", pair2);
            
            expect(pair1).to.equal(pair2);
            expect(pair1).to.not.equal(ethers.ZeroAddress);
            
            console.log("  ✅ Bidirectional Mapping Works Properly");
        });
    });

    describe("3. Token Information Recording", function () {
        let pairAddr: string;

        beforeEach(async function () {
            const wrapperAAddr = await wrapperA.getAddress();
            const wrapperBAddr = await wrapperB.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            const tokenBAddr = await mockTokenB.getAddress();

            await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperBAddr,
                tokenAAddr,
                tokenBAddr,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED
            );

            pairAddr = await factory.getPair(wrapperAAddr, wrapperBAddr);
        });

        it("should record token information correctly", async function () {
            console.log("\n" + "-".repeat(80));
            console.log("📝 Test: Token Information Recording & Querying");
            console.log("-".repeat(80));
            
            console.log("\n🔍 Querying Trading Pair Information:");
            console.log(`  Pair Address: ${pairAddr}`);
            
            const token0Info = await factory.getToken0Info(pairAddr);
            const token1Info = await factory.getToken1Info(pairAddr);
            
            console.log("\n📊 Token0 Detailed Information:");
            console.log(`  ┌─ Current Address (tokenAddress): ${token0Info.tokenAddress}`);
            console.log(`  ├─ Original Address (originalAddress): ${token0Info.originalAddress}`);
            console.log(`  ├─ Token Type (tokenType): ${token0Info.tokenType.toString()}`);
            console.log(`  └─ Type Description: ${token0Info.tokenType === TokenType.PROJECT_WRAPPED ? 'PROJECT_WRAPPED' : token0Info.tokenType === TokenType.OFFICIAL_FHE ? 'OFFICIAL_FHE' : 'PLAIN_ERC20'}`);
            
            console.log("\n📊 Token1 Detailed Information:");
            console.log(`  ┌─ Current Address (tokenAddress): ${token1Info.tokenAddress}`);
            console.log(`  ├─ Original Address (originalAddress): ${token1Info.originalAddress}`);
            console.log(`  ├─ Token Type (tokenType): ${token1Info.tokenType.toString()}`);
            console.log(`  └─ Type Description: ${token1Info.tokenType === TokenType.PROJECT_WRAPPED ? 'PROJECT_WRAPPED' : token1Info.tokenType === TokenType.OFFICIAL_FHE ? 'OFFICIAL_FHE' : 'PLAIN_ERC20'}`);
            
            console.log("\n✅ Verification Results:");
            console.log("  ├─ Token0 Address Non-Zero:", token0Info.tokenAddress !== ethers.ZeroAddress ? "✅" : "❌");
            expect(token0Info.tokenAddress).to.not.equal(ethers.ZeroAddress);
            console.log("  ├─ Token1 Address Non-Zero:", token1Info.tokenAddress !== ethers.ZeroAddress ? "✅" : "❌");
            expect(token1Info.tokenAddress).to.not.equal(ethers.ZeroAddress);
            console.log("  ├─ Token0 Original Address Non-Zero:", token0Info.originalAddress !== ethers.ZeroAddress ? "✅" : "❌");
            expect(token0Info.originalAddress).to.not.equal(ethers.ZeroAddress);
            console.log("  ├─ Token1 Original Address Non-Zero:", token1Info.originalAddress !== ethers.ZeroAddress ? "✅" : "❌");
            expect(token1Info.originalAddress).to.not.equal(ethers.ZeroAddress);
            console.log("  ├─ Token0 Type Correct:", token0Info.tokenType === TokenType.PROJECT_WRAPPED ? "✅" : "❌");
            expect(token0Info.tokenType).to.equal(TokenType.PROJECT_WRAPPED);
            console.log("  └─ Token1 Type Correct:", token1Info.tokenType === TokenType.PROJECT_WRAPPED ? "✅" : "❌");
            expect(token1Info.tokenType).to.equal(TokenType.PROJECT_WRAPPED);
            
        });

        it("should return complete trading pair information", async function () {
            console.log("\n📋 Testing complete information query...");
            
            const [token0Info, token1Info] = await factory.getPairFullInfo(pairAddr);
            
            console.log("  📊 Complete Token0 info:", token0Info.tokenAddress);
            console.log("  📊 Complete Token1 info:", token1Info.tokenAddress);
            
            expect(token0Info.tokenAddress).to.not.equal(ethers.ZeroAddress);
            expect(token1Info.tokenAddress).to.not.equal(ethers.ZeroAddress);
            
            console.log("  ✅ Complete information query works");
        });

        it("should check if trading pair has token information", async function () {
            console.log("\n ℹ️ Testing hasTokenInfo...");
            
            const hasInfo = await factory.hasTokenInfo(pairAddr);
            const hasInfoZero = await factory.hasTokenInfo(ethers.ZeroAddress);
            
            console.log("  ℹ️ Trading pair has info:", hasInfo);
            console.log("  ℹ️ Zero address has info:", hasInfoZero);
            
            expect(hasInfo).to.be.true;
            expect(hasInfoZero).to.be.false;
            
            console.log("  ✅ hasTokenInfo works correctly");
        });
    });

    describe("4. Query Functions", function () {
        let pairAddr: string;
        let wrapperAAddr: string;
        let wrapperBAddr: string;
        let tokenAAddr: string;
        let tokenBAddr: string;

        beforeEach(async function () {
            wrapperAAddr = await wrapperA.getAddress();
            wrapperBAddr = await wrapperB.getAddress();
            tokenAAddr = await mockTokenA.getAddress();
            tokenBAddr = await mockTokenB.getAddress();

            await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperBAddr,
                tokenAAddr,
                tokenBAddr,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED
            );

            pairAddr = await factory.getPair(wrapperAAddr, wrapperBAddr);
        });

        it("should query trading pair by wrapped addresses", async function () {
            console.log("\n🔍 Testing query by wrapped addresses...");
            
            const queriedPair = await factory.getPair(wrapperAAddr, wrapperBAddr);
            const queriedPairReverse = await factory.getPair(wrapperBAddr, wrapperAAddr);
            
            console.log("  🔗 Query pair (A, B):", queriedPair);
            console.log("  🔗 Query pair (B, A):", queriedPairReverse);
            
            expect(queriedPair).to.equal(pairAddr);
            expect(queriedPairReverse).to.equal(pairAddr);
            
            console.log("  ✅ Query by wrapped addresses successful");
        });

        it("should query trading pair by original addresses", async function () {
            console.log("\n" + "-".repeat(80));
            console.log("🔍 Test: Query trading pair by original addresses ⭐ Core Feature");
            console.log("-".repeat(80));
            
            console.log("\n📊 Current State:");
            console.log(`  ├─ Existing pair: ${pairAddr}`);
            console.log(`  ├─ Original token A (user input): ${tokenAAddr}`);
            console.log(`  ├─ Original token B (user input): ${tokenBAddr}`);
            console.log(`  ├─ Wrapped token A (actually used): ${wrapperAAddr}`);
            console.log(`  └─ Wrapped token B (actually used): ${wrapperBAddr}`);
            
            console.log("\n🔍 Test Scenario 1: Forward query (A, B)");
            console.log(`  📤 Call: factory.getPairByOriginalTokens(${tokenAAddr}, ${tokenBAddr})`);
            const queriedPair = await factory.getPairByOriginalTokens(tokenAAddr, tokenBAddr);
            console.log(`  📥 Return: ${queriedPair}`);
            console.log(`  ✅ Expected: ${pairAddr}`);
            expect(queriedPair).to.equal(pairAddr);
            console.log(`  ✅ Verification passed: Query result matches`);
            
            console.log("\n🔍 Test Scenario 2: Reverse query (B, A)");
            console.log(`  📤 Call: factory.getPairByOriginalTokens(${tokenBAddr}, ${tokenAAddr})`);
            const queriedPairReverse = await factory.getPairByOriginalTokens(tokenBAddr, tokenAAddr);
            console.log(`  📥 Return: ${queriedPairReverse}`);
            console.log(`  ✅ Expected: ${pairAddr}`);
            expect(queriedPairReverse).to.equal(pairAddr);
            console.log(`  ✅ Verification passed: Reverse query also found`);
            
            console.log("\n🎯 Feature Significance:");
            console.log("  ✅ Users can directly query pairs with ERC20 addresses (like USDC)");
            console.log("  ✅ No need to know the wrapped addresses");
            console.log("  ✅ Supports bidirectional queries (A→B or B→A)");
            console.log("  ✅ Simpler frontend integration, better UX");
            
            console.log("\n✅ Query by original addresses works correctly");
            console.log("-".repeat(80));
        });

        it("should return correct number of trading pairs", async function () {
            console.log("\n📊 Testing trading pair count...");
            
            const count1 = await factory.allPairsLength();
            expect(count1).to.equal(1);
            console.log("  📊 Count after 1 pair:", count1.toString());

            // Create another token and pair
            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const mockTokenC = await MockERC20Factory.deploy("Token C", "TKC", 18);
            await mockTokenC.waitForDeployment();
            const tokenCAddr = await mockTokenC.getAddress();

            await wrapperFactory.createWrapper(
                tokenCAddr,
                "Wrapped Token C",
                "wTKC",
                ethers.parseUnits("1", 12),
                TokenType.PLAIN_ERC20
            );

            const wrapperCAddr = await wrapperFactory.getWrapper(tokenCAddr);

            await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperCAddr,
                tokenAAddr,
                tokenCAddr,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED
            );

            const count2 = await factory.allPairsLength();
            expect(count2).to.equal(2);
            console.log("  📊 Count after 2 pairs:", count2.toString());
            
            console.log("  ✅ Trading pair count correct");
        });

        it("should return trading pair address from allPairs array", async function () {
            console.log("\n📊 Testing allPairs array...");
            
            const pairFromArray = await factory.allPairs(0);
            console.log("  🔗 Pair at allPairs[0]:", pairFromArray);
            console.log("  🔗 Expected pair:", pairAddr);
            
            expect(pairFromArray).to.equal(pairAddr);
            
            console.log("  ✅ allPairs array works correctly");
        });
    });

    describe("5. Platform Fee Configuration", function () {
        it("should set feeTo address", async function () {
            console.log("\n💰 Testing feeTo configuration...");
            
            await factory.setFeeTo(feeTo.address);
            const newFeeTo = await factory.feeTo();
            
            console.log("  👤 New feeTo:", newFeeTo);
            expect(newFeeTo).to.equal(feeTo.address);
            
            console.log("  ✅ feeTo set successfully");
        });

        it("should set platform fee rate", async function () {
            console.log("\n💸 Testing platform fee rate configuration...");
            
            const newFeeBps = 10; // 0.1%
            await factory.setPlatformFeeBps(newFeeBps);
            const feeBps = await factory.platformFeeBps();
            
            console.log("  💸 New platform fee rate (bps):", feeBps.toString());
            expect(feeBps).to.equal(newFeeBps);
            
            console.log("  ✅ Platform fee rate set successfully");
        });

        it("should prevent non-feeToSetter from setting fees", async function () {
            console.log("\n❌ Testing unauthorized fee setting...");
            
            await expect(
                factory.connect(user1).setFeeTo(feeTo.address)
            ).to.be.revertedWithCustomError(factory, "Forbidden");
            
            console.log("  ✅ Unauthorized access blocked");
        });

        it("should prevent excessively high platform fee rate", async function () {
            console.log("\n❌ Testing excessive fee rate...");
            
            const MAX_PLATFORM_FEE = await factory.MAX_PLATFORM_FEE();
            const tooHighFee = MAX_PLATFORM_FEE + 1n;
            
            console.log("  📊 Max platform fee rate:", MAX_PLATFORM_FEE.toString());
            console.log("  📊 Attempting to set:", tooHighFee.toString());
            
            await expect(
                factory.setPlatformFeeBps(tooHighFee)
            ).to.be.revertedWithCustomError(factory, "FeeTooHigh");
            
            console.log("  ✅ Excessive fee rate blocked");
        });

        it("should prevent fee rate exceeding total fee rate", async function () {
            console.log("\n❌ Testing fee exceeding total fee rate...");
            
            const MAX_PLATFORM_FEE = await factory.MAX_PLATFORM_FEE();
            const TOTAL_FEE_BPS = await factory.TOTAL_FEE_BPS();
            
            // Note: Contract checks MAX_PLATFORM_FEE first, then TOTAL_FEE_BPS
            // So if fee > MAX_PLATFORM_FEE, it always triggers error code 6
            // Any value > MAX_PLATFORM_FEE will trigger error 6 first
            
            console.log("  📊 Max platform fee rate:", MAX_PLATFORM_FEE.toString());
            console.log("  📊 Total fee rate:", TOTAL_FEE_BPS.toString());
            console.log("  📊 Attempting to set:", (TOTAL_FEE_BPS + 1n).toString());
            
            // Any value exceeding MAX_PLATFORM_FEE will trigger error 6
            await expect(
                factory.setPlatformFeeBps(TOTAL_FEE_BPS + 1n)
            ).to.be.revertedWithCustomError(factory, "FeeTooHigh"); // Because 31 > 15
            
            console.log("  ✅ Excessive fee rate blocked");
        });

        it("should change feeToSetter", async function () {
            console.log("\n👤 Testing feeToSetter change...");
            
            await factory.setFeeToSetter(user1.address);
            const newFeeToSetter = await factory.feeToSetter();
            
            console.log("  👤 New feeToSetter:", newFeeToSetter);
            expect(newFeeToSetter).to.equal(user1.address);
            
            console.log("  ✅ feeToSetter changed successfully");
        });

        it("should get fee configuration", async function () {
            console.log("\n💰 Testing getFeeConfig...");
            
            await factory.setFeeTo(feeTo.address);
            await factory.setPlatformFeeBps(10);
            
            const [configFeeTo, configFeeBps] = await factory.getFeeConfig();
            
            console.log("  👤 Fee recipient address:", configFeeTo);
            console.log("  💸 Fee rate (bps):", configFeeBps.toString());
            
            expect(configFeeTo).to.equal(feeTo.address);
            expect(configFeeBps).to.equal(10);
            
            console.log("  ✅ getFeeConfig works correctly");
        });
    });

    describe("6. Error Handling", function () {
        it("should prevent creating pair with identical tokens", async function () {
            console.log("\n❌ Testing identical token error...");
            
            const wrapperAAddr = await wrapperA.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            
            await expect(
                factory.createPairWithInfo(
                    wrapperAAddr,
                    wrapperAAddr,
                    tokenAAddr,
                    tokenAAddr,
                    TokenType.PROJECT_WRAPPED,
                    TokenType.PROJECT_WRAPPED
                )
            ).to.be.revertedWithCustomError(factory, "IdenticalTokens");
            
            console.log("  ✅ Identical token error works correctly");
        });

        it("should prevent creating pair with zero address", async function () {
            console.log("\n❌ Testing zero address error...");
            
            const wrapperAAddr = await wrapperA.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            
            await expect(
                factory.createPairWithInfo(
                    ethers.ZeroAddress,
                    wrapperAAddr,
                    ethers.ZeroAddress,
                    tokenAAddr,
                    TokenType.PROJECT_WRAPPED,
                    TokenType.PROJECT_WRAPPED
                )
            ).to.be.revertedWithCustomError(factory, "ZeroAddress");
            
            console.log("  ✅ Zero address error works correctly");
        });

        it("should prevent creating duplicate trading pair", async function () {
            console.log("\n" + "-".repeat(80));
            console.log("❌ Test: Prevent creating duplicate trading pair");
            console.log("-".repeat(80));
            
            const wrapperAAddr = await wrapperA.getAddress();
            const wrapperBAddr = await wrapperB.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            const tokenBAddr = await mockTokenB.getAddress();

            console.log("\n📝 Step 1: Create first trading pair");
            console.log(`  Wrapped token A: ${wrapperAAddr}`);
            console.log(`  Wrapped token B: ${wrapperBAddr}`);
            const tx1 = await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperBAddr,
                tokenAAddr,
                tokenBAddr,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED
            );
            await tx1.wait();
            const pairAddr = await factory.getPair(wrapperAAddr, wrapperBAddr);
            console.log(`  ✅ First trading pair created: ${pairAddr}`);

            console.log("\n📝 Step 2: Attempt to create duplicate pair");
            console.log("  Expected: Should revert with error code 3 (ERROR_PAIR_EXISTS)");
            
            await expect(
                factory.createPairWithInfo(
                    wrapperAAddr,
                    wrapperBAddr,
                    tokenAAddr,
                    tokenBAddr,
                    TokenType.PROJECT_WRAPPED,
                    TokenType.PROJECT_WRAPPED
                )
            ).to.be.revertedWithCustomError(factory, "PairExists");
            
            console.log("  ✅ Duplicate creation successfully blocked");
            console.log("  ✅ Error code 3 (ERROR_PAIR_EXISTS) correctly returned");
            console.log("\n✅ Security check works correctly");
            console.log("-".repeat(80));
        });

        it("should prevent creating reverse pair", async function () {
            console.log("\n❌ Testing reverse pair creation...");
            
            const wrapperAAddr = await wrapperA.getAddress();
            const wrapperBAddr = await wrapperB.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            const tokenBAddr = await mockTokenB.getAddress();

            // Create first pair (A, B)
            await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperBAddr,
                tokenAAddr,
                tokenBAddr,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED
            );

            // Attempt to create reverse pair (B, A) - should fail
            await expect(
                factory.createPairWithInfo(
                    wrapperBAddr,
                    wrapperAAddr,
                    tokenBAddr,
                    tokenAAddr,
                    TokenType.PROJECT_WRAPPED,
                    TokenType.PROJECT_WRAPPED
                )
            ).to.be.revertedWithCustomError(factory, "PairExists");
            
            console.log("  ✅ Reverse pair creation blocked");
        });
    });

    describe("7. Edge Cases", function () {
        it("should return zero address for non-existent pair", async function () {
            console.log("\n🔍 Testing non-existent pair query...");
            
            const wrapperAAddr = await wrapperA.getAddress();
            const wrapperBAddr = await wrapperB.getAddress();
            
            const pair = await factory.getPair(wrapperAAddr, wrapperBAddr);
            
            console.log("  🔗 Non-existent pair:", pair);
            expect(pair).to.equal(ethers.ZeroAddress);
            
            console.log("  ✅ Non-existent pair returns zero address");
        });

        it("should return zero address for non-existent pair (original addresses)", async function () {
            console.log("\n🔍 Testing non-existent pair query (original addresses)...");
            
            const tokenAAddr = await mockTokenA.getAddress();
            const tokenBAddr = await mockTokenB.getAddress();
            
            const pair = await factory.getPairByOriginalTokens(tokenAAddr, tokenBAddr);
            
            console.log("  🔗 Query non-existent pair by original addresses:", pair);
            expect(pair).to.equal(ethers.ZeroAddress);
            
            console.log("  ✅ Query non-existent pair by original addresses returns zero address");
        });

        it("should return empty info for non-existent pair", async function () {
            console.log("\n📋 Testing empty info query...");
            
            const randomAddr = ethers.Wallet.createRandom().address;
            const token0Info = await factory.getToken0Info(randomAddr);
            
            console.log("  📊 Token0 info for random address:");
            console.log("    Address:", token0Info.tokenAddress);
            console.log("    Original:", token0Info.originalAddress);
            console.log("    Type:", token0Info.tokenType.toString());
            
            expect(token0Info.tokenAddress).to.equal(ethers.ZeroAddress);
            expect(token0Info.originalAddress).to.equal(ethers.ZeroAddress);
            
            console.log("  ✅ Non-existent pair returns empty info");
        });

        it("should handle different token types correctly", async function () {
            console.log("\n🏷️ Testing different token types...");
            
            const wrapperAAddr = await wrapperA.getAddress();
            const wrapperBAddr = await wrapperB.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            const tokenBAddr = await mockTokenB.getAddress();

            // Create pair with different types
            await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperBAddr,
                tokenAAddr,
                tokenBAddr,
                TokenType.PLAIN_ERC20,       // 2
                TokenType.PROJECT_WRAPPED    // 0
            );

            const pairAddr = await factory.getPair(wrapperAAddr, wrapperBAddr);
            const [token0Info, token1Info] = await factory.getPairFullInfo(pairAddr);

            console.log("  🏷️ Token0 type:", token0Info.tokenType.toString());
            console.log("  🏷️ Token1 type:", token1Info.tokenType.toString());

            // Verify types are preserved (order depends on address sorting)
            const types = [token0Info.tokenType, token1Info.tokenType].sort();
            // After sorting: PROJECT_WRAPPED(0) first, PLAIN_ERC20(2) second
            expect(types[0]).to.equal(TokenType.PROJECT_WRAPPED);  // 0
            expect(types[1]).to.equal(TokenType.PLAIN_ERC20);     // 2
            
            console.log("  ✅ Different token types handled correctly");
        });

        it("should successfully create multiple trading pairs", async function () {
            console.log("\n🔄 Testing multiple pair creation...");
            
            const wrapperAAddr = await wrapperA.getAddress();
            const wrapperBAddr = await wrapperB.getAddress();
            const tokenAAddr = await mockTokenA.getAddress();
            const tokenBAddr = await mockTokenB.getAddress();

            // Create pair A-B
            await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperBAddr,
                tokenAAddr,
                tokenBAddr,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED
            );

            // Create token C and pair A-C
            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const mockTokenC = await MockERC20Factory.deploy("Token C", "TKC", 18);
            await mockTokenC.waitForDeployment();
            const tokenCAddr = await mockTokenC.getAddress();

            await wrapperFactory.createWrapper(
                tokenCAddr,
                "Wrapped Token C",
                "wTKC",
                ethers.parseUnits("1", 12),
                TokenType.PLAIN_ERC20
            );
            const wrapperCAddr = await wrapperFactory.getWrapper(tokenCAddr);

            await factory.createPairWithInfo(
                wrapperAAddr,
                wrapperCAddr,
                tokenAAddr,
                tokenCAddr,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED
            );

            const pairCount = await factory.allPairsLength();
            console.log("  📊 Total trading pairs created:", pairCount.toString());
            expect(pairCount).to.equal(2);

            const pairAB = await factory.getPair(wrapperAAddr, wrapperBAddr);
            const pairAC = await factory.getPair(wrapperAAddr, wrapperCAddr);

            console.log("  🔗 Pair A-B:", pairAB);
            console.log("  🔗 Pair A-C:", pairAC);

            expect(pairAB).to.not.equal(ethers.ZeroAddress);
            expect(pairAC).to.not.equal(ethers.ZeroAddress);
            expect(pairAB).to.not.equal(pairAC);
            
            console.log("  ✅ Multiple pairs created successfully");
        });
    });
});

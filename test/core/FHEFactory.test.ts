import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { 
    FHEFactory,
    FHEPair
} from "../../types/contracts/core";
import { 
    WrapperFactory,
    ERC20Wrapper
} from "../../types/contracts/confidential-tokens/extensions";
import { MockERC20 } from "../../types/contracts/test";

describe("FHEFactory", function () {
    let factory: FHEFactory;
    let wrapperFactory: WrapperFactory;
    let mockToken1: MockERC20;
    let mockToken2: MockERC20;
    let wrapper1: ERC20Wrapper;
    let wrapper2: ERC20Wrapper;
    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let priceScanner: SignerWithAddress;

    const TokenType = {
        PROJECT_WRAPPED: 0,
        OFFICIAL_FHE: 1,
        PLAIN_ERC20: 2
    };

    beforeEach(async function () {
        [owner, user1, priceScanner] = await ethers.getSigners();

        // Deploy MockERC20 tokens
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockToken1 = await MockERC20Factory.deploy("Token1", "TK1", 18);
        mockToken2 = await MockERC20Factory.deploy("Token2", "TK2", 18);
        await mockToken1.waitForDeployment();
        await mockToken2.waitForDeployment();

        // Deploy WrapperFactory
        const WrapperFactoryContract = await ethers.getContractFactory("WrapperFactory");
        wrapperFactory = await WrapperFactoryContract.deploy();
        await wrapperFactory.waitForDeployment();

        // Create wrapped tokens
        const createWrapper1Tx = await wrapperFactory.createWrapper(
            await mockToken1.getAddress(),
            "Wrapped Token1",
            "wTK1",
            1,
            2 // TokenType.PLAIN_ERC20
        );
        await createWrapper1Tx.wait();

        const createWrapper2Tx = await wrapperFactory.createWrapper(
            await mockToken2.getAddress(),
            "Wrapped Token2", 
            "wTK2",
            1,
            2 // TokenType.PLAIN_ERC20
        );
        await createWrapper2Tx.wait();

        // Get wrapper addresses
        const wrapper1Address = await wrapperFactory.getWrapper(await mockToken1.getAddress());
        const wrapper2Address = await wrapperFactory.getWrapper(await mockToken2.getAddress());

        wrapper1 = await ethers.getContractAt("ERC20Wrapper", wrapper1Address);
        wrapper2 = await ethers.getContractAt("ERC20Wrapper", wrapper2Address);

        // Deploy FHEPairLib first
        const LibFactory = await ethers.getContractFactory("FHEPairLib");
        const lib = await LibFactory.deploy();
        await lib.waitForDeployment();
        const libAddr = await lib.getAddress();

        // Deploy FHEPair implementation first
        const FHEPairFactory = await ethers.getContractFactory("FHEPair", {
            libraries: {
                FHEPairLib: libAddr,
            },
        });
        const pairImpl = await FHEPairFactory.deploy(priceScanner.address);
        await pairImpl.waitForDeployment();
        const pairImplAddr = await pairImpl.getAddress();

        // Deploy FHEFactory with pair implementation
        const FHEFactoryContract = await ethers.getContractFactory("FHEFactory");
        factory = await FHEFactoryContract.deploy(pairImplAddr);
        await factory.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should deploy successfully", async function () {
            console.log("🚀 Testing Factory deployment...");
            const factoryAddress = await factory.getAddress();
            const pairCount = await factory.allPairsLength();
            
            console.log("📍 Factory Address:", factoryAddress);
            console.log("📊 Initial Pair Count:", pairCount.toString());
            
            expect(factoryAddress).to.be.properAddress;
            expect(pairCount).to.equal(0);
            
            console.log("✅ Factory deployment test passed!");
        });
    });

    describe("Legacy createPair function", function () {
        it("Should create pair with legacy function", async function () {
            console.log("🔄 Testing legacy createPair function...");
            
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            
            console.log("📍 Wrapper1 Address:", wrapper1Address);
            console.log("📍 Wrapper2 Address:", wrapper2Address);
            console.log("📍 Price Scanner Address:", priceScanner.address);

            const createPairTx = await factory.createPair(
                wrapper1Address,
                wrapper2Address,
                priceScanner.address
            );
            const receipt = await createPairTx.wait();

            console.log("📝 Transaction Status:", receipt?.status);
            console.log("⛽ Gas Used:", receipt?.gasUsed?.toString());

            expect(receipt?.status).to.equal(1);
            
            const pairCount = await factory.allPairsLength();
            console.log("📊 Total Pairs After Creation:", pairCount.toString());
            expect(pairCount).to.equal(1);

            // Check pair exists
            const pairAddress = await factory.getPair(wrapper1Address, wrapper2Address);
            console.log("🔗 Created Pair Address:", pairAddress);
            expect(pairAddress).to.not.equal(ethers.ZeroAddress);

            // Check bidirectional mapping
            const pairAddressReverse = await factory.getPair(wrapper2Address, wrapper1Address);
            console.log("🔄 Reverse Pair Address:", pairAddressReverse);
            expect(pairAddress).to.equal(pairAddressReverse);
            
            console.log("✅ Legacy createPair test passed!");
        });

        it("Should revert when creating pair with identical tokens", async function () {
            console.log("❌ Testing identical tokens error...");
            
            const wrapper1Address = await wrapper1.getAddress();
            console.log("📍 Token Address:", wrapper1Address);

            await expect(
                factory.createPair(wrapper1Address, wrapper1Address, priceScanner.address)
            ).to.be.revertedWithCustomError(factory, "FactoryError")
            .withArgs(1); // ERROR_IDENTICAL_TOKENS
            
            console.log("✅ Identical tokens error test passed!");
        });

        it("Should revert when creating pair with zero address", async function () {
            console.log("❌ Testing zero address error...");
            
            const wrapper1Address = await wrapper1.getAddress();
            console.log("📍 Valid Token Address:", wrapper1Address);
            console.log("📍 Zero Address:", ethers.ZeroAddress);

            await expect(
                factory.createPair(ethers.ZeroAddress, wrapper1Address, priceScanner.address)
            ).to.be.revertedWithCustomError(factory, "FactoryError")
            .withArgs(2); // ERROR_ZERO_ADDRESS
            
            console.log("✅ Zero address error test passed!");
        });

        it("Should revert when pair already exists", async function () {
            console.log("❌ Testing pair already exists error...");
            
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            
            console.log("📍 Wrapper1 Address:", wrapper1Address);
            console.log("📍 Wrapper2 Address:", wrapper2Address);

            // Create first pair
            console.log("🔄 Creating first pair...");
            await factory.createPair(wrapper1Address, wrapper2Address, priceScanner.address);
            console.log("✅ First pair created successfully");

            // Try to create same pair again
            console.log("🔄 Attempting to create duplicate pair...");
            await expect(
                factory.createPair(wrapper1Address, wrapper2Address, priceScanner.address)
            ).to.be.revertedWithCustomError(factory, "FactoryError")
            .withArgs(3); // ERROR_PAIR_EXISTS
            
            console.log("✅ Pair already exists error test passed!");
        });
    });

    describe("New createPairWithInfo function", function () {
        it("Should create pair with detailed information", async function () {
            console.log("🆕 Testing createPairWithInfo function...");
            
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            const mockToken1Address = await mockToken1.getAddress();
            const mockToken2Address = await mockToken2.getAddress();
            
            console.log("📍 Wrapper1 Address:", wrapper1Address);
            console.log("📍 Wrapper2 Address:", wrapper2Address);
            console.log("📍 Original Token1 Address:", mockToken1Address);
            console.log("📍 Original Token2 Address:", mockToken2Address);
            console.log("🏷️ Token1 Type:", TokenType.PROJECT_WRAPPED);
            console.log("🏷️ Token2 Type:", TokenType.PROJECT_WRAPPED);

            const createPairTx = await factory.createPairWithInfo(
                wrapper1Address,
                wrapper2Address,
                mockToken1Address,
                mockToken2Address,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED,
                priceScanner.address
            );
            const receipt = await createPairTx.wait();

            console.log("📝 Transaction Status:", receipt?.status);
            console.log("⛽ Gas Used:", receipt?.gasUsed?.toString());

            expect(receipt?.status).to.equal(1);
            
            const pairCount = await factory.allPairsLength();
            console.log("📊 Total Pairs After Creation:", pairCount.toString());
            expect(pairCount).to.equal(1);

            // Check pair exists in both mappings
            const pairAddress = await factory.getPair(wrapper1Address, wrapper2Address);
            console.log("🔗 Created Pair Address:", pairAddress);
            expect(pairAddress).to.not.equal(ethers.ZeroAddress);

            const pairByOriginal = await factory.getPairByOriginalTokens(
                mockToken1Address,
                mockToken2Address
            );
            console.log("🔗 Pair by Original Tokens:", pairByOriginal);
            expect(pairAddress).to.equal(pairByOriginal);
            
            console.log("✅ createPairWithInfo test passed!");
        });

        it("Should record token information correctly", async function () {
            console.log("📝 Testing token information recording...");
            
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            const mockToken1Address = await mockToken1.getAddress();
            const mockToken2Address = await mockToken2.getAddress();
            
            console.log("📍 Wrapper1 Address:", wrapper1Address);
            console.log("📍 Wrapper2 Address:", wrapper2Address);
            console.log("📍 Original Token1 Address:", mockToken1Address);
            console.log("📍 Original Token2 Address:", mockToken2Address);
            console.log("🏷️ Token1 Type:", TokenType.PLAIN_ERC20);
            console.log("🏷️ Token2 Type:", TokenType.PROJECT_WRAPPED);

            await factory.createPairWithInfo(
                wrapper1Address,
                wrapper2Address,
                mockToken1Address,
                mockToken2Address,
                TokenType.PLAIN_ERC20,
                TokenType.PROJECT_WRAPPED,
                priceScanner.address
            );

            const pairAddress = await factory.getPair(wrapper1Address, wrapper2Address);
            console.log("🔗 Created Pair Address:", pairAddress);

            // Determine expected order based on address sorting
            const [expectedToken0, expectedToken1] = BigInt(wrapper1Address) < BigInt(wrapper2Address) 
                ? [wrapper1Address, wrapper2Address]
                : [wrapper2Address, wrapper1Address];
            
            const [expectedOriginal0, expectedOriginal1] = BigInt(wrapper1Address) < BigInt(wrapper2Address)
                ? [mockToken1Address, mockToken2Address]
                : [mockToken2Address, mockToken1Address];
            
            const [expectedType0, expectedType1] = BigInt(wrapper1Address) < BigInt(wrapper2Address)
                ? [TokenType.PLAIN_ERC20, TokenType.PROJECT_WRAPPED]
                : [TokenType.PROJECT_WRAPPED, TokenType.PLAIN_ERC20];

            console.log("🔄 Address Sorting Results:");
            console.log("  Expected Token0:", expectedToken0);
            console.log("  Expected Token1:", expectedToken1);
            console.log("  Expected Original0:", expectedOriginal0);
            console.log("  Expected Original1:", expectedOriginal1);
            console.log("  Expected Type0:", expectedType0);
            console.log("  Expected Type1:", expectedType1);

            // Check token0 info
            const token0Info = await factory.getToken0Info(pairAddress);
            console.log("📊 Token0 Info:");
            console.log("  Address:", token0Info.tokenAddress);
            console.log("  Original:", token0Info.originalAddress);
            console.log("  Type:", token0Info.tokenType.toString());
            
            expect(token0Info.tokenAddress).to.equal(expectedToken0);
            expect(token0Info.originalAddress).to.equal(expectedOriginal0);
            expect(token0Info.tokenType).to.equal(expectedType0);

            // Check token1 info
            const token1Info = await factory.getToken1Info(pairAddress);
            console.log("📊 Token1 Info:");
            console.log("  Address:", token1Info.tokenAddress);
            console.log("  Original:", token1Info.originalAddress);
            console.log("  Type:", token1Info.tokenType.toString());
            
            expect(token1Info.tokenAddress).to.equal(expectedToken1);
            expect(token1Info.originalAddress).to.equal(expectedOriginal1);
            expect(token1Info.tokenType).to.equal(expectedType1);

            // Check full info
            const [fullToken0Info, fullToken1Info] = await factory.getPairFullInfo(pairAddress);
            console.log("📋 Full Pair Info:");
            console.log("  Full Token0 Address:", fullToken0Info.tokenAddress);
            console.log("  Full Token1 Address:", fullToken1Info.tokenAddress);
            
            expect(fullToken0Info.tokenAddress).to.equal(token0Info.tokenAddress);
            expect(fullToken1Info.tokenAddress).to.equal(token1Info.tokenAddress);
            
            console.log("✅ Token information recording test passed!");
        });

        it("Should handle token ordering correctly", async function () {
            console.log("🔄 Testing token ordering logic...");
            
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            const mockToken1Address = await mockToken1.getAddress();
            const mockToken2Address = await mockToken2.getAddress();
            
            console.log("📍 Input Addresses:");
            console.log("  Wrapper1:", wrapper1Address);
            console.log("  Wrapper2:", wrapper2Address);
            console.log("  Original1:", mockToken1Address);
            console.log("  Original2:", mockToken2Address);

            // Determine expected order (token0 < token1)
            const [expectedToken0, expectedToken1] = BigInt(wrapper1Address) < BigInt(wrapper2Address) 
                ? [wrapper1Address, wrapper2Address]
                : [wrapper2Address, wrapper1Address];

            const [expectedOriginal0, expectedOriginal1] = BigInt(wrapper1Address) < BigInt(wrapper2Address)
                ? [mockToken1Address, mockToken2Address]
                : [mockToken2Address, mockToken1Address];

            console.log("🔄 Expected Ordering:");
            console.log("  Token0:", expectedToken0);
            console.log("  Token1:", expectedToken1);
            console.log("  Original0:", expectedOriginal0);
            console.log("  Original1:", expectedOriginal1);

            await factory.createPairWithInfo(
                wrapper1Address,
                wrapper2Address,
                mockToken1Address,
                mockToken2Address,
                TokenType.PLAIN_ERC20,
                TokenType.PROJECT_WRAPPED,
                priceScanner.address
            );

            const pairAddress = await factory.getPair(expectedToken0, expectedToken1);
            console.log("🔗 Pair Address:", pairAddress);
            
            const token0Info = await factory.getToken0Info(pairAddress);
            const token1Info = await factory.getToken1Info(pairAddress);

            console.log("📊 Actual Results:");
            console.log("  Token0 Address:", token0Info.tokenAddress);
            console.log("  Token1 Address:", token1Info.tokenAddress);
            console.log("  Token0 Original:", token0Info.originalAddress);
            console.log("  Token1 Original:", token1Info.originalAddress);

            expect(token0Info.tokenAddress).to.equal(expectedToken0);
            expect(token1Info.tokenAddress).to.equal(expectedToken1);
            expect(token0Info.originalAddress).to.equal(expectedOriginal0);
            expect(token1Info.originalAddress).to.equal(expectedOriginal1);
            
            console.log("✅ Token ordering test passed!");
        });

        it("Should emit events correctly", async function () {
            console.log("📡 Testing event emission...");
            
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            const mockToken1Address = await mockToken1.getAddress();
            const mockToken2Address = await mockToken2.getAddress();
            
            console.log("📍 Event Parameters:");
            console.log("  Wrapper1:", wrapper1Address);
            console.log("  Wrapper2:", wrapper2Address);
            console.log("  Original1:", mockToken1Address);
            console.log("  Original2:", mockToken2Address);

            const [expectedToken0, expectedToken1] = BigInt(wrapper1Address) < BigInt(wrapper2Address) 
                ? [wrapper1Address, wrapper2Address]
                : [wrapper2Address, wrapper1Address];

            const [expectedOriginal0, expectedOriginal1] = BigInt(wrapper1Address) < BigInt(wrapper2Address)
                ? [mockToken1Address, mockToken2Address]
                : [mockToken2Address, mockToken1Address];

            const [expectedType0, expectedType1] = BigInt(wrapper1Address) < BigInt(wrapper2Address)
                ? [TokenType.PLAIN_ERC20, TokenType.PROJECT_WRAPPED]
                : [TokenType.PROJECT_WRAPPED, TokenType.PLAIN_ERC20];

            console.log("📡 Expected Events:");
            console.log("  PairCreated with:", expectedToken0, expectedToken1);
            console.log("  PairCreatedWithInfo with:", expectedToken0, expectedOriginal0, expectedType0, expectedToken1, expectedOriginal1, expectedType1);

            await expect(
                factory.createPairWithInfo(
                    wrapper1Address,
                    wrapper2Address,
                    mockToken1Address,
                    mockToken2Address,
                    TokenType.PLAIN_ERC20,
                    TokenType.PROJECT_WRAPPED,
                    priceScanner.address
                )
            ).to.emit(factory, "PairCreated")
             .and.to.emit(factory, "PairCreatedWithInfo");
             
            console.log("✅ Event emission test passed!");
        });
    });

    describe("Query functions", function () {
        let pairAddress: string;

        beforeEach(async function () {
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            const mockToken1Address = await mockToken1.getAddress();
            const mockToken2Address = await mockToken2.getAddress();

            await factory.createPairWithInfo(
                wrapper1Address,
                wrapper2Address,
                mockToken1Address,
                mockToken2Address,
                TokenType.PLAIN_ERC20,
                TokenType.PROJECT_WRAPPED,
                priceScanner.address
            );

            pairAddress = await factory.getPair(wrapper1Address, wrapper2Address);
        });

        it("Should query pair by original tokens", async function () {
            console.log("🔍 Testing pair query by original tokens...");
            
            const mockToken1Address = await mockToken1.getAddress();
            const mockToken2Address = await mockToken2.getAddress();
            
            console.log("📍 Original Token1:", mockToken1Address);
            console.log("📍 Original Token2:", mockToken2Address);
            console.log("🔗 Expected Pair:", pairAddress);

            const queriedPair = await factory.getPairByOriginalTokens(
                mockToken1Address,
                mockToken2Address
            );
            console.log("🔍 Queried Pair (normal order):", queriedPair);
            expect(queriedPair).to.equal(pairAddress);

            // Test reverse order
            const queriedPairReverse = await factory.getPairByOriginalTokens(
                mockToken2Address,
                mockToken1Address
            );
            console.log("🔍 Queried Pair (reverse order):", queriedPairReverse);
            expect(queriedPairReverse).to.equal(pairAddress);
            
            console.log("✅ Original tokens query test passed!");
        });

        it("Should check if pair has token info", async function () {
            console.log("ℹ️ Testing token info existence check...");
            
            const hasInfo = await factory.hasTokenInfo(pairAddress);
            const hasInfoZero = await factory.hasTokenInfo(ethers.ZeroAddress);
            
            console.log("ℹ️ Pair has token info:", hasInfo);
            console.log("ℹ️ Zero address has token info:", hasInfoZero);
            
            expect(hasInfo).to.be.true;
            expect(hasInfoZero).to.be.false;
            
            console.log("✅ Token info check test passed!");
        });

        it("Should return correct pair count", async function () {
            console.log("📊 Testing pair count functionality...");
            
            const initialCount = await factory.allPairsLength();
            console.log("📊 Initial pair count:", initialCount.toString());
            expect(initialCount).to.equal(1);

            // Create another pair
            console.log("🔄 Creating second pair...");
            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const mockToken3 = await MockERC20Factory.deploy("Token3", "TK3", 18);
            await mockToken3.waitForDeployment();
            
            const mockToken3Address = await mockToken3.getAddress();
            console.log("📍 New Token3 Address:", mockToken3Address);

            await wrapperFactory.createWrapper(
                mockToken3Address,
                "Wrapped Token3",
                "wTK3",
                1,
                2 // TokenType.PLAIN_ERC20
            );

            const wrapper3Address = await wrapperFactory.getWrapper(mockToken3Address);
            const wrapper1Address = await wrapper1.getAddress();
            
            console.log("📍 Wrapper3 Address:", wrapper3Address);
            console.log("📍 Wrapper1 Address:", wrapper1Address);

            await factory.createPairWithInfo(
                wrapper1Address,
                wrapper3Address,
                await mockToken1.getAddress(),
                mockToken3Address,
                TokenType.PROJECT_WRAPPED,
                TokenType.PLAIN_ERC20,
                priceScanner.address
            );

            const finalCount = await factory.allPairsLength();
            console.log("📊 Final pair count:", finalCount.toString());
            expect(finalCount).to.equal(2);
            
            console.log("✅ Pair count test passed!");
        });
    });

    describe("Edge cases", function () {
        it("Should handle non-existent pair queries gracefully", async function () {
            console.log("🔍 Testing non-existent pair queries...");
            
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            
            console.log("📍 Wrapper1 Address:", wrapper1Address);
            console.log("📍 Wrapper2 Address:", wrapper2Address);

            // Query non-existent pair
            const pairAddress = await factory.getPair(wrapper1Address, wrapper2Address);
            console.log("🔍 Non-existent pair result:", pairAddress);
            expect(pairAddress).to.equal(ethers.ZeroAddress);

            // Query by original tokens
            const mockToken1Address = await mockToken1.getAddress();
            const mockToken2Address = await mockToken2.getAddress();
            console.log("📍 Original Token1:", mockToken1Address);
            console.log("📍 Original Token2:", mockToken2Address);
            
            const pairByOriginal = await factory.getPairByOriginalTokens(
                mockToken1Address,
                mockToken2Address
            );
            console.log("🔍 Non-existent pair by original:", pairByOriginal);
            expect(pairByOriginal).to.equal(ethers.ZeroAddress);
            
            console.log("✅ Non-existent pair query test passed!");
        });

        it("Should return empty info for non-existent pairs", async function () {
            console.log("📋 Testing empty info for non-existent pairs...");
            
            const randomAddress = ethers.Wallet.createRandom().address;
            console.log("📍 Random Address:", randomAddress);
            
            const token0Info = await factory.getToken0Info(randomAddress);
            console.log("📋 Token0 Info for non-existent pair:");
            console.log("  Address:", token0Info.tokenAddress);
            console.log("  Original:", token0Info.originalAddress);
            console.log("  Type:", token0Info.tokenType.toString());
            
            expect(token0Info.tokenAddress).to.equal(ethers.ZeroAddress);
            expect(token0Info.originalAddress).to.equal(ethers.ZeroAddress);
            expect(token0Info.tokenType).to.equal(0);

            const hasInfo = await factory.hasTokenInfo(randomAddress);
            console.log("ℹ️ Has token info:", hasInfo);
            expect(hasInfo).to.be.false;
            
            console.log("✅ Empty info test passed!");
        });
    });

    describe("Integration with FHEPair", function () {
        it("Should initialize FHEPair correctly", async function () {
            console.log("🔗 Testing FHEPair integration...");
            
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            const mockToken1Address = await mockToken1.getAddress();
            const mockToken2Address = await mockToken2.getAddress();
            
            console.log("📍 Integration Parameters:");
            console.log("  Wrapper1:", wrapper1Address);
            console.log("  Wrapper2:", wrapper2Address);
            console.log("  Original1:", mockToken1Address);
            console.log("  Original2:", mockToken2Address);

            await factory.createPairWithInfo(
                wrapper1Address,
                wrapper2Address,
                mockToken1Address,
                mockToken2Address,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED,
                priceScanner.address
            );

            const pairAddress = await factory.getPair(wrapper1Address, wrapper2Address);
            console.log("🔗 Created Pair Address:", pairAddress);
            
            const pair = await ethers.getContractAt("FHEPair", pairAddress);

            // Check if pair is properly initialized
            const token0 = await pair.token0Address();
            const token1 = await pair.token1Address();
            
            console.log("🔗 FHEPair Token Addresses:");
            console.log("  Token0:", token0);
            console.log("  Token1:", token1);
            console.log("  Token0 < Token1:", BigInt(token0) < BigInt(token1));

            // Verify that token0 < token1 (address ordering) - compare as BigInt
            expect(BigInt(token0) < BigInt(token1)).to.be.true;
            
            // Verify that both tokens are from our wrappers
            console.log("🔍 Token Validation:");
            console.log("  Token0 in wrappers:", [wrapper1Address, wrapper2Address].includes(token0));
            console.log("  Token1 in wrappers:", [wrapper1Address, wrapper2Address].includes(token1));
            console.log("  Tokens are different:", token0 !== token1);
            
            expect([wrapper1Address, wrapper2Address]).to.include(token0);
            expect([wrapper1Address, wrapper2Address]).to.include(token1);
            expect(token0).to.not.equal(token1);
            
            console.log("✅ FHEPair integration test passed!");
        });
    });

    describe("Wrapped Token Information", function () {
        let pairAddress: string;

        beforeEach(async function () {
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            const mockToken1Address = await mockToken1.getAddress();
            const mockToken2Address = await mockToken2.getAddress();

            await factory.createPairWithInfo(
                wrapper1Address,
                wrapper2Address,
                mockToken1Address,
                mockToken2Address,
                TokenType.PROJECT_WRAPPED,
                TokenType.PROJECT_WRAPPED,
                priceScanner.address
            );

            pairAddress = await factory.getPair(wrapper1Address, wrapper2Address);
        });

        it("Should record wrapped token information globally", async function () {
            console.log("📝 Testing global wrapped token information recording...");
            
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            const mockToken1Address = await mockToken1.getAddress();
            const mockToken2Address = await mockToken2.getAddress();
            
            console.log("📍 Wrapper1 Address:", wrapper1Address);
            console.log("📍 Wrapper2 Address:", wrapper2Address);
            console.log("📍 Original Token1:", mockToken1Address);
            console.log("📍 Original Token2:", mockToken2Address);

            // Check wrapped token info using WrapperFactory
            const [original1, type1] = await wrapperFactory.getWrappedTokenInfo(wrapper1Address);
            const [original2, type2] = await wrapperFactory.getWrappedTokenInfo(wrapper2Address);
            
            console.log("📊 Wrapped Token1 Info:");
            console.log("  Original:", original1);
            console.log("  Type:", type1.toString());
            
            console.log("📊 Wrapped Token2 Info:");
            console.log("  Original:", original2);
            console.log("  Type:", type2.toString());

            expect(original1).to.equal(mockToken1Address);
            expect(original2).to.equal(mockToken2Address);
            expect(type1).to.equal(2); // TokenType.PLAIN_ERC20
            expect(type2).to.equal(2); // TokenType.PLAIN_ERC20
            
            console.log("✅ Global wrapped token information test passed!");
        });

        it("Should check if token is known wrapped token", async function () {
            console.log("🔍 Testing known wrapped token check...");
            
            const wrapper1Address = await wrapper1.getAddress();
            const wrapper2Address = await wrapper2.getAddress();
            const randomAddress = ethers.Wallet.createRandom().address;
            
            console.log("📍 Wrapper1 Address:", wrapper1Address);
            console.log("📍 Wrapper2 Address:", wrapper2Address);
            console.log("📍 Random Address:", randomAddress);

            const isKnown1 = await wrapperFactory.isWrapper(wrapper1Address);
            const isKnown2 = await wrapperFactory.isWrapper(wrapper2Address);
            const isKnownRandom = await wrapperFactory.isWrapper(randomAddress);
            
            console.log("🔍 Is Known Wrapped Token:");
            console.log("  Wrapper1:", isKnown1);
            console.log("  Wrapper2:", isKnown2);
            console.log("  Random:", isKnownRandom);

            expect(isKnown1).to.be.true;
            expect(isKnown2).to.be.true;
            expect(isKnownRandom).to.be.false;
            
            console.log("✅ Known wrapped token check test passed!");
        });

        it("Should demonstrate WrapperFactory integration", async function () {
            console.log("🔄 Testing WrapperFactory integration...");
            
            // Create a third token and wrapper for testing
            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const mockToken3 = await MockERC20Factory.deploy("Token3", "TK3", 18);
            await mockToken3.waitForDeployment();
            
            const mockToken3Address = await mockToken3.getAddress();
            console.log("📍 New Token3 Address:", mockToken3Address);

            // Use WrapperFactory to get or create wrapper
            const createWrapperTx = await wrapperFactory.getOrCreateWrapper(
                mockToken3Address,
                "Wrapped Token3",
                "wTK3",
                2 // TokenType.PLAIN_ERC20
            );
            await createWrapperTx.wait();
            
            const wrapper3Address = await wrapperFactory.getWrapper(mockToken3Address);
            console.log("📍 Wrapper3 Address:", wrapper3Address);

            // Verify wrapper was created correctly
            const [original3, type3] = await wrapperFactory.getWrappedTokenInfo(wrapper3Address);
            console.log("📊 Wrapper3 Info:");
            console.log("  Original:", original3);
            console.log("  Type:", type3.toString());

            expect(original3).to.equal(mockToken3Address);
            expect(type3).to.equal(2); // TokenType.PLAIN_ERC20

            // Create pair using the wrapper
            const wrapper1Address = await wrapper1.getAddress();
            await factory.createPairWithInfo(
                wrapper1Address,
                wrapper3Address,
                await mockToken1.getAddress(),
                mockToken3Address,
                TokenType.PROJECT_WRAPPED,
                TokenType.PLAIN_ERC20,
                priceScanner.address
            );

            const pairCount = await factory.allPairsLength();
            console.log("📊 Total Pairs After Creation:", pairCount.toString());
            expect(pairCount).to.equal(2);

            // Verify the pair was created correctly
            const newPairAddress = await factory.getPair(wrapper1Address, wrapper3Address);
            console.log("🔗 New Pair Address:", newPairAddress);
            expect(newPairAddress).to.not.equal(ethers.ZeroAddress);
            
            console.log("✅ WrapperFactory integration test passed!");
        });
    });
});

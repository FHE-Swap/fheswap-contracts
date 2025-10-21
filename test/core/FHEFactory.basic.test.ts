import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("FHEFactory Basic Tests", function () {
    let factory: any;
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
            expect(await factory.getAddress()).to.be.properAddress;
            expect(await factory.allPairsLength()).to.equal(0);
        });
    });

    describe("TokenType enum", function () {
        it("Should have correct enum values", async function () {
            // We can't directly test enum values, but we can test functions that use them
            expect(TokenType.PROJECT_WRAPPED).to.equal(0);
            expect(TokenType.OFFICIAL_FHE).to.equal(1);
            expect(TokenType.PLAIN_ERC20).to.equal(2);
        });
    });

    describe("Query functions for non-existent pairs", function () {
        it("Should return zero address for non-existent pair", async function () {
            const randomAddress1 = ethers.Wallet.createRandom().address;
            const randomAddress2 = ethers.Wallet.createRandom().address;

            const pairAddress = await factory.getPair(randomAddress1, randomAddress2);
            expect(pairAddress).to.equal(ethers.ZeroAddress);
        });

        it("Should return zero address for non-existent pair by original tokens", async function () {
            const randomAddress1 = ethers.Wallet.createRandom().address;
            const randomAddress2 = ethers.Wallet.createRandom().address;

            const pairAddress = await factory.getPairByOriginalTokens(randomAddress1, randomAddress2);
            expect(pairAddress).to.equal(ethers.ZeroAddress);
        });

        it("Should return false for hasTokenInfo on non-existent pair", async function () {
            const randomAddress = ethers.Wallet.createRandom().address;
            const hasInfo = await factory.hasTokenInfo(randomAddress);
            expect(hasInfo).to.be.false;
        });

        it("Should return empty info for non-existent pair", async function () {
            const randomAddress = ethers.Wallet.createRandom().address;
            
            const token0Info = await factory.getToken0Info(randomAddress);
            expect(token0Info.tokenAddress).to.equal(ethers.ZeroAddress);
            expect(token0Info.originalAddress).to.equal(ethers.ZeroAddress);
            expect(token0Info.tokenType).to.equal(0);

            const token1Info = await factory.getToken1Info(randomAddress);
            expect(token1Info.tokenAddress).to.equal(ethers.ZeroAddress);
            expect(token1Info.originalAddress).to.equal(ethers.ZeroAddress);
            expect(token1Info.tokenType).to.equal(0);
        });
    });

    describe("Error handling", function () {
        it("Should revert createPair with identical tokens", async function () {
            const sameAddress = ethers.Wallet.createRandom().address;

            await expect(
                factory.createPair(sameAddress, sameAddress, priceScanner.address)
            ).to.be.revertedWithCustomError(factory, "FactoryError")
            .withArgs(1); // ERROR_IDENTICAL_TOKENS
        });

        it("Should revert createPair with zero address", async function () {
            const randomAddress = ethers.Wallet.createRandom().address;

            await expect(
                factory.createPair(ethers.ZeroAddress, randomAddress, priceScanner.address)
            ).to.be.revertedWithCustomError(factory, "FactoryError")
            .withArgs(2); // ERROR_ZERO_ADDRESS
        });

        it("Should revert createPairWithInfo with identical tokens", async function () {
            const sameAddress = ethers.Wallet.createRandom().address;
            const originalAddress = ethers.Wallet.createRandom().address;

            await expect(
                factory.createPairWithInfo(
                    sameAddress,
                    sameAddress,
                    originalAddress,
                    originalAddress,
                    TokenType.PROJECT_WRAPPED,
                    TokenType.PROJECT_WRAPPED,
                    priceScanner.address
                )
            ).to.be.revertedWithCustomError(factory, "FactoryError")
            .withArgs(1); // ERROR_IDENTICAL_TOKENS
        });

        it("Should revert createPairWithInfo with zero address", async function () {
            const randomAddress = ethers.Wallet.createRandom().address;
            const originalAddress = ethers.Wallet.createRandom().address;

            await expect(
                factory.createPairWithInfo(
                    ethers.ZeroAddress,
                    randomAddress,
                    originalAddress,
                    originalAddress,
                    TokenType.PROJECT_WRAPPED,
                    TokenType.PROJECT_WRAPPED,
                    priceScanner.address
                )
            ).to.be.revertedWithCustomError(factory, "FactoryError")
            .withArgs(2); // ERROR_ZERO_ADDRESS
        });
    });

    describe("State variables", function () {
        it("Should have correct initial state", async function () {
            expect(await factory.allPairsLength()).to.equal(0);
        });
    });

    describe("Events", function () {
        it("Should define PairCreated event", async function () {
            // We can't directly test event definitions, but we can verify the contract compiles
            // and has the expected interface
            expect(factory.interface.getEvent("PairCreated")).to.not.be.undefined;
        });

        it("Should define PairCreatedWithInfo event", async function () {
            expect(factory.interface.getEvent("PairCreatedWithInfo")).to.not.be.undefined;
        });
    });

    describe("Function signatures", function () {
        it("Should have all expected functions", async function () {
            // Test that all expected functions exist
            expect(factory.interface.getFunction("createPair")).to.not.be.undefined;
            expect(factory.interface.getFunction("createPairWithInfo")).to.not.be.undefined;
            expect(factory.interface.getFunction("getPair")).to.not.be.undefined;
            expect(factory.interface.getFunction("getPairByOriginalTokens")).to.not.be.undefined;
            expect(factory.interface.getFunction("getPairFullInfo")).to.not.be.undefined;
            expect(factory.interface.getFunction("getToken0Info")).to.not.be.undefined;
            expect(factory.interface.getFunction("getToken1Info")).to.not.be.undefined;
            expect(factory.interface.getFunction("hasTokenInfo")).to.not.be.undefined;
            expect(factory.interface.getFunction("allPairsLength")).to.not.be.undefined;
        });
    });
});

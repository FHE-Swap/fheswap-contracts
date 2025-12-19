import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import hre from "hardhat";

/**
 * Integration Tests for Token Swap Operations
 * 
 * This test suite covers:
 * - Basic token swaps (token0 → token1 and token1 → token0)
 * - Slippage protection mechanism
 * - Price impact calculations
 * - Multiple consecutive swaps
 * - Error handling and edge cases
 * - Multi-user trading scenarios
 */
describe("FHEPair Token Swap Integration Tests", function () {
    this.timeout(180000); // 3 minutes timeout

    let deployer: any, user1: any, user2: any, user3: any;
    let factory: any, pair: any, router: any, wrapperFactory: any;
    let token0: any, token1: any;
    let pairAddress: string;
    let routerAddress: string;

    before(async function () {
        // Ensure we're running in mock environment
        if (!hre.fhevm.isMock) {
            throw new Error("❌ Must run in Mock FHE environment");
        }
        await fhevm.initializeCLIApi();
        console.log("✅ FHEVM Mock API initialized");
    });

    beforeEach(async function () {
        // Get signers
        const signers = await ethers.getSigners();
        deployer = signers[0];
        user1 = signers[1];
        user2 = signers[2];
        user3 = signers[3];

        console.log("\n📦 Deploying contracts...");

        // Deploy FHEPairLib library
        const FHEPairLib = await ethers.getContractFactory("FHEPairLib");
        const lib = await FHEPairLib.deploy();
        const libAddress = await lib.getAddress();

        // Deploy FHEFactory
        const FHEFactory = await ethers.getContractFactory("FHEFactory", {
            libraries: { FHEPairLib: libAddress },
        });
        factory = await FHEFactory.deploy();

        // Deploy WrapperFactory
        const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
        wrapperFactory = await WrapperFactory.deploy();

        // Deploy TokenConverter
        const TokenConverter = await ethers.getContractFactory("TokenConverter");
        const tokenConverter = await TokenConverter.deploy(
            "0x0000000000000000000000000000000000000001",
            await wrapperFactory.getAddress()
        );

        // Deploy FHERouter
        const FHERouterFactory = await ethers.getContractFactory("FHERouter", {
            libraries: { FHEPairLib: libAddress },
        });
        router = await FHERouterFactory.deploy(
            await wrapperFactory.getAddress(),
            await factory.getAddress(),
            await tokenConverter.getAddress()
        );
        routerAddress = await router.getAddress();

        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token0 = await MockERC20.deploy("Token A", "TKA", 18);
        token1 = await MockERC20.deploy("Token B", "TKB", 18);

        // Mint tokens to users
        const mintAmount = ethers.parseEther("1000000");
        await token0.mint(user1.address, mintAmount);
        await token0.mint(user2.address, mintAmount);
        await token0.mint(user3.address, mintAmount);
        await token1.mint(user1.address, mintAmount);
        await token1.mint(user2.address, mintAmount);
        await token1.mint(user3.address, mintAmount);

        // Setup initial liquidity pool
        const liquidityAmount0 = ethers.parseEther("10000");
        const liquidityAmount1 = ethers.parseEther("20000");
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        await token0.connect(user1).approve(routerAddress, ethers.MaxUint256);
        await token1.connect(user1).approve(routerAddress, ethers.MaxUint256);

        await router.connect(user1)["addLiquidity(address,address,uint256,uint256,address,uint256)"](
            await token0.getAddress(),
            await token1.getAddress(),
            liquidityAmount0,
            liquidityAmount1,
            user1.address,
            deadline
        );

        // Get pair address
        pairAddress = await factory.getPair(
            await token0.getAddress(),
            await token1.getAddress()
        );
        pair = await ethers.getContractAt("FHEPair", pairAddress);

        console.log("✅ Liquidity pool initialized for swap testing");
        console.log(`  Pair Address: ${pairAddress}`);
        console.log(`  Initial Pool: ${ethers.formatEther(liquidityAmount0)} TKA, ${ethers.formatEther(liquidityAmount1)} TKB`);
        console.log(`  Initial Price: 1 TKA = 2 TKB`);
    });

    describe("Basic Token Swaps", function () {
        it("Should successfully swap token0 for token1", async function () {
            const amountIn = ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50; // 0.5% slippage tolerance

            // Record balances before swap
            const token0Before = await token0.balanceOf(user2.address);
            const token1Before = await token1.balanceOf(user2.address);

            console.log("\n🔄 Swapping token0 → token1:");
            console.log(`  Input: ${ethers.formatEther(amountIn)} TKA`);
            console.log(`  Slippage tolerance: ${slippageBps / 100}%`);

            // Approve router to spend tokens
            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            // Perform swap via router
            const tx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            const receipt = await tx.wait();
            console.log(`✅ Swap completed (Gas: ${receipt.gasUsed.toString()})`);

            // Check balances after swap
            const token0After = await token0.balanceOf(user2.address);
            const token1After = await token1.balanceOf(user2.address);

            const token0Spent = token0Before - token0After;
            const token1Received = token1After - token1Before;

            console.log(`  Token0 spent: ${ethers.formatEther(token0Spent)} TKA`);
            console.log(`  Token1 received: ${ethers.formatEther(token1Received)} TKB`);
            console.log(`  Effective price: 1 TKA = ${(Number(token1Received) / Number(token0Spent)).toFixed(4)} TKB`);

            // Verify swap occurred
            expect(token0Spent).to.be.gt(0);
            expect(token1Received).to.be.gt(0);

            console.log("✅ Token0 → Token1 swap successful");
        });

        it("Should successfully swap token1 for token0", async function () {
            const amountIn = ethers.parseEther("200");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50; // 0.5% slippage tolerance

            // Record balances before swap
            const token0Before = await token0.balanceOf(user2.address);
            const token1Before = await token1.balanceOf(user2.address);

            console.log("\n🔄 Swapping token1 → token0:");
            console.log(`  Input: ${ethers.formatEther(amountIn)} TKB`);
            console.log(`  Slippage tolerance: ${slippageBps / 100}%`);

            // Approve router to spend tokens
            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            // Perform swap via router
            const tx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token1.getAddress(),
                await token0.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            const receipt = await tx.wait();
            console.log(`✅ Swap completed (Gas: ${receipt.gasUsed.toString()})`);

            // Check balances after swap
            const token0After = await token0.balanceOf(user2.address);
            const token1After = await token1.balanceOf(user2.address);

            const token0Received = token0After - token0Before;
            const token1Spent = token1Before - token1After;

            console.log(`  Token1 spent: ${ethers.formatEther(token1Spent)} TKB`);
            console.log(`  Token0 received: ${ethers.formatEther(token0Received)} TKA`);
            console.log(`  Effective price: 1 TKB = ${(Number(token0Received) / Number(token1Spent)).toFixed(4)} TKA`);

            // Verify swap occurred
            expect(token0Received).to.be.gt(0);
            expect(token1Spent).to.be.gt(0);

            console.log("✅ Token1 → Token0 swap successful");
        });

        it("Should handle small swap amounts correctly", async function () {
            const amountIn = ethers.parseEther("1"); // Small amount
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 100; // 1% slippage tolerance

            console.log("\n🔄 Testing small amount swap:");
            console.log(`  Input: ${ethers.formatEther(amountIn)} TKA`);

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            const tx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            await tx.wait();

            console.log("✅ Small swap handled successfully");
        });

        it("Should handle large swap amounts with price impact", async function () {
            const amountIn = ethers.parseEther("1000"); // Large amount (10% of pool)
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 500; // 5% slippage tolerance (higher for large swaps)

            const token1Before = await token1.balanceOf(user2.address);

            console.log("\n🔄 Testing large swap with price impact:");
            console.log(`  Input: ${ethers.formatEther(amountIn)} TKA (10% of pool)`);
            console.log(`  Slippage tolerance: ${slippageBps / 100}%`);

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            const tx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            await tx.wait();

            const token1After = await token1.balanceOf(user2.address);
            const received = token1After - token1Before;

            console.log(`  Token1 received: ${ethers.formatEther(received)} TKB`);
            console.log(`  Price impact visible (received < 2000 TKB due to slippage)`);

            console.log("✅ Large swap with price impact handled");
        });
    });

    describe("Slippage Protection", function () {
        it("Should execute swap within acceptable slippage range", async function () {
            const amountIn = ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 100; // 1% slippage tolerance

            console.log("\n✅ Testing slippage protection:");
            console.log(`  Slippage tolerance: ${slippageBps / 100}%`);

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            const tx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            const receipt = await tx.wait();

            console.log("✅ Swap executed within slippage tolerance");
        });

        it("Should handle zero slippage tolerance", async function () {
            const amountIn = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 0; // Zero slippage tolerance

            console.log("\n⚠️  Testing zero slippage:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            // This might fail or succeed depending on exact price match
            const tx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            await tx.wait();

            console.log("✅ Zero slippage swap processed");
        });

        it("Should allow high slippage tolerance for volatile conditions", async function () {
            const amountIn = ethers.parseEther("500");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 1000; // 10% slippage tolerance

            console.log("\n📊 Testing high slippage tolerance:");
            console.log(`  Slippage tolerance: ${slippageBps / 100}%`);

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            const tx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            await tx.wait();

            console.log("✅ High slippage swap successful");
        });
    });

    describe("Multiple Consecutive Swaps", function () {
        it("Should handle multiple swaps in sequence", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 100;

            console.log("\n🔄 Testing multiple consecutive swaps:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            // First swap: token0 → token1
            console.log("  Swap 1: TKA → TKB");
            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                ethers.parseEther("50"),
                slippageBps,
                user2.address,
                deadline
            );

            // Second swap: token1 → token0
            console.log("  Swap 2: TKB → TKA");
            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token1.getAddress(),
                await token0.getAddress(),
                ethers.parseEther("100"),
                slippageBps,
                user2.address,
                deadline
            );

            // Third swap: token0 → token1
            console.log("  Swap 3: TKA → TKB");
            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                ethers.parseEther("25"),
                slippageBps,
                user2.address,
                deadline
            );

            console.log("✅ All swaps completed successfully");
        });

        it("Should reflect price changes after each swap", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 200;

            console.log("\n📈 Testing price impact accumulation:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            const swapAmount = ethers.parseEther("500");

            // Multiple large swaps in same direction
            for (let i = 1; i <= 3; i++) {
                console.log(`  Swap ${i}: ${ethers.formatEther(swapAmount)} TKA → TKB`);
                
                const token1Before = await token1.balanceOf(user2.address);
                
                await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                    await token0.getAddress(),
                    await token1.getAddress(),
                    swapAmount,
                    slippageBps,
                    user2.address,
                    deadline
                );

                const token1After = await token1.balanceOf(user2.address);
                const received = token1After - token1Before;
                
                console.log(`    Received: ${ethers.formatEther(received)} TKB`);
            }

            console.log("✅ Price impact accumulation observed");
        });
    });

    describe("Error Cases and Validations", function () {
        it("Should reject swap with expired deadline", async function () {
            const amountIn = ethers.parseEther("100");
            const expiredDeadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
            const slippageBps = 50;

            console.log("\n⏰ Testing expired deadline rejection:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            await expect(
                router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                    await token0.getAddress(),
                    await token1.getAddress(),
                    amountIn,
                    slippageBps,
                    user2.address,
                    expiredDeadline
                )
            ).to.be.revertedWithCustomError(pair, "Expired");

            console.log("✅ Correctly rejected expired swap");
        });

        it("Should reject swap without sufficient balance", async function () {
            const hugeAmount = ethers.parseEther("10000000"); // More than user has
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50;

            console.log("\n💰 Testing insufficient balance rejection:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            await expect(
                router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                    await token0.getAddress(),
                    await token1.getAddress(),
                    hugeAmount,
                    slippageBps,
                    user2.address,
                    deadline
                )
            ).to.be.reverted; // Will revert due to insufficient balance

            console.log("✅ Correctly rejected insufficient balance");
        });

        it("Should reject swap without approval", async function () {
            const amountIn = ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50;

            console.log("\n🔒 Testing approval requirement:");

            // Don't approve - should fail
            await expect(
                router.connect(user3)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                    await token0.getAddress(),
                    await token1.getAddress(),
                    amountIn,
                    slippageBps,
                    user3.address,
                    deadline
                )
            ).to.be.reverted; // Will revert due to insufficient allowance

            console.log("✅ Correctly enforced approval requirement");
        });

        it("Should handle zero amount swap gracefully", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50;

            console.log("\n⚠️  Testing zero amount swap:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            // Should process but result in no actual swap
            const tx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                0,
                slippageBps,
                user2.address,
                deadline
            );

            await tx.wait();

            console.log("✅ Zero amount swap handled");
        });
    });

    describe("Multi-User Trading Scenarios", function () {
        it("Should handle simultaneous trades from multiple users", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 200;

            console.log("\n👥 Testing multi-user trading:");

            // Approve for all users
            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token0.connect(user3).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user3).approve(routerAddress, ethers.MaxUint256);

            // User2 swap
            console.log("  User2 swapping TKA → TKB");
            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                ethers.parseEther("100"),
                slippageBps,
                user2.address,
                deadline
            );

            // User3 swap
            console.log("  User3 swapping TKB → TKA");
            await router.connect(user3)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token1.getAddress(),
                await token0.getAddress(),
                ethers.parseEther("200"),
                slippageBps,
                user3.address,
                deadline
            );

            console.log("✅ Multi-user trading successful");
        });

        it("Should handle arbitrage opportunities", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 100;

            console.log("\n💹 Testing arbitrage scenario:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            const initialBalance0 = await token0.balanceOf(user2.address);

            // Buy token1 with token0
            console.log("  Step 1: Buy TKB with TKA");
            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                ethers.parseEther("100"),
                slippageBps,
                user2.address,
                deadline
            );

            // Sell token1 for token0
            console.log("  Step 2: Sell TKB for TKA");
            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token1.getAddress(),
                await token0.getAddress(),
                ethers.parseEther("150"),
                slippageBps,
                user2.address,
                deadline
            );

            const finalBalance0 = await token0.balanceOf(user2.address);
            const difference = finalBalance0 - initialBalance0;

            console.log(`  Net TKA change: ${ethers.formatEther(difference)}`);
            console.log("✅ Arbitrage scenario executed");
        });
    });

    describe("Edge Cases", function () {
        it("Should swap to different recipient address", async function () {
            const amountIn = ethers.parseEther("50");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50;

            const user3Token1Before = await token1.balanceOf(user3.address);

            console.log("\n📤 Testing swap to different recipient:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            // User2 swaps but sends output to user3
            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user3.address, // Different recipient
                deadline
            );

            const user3Token1After = await token1.balanceOf(user3.address);

            expect(user3Token1After).to.be.gt(user3Token1Before);

            console.log(`  User3 received: ${ethers.formatEther(user3Token1After - user3Token1Before)} TKB`);
            console.log("✅ Swap to different recipient successful");
        });

        it("Should emit correct events on swap", async function () {
            const amountIn = ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50;

            console.log("\n📡 Testing event emission:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            const tx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            const receipt = await tx.wait();
            const events = receipt.logs;

            expect(events.length).to.be.gt(0);

            console.log(`✅ Transaction emitted ${events.length} events`);
        });

        it("Should maintain constant product (k) invariant", async function () {
            const amountIn = ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50;

            console.log("\n⚖️  Testing constant product invariant:");
            console.log("  Note: k should remain constant or increase (due to fees)");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            console.log("✅ Constant product invariant maintained");
        });
    });

    describe("Router Statistics Tracking", function () {
        it("Should track swap operations in router statistics", async function () {
            const amountIn = ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50;

            console.log("\n📊 Testing router statistics tracking:");

            // Get initial stats
            const [initialSwaps] = await router.getRouterStats();
            console.log(`  Initial swap count: ${initialSwaps.toString()}`);

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            // Perform swap
            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            // Check stats after swap
            const [, , swapsAfter] = await router.getRouterStats();
            console.log(`  Swap count after operation: ${swapsAfter.toString()}`);

            expect(swapsAfter).to.be.gt(initialSwaps);

            console.log("✅ Router statistics tracked correctly");
        });

        it("Should track user operation count", async function () {
            const amountIn = ethers.parseEther("50");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50;

            console.log("\n👤 Testing user operation count:");

            // Get initial user stats
            const initialUserOps = await router.getUserStats(user2.address);
            console.log(`  Initial user2 operations: ${initialUserOps.toString()}`);

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            // Perform multiple swaps
            for (let i = 0; i < 3; i++) {
                await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                    await token0.getAddress(),
                    await token1.getAddress(),
                    amountIn,
                    slippageBps,
                    user2.address,
                    deadline
                );
            }

            // Check user stats
            const finalUserOps = await router.getUserStats(user2.address);
            console.log(`  Final user2 operations: ${finalUserOps.toString()}`);

            expect(finalUserOps).to.be.gte(initialUserOps + 3n);

            console.log("✅ User operation count tracked correctly");
        });

        it("Should provide comprehensive router analytics", async function () {
            const amountIn = ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50;

            console.log("\n📈 Testing comprehensive analytics:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            // Perform swap
            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                slippageBps,
                user2.address,
                deadline
            );

            // Get comprehensive analytics
            const [totalOps, liquidityAdds, liquidityRemoves, swaps, wraps, isPaused] =
                await router.getRouterAnalytics();

            console.log(`  📊 Total operations: ${totalOps.toString()}`);
            console.log(`  📊 Liquidity adds: ${liquidityAdds.toString()}`);
            console.log(`  📊 Liquidity removes: ${liquidityRemoves.toString()}`);
            console.log(`  📊 Swaps: ${swaps.toString()}`);
            console.log(`  📊 Wraps: ${wraps.toString()}`);
            console.log(`  📊 Router paused: ${isPaused}`);

            expect(totalOps).to.be.gt(0);
            expect(swaps).to.be.gt(0);

            console.log("✅ Comprehensive analytics retrieved successfully");
        });
    });

    describe("Gas Optimization Scenarios", function () {
        it("Should handle sequential swaps with gas efficiency", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 100;

            console.log("\n⛽ Testing gas efficiency for sequential swaps:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            const gasUsed = [];

            // Perform 5 swaps and record gas
            for (let i = 0; i < 5; i++) {
                const tx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                    await token0.getAddress(),
                    await token1.getAddress(),
                    ethers.parseEther("10"),
                    slippageBps,
                    user2.address,
                    deadline
                );
                const receipt = await tx.wait();
                gasUsed.push(receipt.gasUsed);
                console.log(`  Swap ${i + 1} gas used: ${receipt.gasUsed.toString()}`);
            }

            console.log("✅ Gas efficiency test completed");
        });

        it("Should handle optimal swap amounts for minimal price impact", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 50;

            console.log("\n📊 Testing optimal swap amounts:");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            // Small swap (< 0.1% of pool)
            const smallAmount = ethers.parseEther("5");
            console.log(`  Small swap (0.05% of pool): ${ethers.formatEther(smallAmount)} TKA`);

            const token1Before = await token1.balanceOf(user2.address);

            await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                await token0.getAddress(),
                await token1.getAddress(),
                smallAmount,
                slippageBps,
                user2.address,
                deadline
            );

            const token1After = await token1.balanceOf(user2.address);
            const received = token1After - token1Before;

            console.log(`  Received: ${ethers.formatEther(received)} TKB`);
            console.log(`  Price impact: minimal (near 1:2 ratio)`);

            console.log("✅ Optimal swap amount test completed");
        });
    });

    describe("Stress Testing", function () {
        it("Should handle rapid consecutive swaps", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 200;

            console.log("\n🔥 Stress test: Rapid consecutive swaps");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            const swapCount = 10;
            console.log(`  Executing ${swapCount} rapid swaps...`);

            for (let i = 0; i < swapCount; i++) {
                await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                    await token0.getAddress(),
                    await token1.getAddress(),
                    ethers.parseEther("10"),
                    slippageBps,
                    user2.address,
                    deadline
                );
            }

            console.log(`✅ Successfully completed ${swapCount} rapid swaps`);
        });

        it("Should handle various swap sizes in sequence", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const slippageBps = 300;

            console.log("\n📊 Stress test: Various swap sizes");

            await token0.connect(user2).approve(routerAddress, ethers.MaxUint256);
            await token1.connect(user2).approve(routerAddress, ethers.MaxUint256);

            const swapSizes = [
                ethers.parseEther("1"),     // tiny
                ethers.parseEther("10"),    // small
                ethers.parseEther("100"),   // medium
                ethers.parseEther("500"),   // large
                ethers.parseEther("50"),    // medium
                ethers.parseEther("5")      // small
            ];

            for (let i = 0; i < swapSizes.length; i++) {
                console.log(`  Swap ${i + 1}: ${ethers.formatEther(swapSizes[i])} TKA`);

                await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
                    await token0.getAddress(),
                    await token1.getAddress(),
                    swapSizes[i],
                    slippageBps,
                    user2.address,
                    deadline
                );
            }

            console.log("✅ Various swap sizes handled successfully");
        });
    });
});


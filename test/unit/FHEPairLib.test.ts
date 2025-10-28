import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { sqrt } from "../helpers/assertions";


describe("FHEPairLib - Unit Tests", function () {
    before(async function () {
        await fhevm.initializeCLIApi();
    });

    describe("1️⃣ sqrt function - Pure function tests", function () {
        let testContract: any;

        before(async function () {
            // Deploy a test contract to call the library's sqrt function
            const TestSqrtFactory = await ethers.getContractFactory("TestSqrt");
            testContract = await TestSqrtFactory.deploy();
            await testContract.waitForDeployment();
        });

        it("should correctly calculate sqrt(0) = 0", async function () {
            const result = await testContract.testSqrt(0);
            expect(result).to.equal(0);
        });

        it("should correctly calculate sqrt(1) = 1", async function () {
            const result = await testContract.testSqrt(1);
            expect(result).to.equal(1);
        });

        it("should correctly calculate sqrt(4) = 2", async function () {
            const result = await testContract.testSqrt(4);
            expect(result).to.equal(2);
        });

        it("should correctly calculate sqrt(9) = 3", async function () {
            const result = await testContract.testSqrt(9);
            expect(result).to.equal(3);
        });

        it("should correctly calculate sqrt(16) = 4", async function () {
            const result = await testContract.testSqrt(16);
            expect(result).to.equal(4);
        });

        it("should correctly calculate sqrt(100) = 10", async function () {
            const result = await testContract.testSqrt(100);
            expect(result).to.equal(10);
        });

        it("should correctly calculate sqrt(10000) = 100", async function () {
            const result = await testContract.testSqrt(10000);
            expect(result).to.equal(100);
        });

        it("should correctly calculate non-perfect square sqrt(20000)", async function () {
            const result = await testContract.testSqrt(20000);
            // sqrt(20000) ≈ 141.421
            const expected = BigInt(Math.floor(Math.sqrt(20000)));
            expect(result).to.equal(expected);
            expect(result).to.equal(141n);
        });

        it("should correctly calculate large number sqrt(10^18)", async function () {
            const input = ethers.parseEther("1"); // 10^18
            const result = await testContract.testSqrt(input);
            // sqrt(10^18) = 10^9
            const expected = BigInt(10 ** 9);
            expect(result).to.equal(expected);
        });

        it("should correctly calculate initial LP scenario", async function () {
            // Test typical initial liquidity scenario
            // amount0 = 100 * 10^6 (100 tokens, 6 decimals)
            // amount1 = 200 * 10^6 (200 tokens, 6 decimals)
            const amount0 = ethers.parseUnits("100", 6);
            const amount1 = ethers.parseUnits("200", 6);
            const product = amount0 * amount1;

            const result = await testContract.testSqrt(product);
            const expectedJS = sqrt(product);

            console.log("  📊 Initial LP calculation:");
            console.log("    amount0:", amount0.toString());
            console.log("    amount1:", amount1.toString());
            console.log("    product:", product.toString());
            console.log("    sqrt (contract):", result.toString());
            console.log("    sqrt (JS):", expectedJS.toString());

            expect(result).to.equal(expectedJS);
        });

        it("should match JS implementation of sqrt results", async function () {
            // Test multiple random values
            const testValues = [
                1n,
                2n,
                3n,
                100n,
                256n,
                1000n,
                10000n,
                99999n,
                BigInt(10 ** 10),
                BigInt(10 ** 15),
            ];

            for (const value of testValues) {
                const contractResult = await testContract.testSqrt(value);
                const jsResult = sqrt(value);
                expect(contractResult).to.equal(jsResult);
            }
        });
    });

    describe("2️⃣ sqrt boundary conditions", function () {
        let testContract: any;

        before(async function () {
            const TestSqrtFactory = await ethers.getContractFactory("TestSqrt");
            testContract = await TestSqrtFactory.deploy();
            await testContract.waitForDeployment();
        });

        it("should handle y=2 case", async function () {
            const result = await testContract.testSqrt(2);
            expect(result).to.equal(1n);
        });

        it("should handle y=3 case", async function () {
            const result = await testContract.testSqrt(3);
            expect(result).to.equal(1n);
        });

        it("should handle extremely large values", async function () {
            // Test values close to uint256 max
            const largeValue = BigInt(2) ** BigInt(128); // 2^128
            const result = await testContract.testSqrt(largeValue);
            const expected = BigInt(2) ** BigInt(64); // 2^64
            expect(result).to.equal(expected);
        });
    });

    describe("3️⃣ sqrt performance and Gas tests", function () {
        let testContract: any;

        before(async function () {
            const TestSqrtFactory = await ethers.getContractFactory("TestSqrt");
            testContract = await TestSqrtFactory.deploy();
            await testContract.waitForDeployment();
        });

        it("should calculate small values within reasonable gas range", async function () {
            // testSqrt is a view function, use estimateGas to test gas consumption
            const gasEstimate = await testContract.testSqrt.estimateGas(100);
            console.log("  ⛽ Gas estimate for sqrt(100):", gasEstimate.toString());
            // sqrt is a simple pure function, gas consumption should be low
            expect(gasEstimate).to.be.lt(50000);
        });

        it("should calculate large values within reasonable gas range", async function () {
            const gasEstimate = await testContract.testSqrt.estimateGas(ethers.parseEther("1000000"));
            console.log("  ⛽ Gas estimate for sqrt(10^24):", gasEstimate.toString());
            expect(gasEstimate).to.be.lt(100000);
        });
    });

    describe("4️⃣ sqrt precision verification", function () {
        let testContract: any;

        before(async function () {
            const TestSqrtFactory = await ethers.getContractFactory("TestSqrt");
            testContract = await TestSqrtFactory.deploy();
            await testContract.waitForDeployment();
        });

        it(" sqrt(x)^2 <= x < (sqrt(x)+1)^2", async function () {
            const testValues = [2n, 3n, 5n, 10n, 99n, 1000n, 12345n];

            for (const x of testValues) {
                const sqrtX = await testContract.testSqrt(x);
                const lower = sqrtX * sqrtX;
                const upper = (sqrtX + 1n) * (sqrtX + 1n);

                expect(lower).to.be.lte(x);
                expect(x).to.be.lt(upper);
            }
        });
    });

    // Note: Other FHE functions (computeRNG, computeObfuscatedReserves, etc.)
    // should be tested in integration tests, as they require full contract context
    // and decryption flow to verify correctness
});

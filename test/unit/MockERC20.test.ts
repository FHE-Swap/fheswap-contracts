import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployBasicFixture } from "../helpers/fixtures";


describe("MockERC20 Tests", function () {

    this.timeout(60000);

   
    describe("Deployment", function () {
        it("should successfully deploy token with 18 decimals", async function () {
            const { owner } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            expect(await token.getAddress()).to.be.properAddress;
            expect(await token.name()).to.equal("Test Token");
            expect(await token.symbol()).to.equal("TEST");
            expect(await token.decimals()).to.equal(18);
            expect(await token.totalSupply()).to.equal(0);
        });

        it("should successfully deploy token with 6 decimals", async function () {
            const { owner } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "USDC Token",
                "USDC",
                6
            );
            await token.waitForDeployment();

            expect(await token.decimals()).to.equal(6);
        });

        it("should successfully deploy tokens with different decimals", async function () {
            const { owner } = await loadFixture(deployBasicFixture);
            const MockERC20Factory = await ethers.getContractFactory("MockERC20");

            // Test different decimals values
            const decimalsToTest = [0, 6, 8, 18, 24];

            for (const decimals of decimalsToTest) {
                const token = await MockERC20Factory.connect(owner).deploy(
                    `Token ${decimals}`,
                    `TK${decimals}`,
                    decimals
                );
                await token.waitForDeployment();

                expect(await token.decimals()).to.equal(decimals);
            }
        });
    });

    // ============================================================================
    // 2. Mint Function Tests
    // ============================================================================

    describe("Mint Function", function () {
        it("should successfully mint tokens to user", async function () {
            const { owner, user1 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const mintAmount = ethers.parseEther("1000");
            await token.mint(user1.address, mintAmount);

            expect(await token.balanceOf(user1.address)).to.equal(mintAmount);
            expect(await token.totalSupply()).to.equal(mintAmount);
        });

        it("should support multiple mints", async function () {
            const { owner, user1 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const mintAmount1 = ethers.parseEther("1000");
            const mintAmount2 = ethers.parseEther("500");

            await token.mint(user1.address, mintAmount1);
            await token.mint(user1.address, mintAmount2);

            expect(await token.balanceOf(user1.address)).to.equal(
                mintAmount1 + mintAmount2
            );
            expect(await token.totalSupply()).to.equal(mintAmount1 + mintAmount2);
        });

        it("should support minting to multiple users", async function () {
            const { owner, user1, user2 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const mintAmount1 = ethers.parseEther("1000");
            const mintAmount2 = ethers.parseEther("2000");

            await token.mint(user1.address, mintAmount1);
            await token.mint(user2.address, mintAmount2);

            expect(await token.balanceOf(user1.address)).to.equal(mintAmount1);
            expect(await token.balanceOf(user2.address)).to.equal(mintAmount2);
            expect(await token.totalSupply()).to.equal(mintAmount1 + mintAmount2);
        });

        it("should mint correct amount (6 decimals)", async function () {
            const { owner, user1 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "USDC Token",
                "USDC",
                6
            );
            await token.waitForDeployment();

            const mintAmount = ethers.parseUnits("1000", 6);
            await token.mint(user1.address, mintAmount);

            expect(await token.balanceOf(user1.address)).to.equal(mintAmount);
        });
    });

    // ============================================================================
    // 3. Transfer Function Tests
    // ============================================================================

    describe("Transfer Function", function () {
        it("should successfully transfer", async function () {
            const { owner, user1, user2 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const mintAmount = ethers.parseEther("1000");
            await token.mint(user1.address, mintAmount);

            const transferAmount = ethers.parseEther("300");
            await token.connect(user1).transfer(user2.address, transferAmount);

            expect(await token.balanceOf(user1.address)).to.equal(
                mintAmount - transferAmount
            );
            expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
        });

        it("should revert when insufficient balance", async function () {
            const { owner, user1, user2 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const mintAmount = ethers.parseEther("100");
            await token.mint(user1.address, mintAmount);

            const transferAmount = ethers.parseEther("200"); // Exceeds balance

            await expect(
                token.connect(user1).transfer(user2.address, transferAmount)
            ).to.be.reverted;
        });

        it("should emit Transfer event", async function () {
            const { owner, user1, user2 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const mintAmount = ethers.parseEther("1000");
            await token.mint(user1.address, mintAmount);

            const transferAmount = ethers.parseEther("300");

            await expect(
                token.connect(user1).transfer(user2.address, transferAmount)
            )
                .to.emit(token, "Transfer")
                .withArgs(user1.address, user2.address, transferAmount);
        });
    });

    // ============================================================================
    // 4. Approve and TransferFrom Function Tests
    // ============================================================================

    describe("Approve and TransferFrom", function () {
        it("should successfully approve allowance", async function () {
            const { owner, user1, user2 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const approveAmount = ethers.parseEther("500");
            await token.connect(user1).approve(user2.address, approveAmount);

            expect(await token.allowance(user1.address, user2.address)).to.equal(
                approveAmount
            );
        });

        it("should emit Approval event", async function () {
            const { owner, user1, user2 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const approveAmount = ethers.parseEther("500");

            await expect(
                token.connect(user1).approve(user2.address, approveAmount)
            )
                .to.emit(token, "Approval")
                .withArgs(user1.address, user2.address, approveAmount);
        });

        it("should successfully use transferFrom", async function () {
            const { owner, user1, user2, feeCollector } = await loadFixture(
                deployBasicFixture
            );

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const mintAmount = ethers.parseEther("1000");
            await token.mint(user1.address, mintAmount);

            const approveAmount = ethers.parseEther("500");
            await token.connect(user1).approve(user2.address, approveAmount);

            const transferAmount = ethers.parseEther("300");
            await token
                .connect(user2)
                .transferFrom(user1.address, feeCollector.address, transferAmount);

            expect(await token.balanceOf(user1.address)).to.equal(
                mintAmount - transferAmount
            );
            expect(await token.balanceOf(feeCollector.address)).to.equal(
                transferAmount
            );
            expect(await token.allowance(user1.address, user2.address)).to.equal(
                approveAmount - transferAmount
            );
        });

        it("should revert when insufficient allowance", async function () {
            const { owner, user1, user2, feeCollector } = await loadFixture(
                deployBasicFixture
            );

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const mintAmount = ethers.parseEther("1000");
            await token.mint(user1.address, mintAmount);

            const approveAmount = ethers.parseEther("100");
            await token.connect(user1).approve(user2.address, approveAmount);

            const transferAmount = ethers.parseEther("300"); // Exceeds allowance

            await expect(
                token
                    .connect(user2)
                    .transferFrom(user1.address, feeCollector.address, transferAmount)
            ).to.be.reverted;
        });
    });

    // ============================================================================
    // 5. Edge Cases Tests
    // ============================================================================

    describe("Edge Cases", function () {
        it("should support minting 0 amount", async function () {
            const { owner, user1 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            await token.mint(user1.address, 0);

            expect(await token.balanceOf(user1.address)).to.equal(0);
            expect(await token.totalSupply()).to.equal(0);
        });

        it("should support transferring 0 amount", async function () {
            const { owner, user1, user2 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const mintAmount = ethers.parseEther("1000");
            await token.mint(user1.address, mintAmount);

            await token.connect(user1).transfer(user2.address, 0);

            expect(await token.balanceOf(user1.address)).to.equal(mintAmount);
            expect(await token.balanceOf(user2.address)).to.equal(0);
        });

        it("should support approving 0 amount", async function () {
            const { owner, user1, user2 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            await token.connect(user1).approve(user2.address, 0);

            expect(await token.allowance(user1.address, user2.address)).to.equal(0);
        });

        it("should support transferring to self", async function () {
            const { owner, user1 } = await loadFixture(deployBasicFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const token = await MockERC20Factory.connect(owner).deploy(
                "Test Token",
                "TEST",
                18
            );
            await token.waitForDeployment();

            const mintAmount = ethers.parseEther("1000");
            await token.mint(user1.address, mintAmount);

            const transferAmount = ethers.parseEther("100");
            await token.connect(user1).transfer(user1.address, transferAmount);

            // Balance should remain unchanged
            expect(await token.balanceOf(user1.address)).to.equal(mintAmount);
        });
    });
});

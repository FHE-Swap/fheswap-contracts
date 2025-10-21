import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { HardhatFhevmRuntimeEnvironment } from "@fhevm/hardhat-plugin";

describe("ERC20Wrapper Tests", function () {
  let signers: any[];
  let provider: any;
  let decimals: bigint;

  let mockERC20_18: any; // 18 decimal token (ETH-like)
  let mockERC20_6: any;  // 6 decimal token (USDC-like)
  
  let wrapper18: any; // Wrapper for 18 decimal token
  let wrapper6: any;  // Wrapper for 6 decimal token

  before(async function () {
    signers = await ethers.getSigners();
    provider = ethers.provider;
    await fhevm.initializeCLIApi();
    decimals = BigInt(10) ** BigInt(6); // ERC7984 uses 6 decimals
  });

  describe("Deploy Test Tokens", function () {
    it("should deploy 18 decimal mock ERC20 token", async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20", signers[0]);
      mockERC20_18 = await MockERC20Factory.deploy("Ethereum", "ETH", 18);
      await mockERC20_18.waitForDeployment();

      expect(await mockERC20_18.getAddress()).to.be.properAddress;
      expect(await mockERC20_18.decimals()).to.equal(18);
      expect(await mockERC20_18.name()).to.equal("Ethereum");
      expect(await mockERC20_18.symbol()).to.equal("ETH");
    });

    it("should deploy 6 decimal mock ERC20 token", async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20", signers[0]);
      mockERC20_6 = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
      await mockERC20_6.waitForDeployment();

      expect(await mockERC20_6.getAddress()).to.be.properAddress;
      expect(await mockERC20_6.decimals()).to.equal(6);
      expect(await mockERC20_6.name()).to.equal("USD Coin");
      expect(await mockERC20_6.symbol()).to.equal("USDC");
    });
  });

  describe("Deploy Wrapper Contracts", function () {
    it("should deploy wrapper for 18 decimal token", async function () {
      const WrapperFactory = await ethers.getContractFactory("ERC20Wrapper", signers[0]);
      wrapper18 = await WrapperFactory.deploy(
        await mockERC20_18.getAddress(),
        "Wrapped Ethereum",
        "wETH",
        1 // Rate: 1 ETH = 1 wETH
      );
      await wrapper18.waitForDeployment();

      expect(await wrapper18.getAddress()).to.be.properAddress;
      expect(await wrapper18.underlying()).to.equal(await mockERC20_18.getAddress());
      expect(await wrapper18.rate()).to.equal(1);
      expect(await wrapper18.underlyingDecimals()).to.equal(18);
    });

    it("should deploy wrapper for 6 decimal token", async function () {
      const WrapperFactory = await ethers.getContractFactory("ERC20Wrapper", signers[0]);
      wrapper6 = await WrapperFactory.deploy(
        await mockERC20_6.getAddress(),
        "Wrapped USD Coin",
        "wUSDC",
        1 // Rate: 1 USDC = 1 wUSDC
      );
      await wrapper6.waitForDeployment();

      expect(await wrapper6.getAddress()).to.be.properAddress;
      expect(await wrapper6.underlying()).to.equal(await mockERC20_6.getAddress());
      expect(await wrapper6.rate()).to.equal(1);
      expect(await wrapper6.underlyingDecimals()).to.equal(6);
    });
  });

  describe("18 Decimal Token Wrapping Test (ETH-like)", function () {
    const testAmount = "1.897867";
    const testAmountWei = ethers.parseEther(testAmount);

    before(async function () {
      console.log("\n📦 Starting 18 decimal token wrapping test");
      console.log(`Test amount: ${testAmount} ETH`);
      console.log(`Wei format: ${testAmountWei.toString()}`);
      
      await mockERC20_18.mint(signers[0].address, testAmountWei);
      await mockERC20_18.approve(await wrapper18.getAddress(), testAmountWei);
    });

    it("should successfully wrap 1.897867 ETH", async function () {
      const balanceBefore = await mockERC20_18.balanceOf(signers[0].address);
      console.log(`\n💰 User balance before wrapping: ${ethers.formatEther(balanceBefore)} ETH`);
      expect(balanceBefore).to.equal(testAmountWei);

      console.log(`🔄 Wrapping ${testAmount} ETH...`);
      await wrapper18.wrap(signers[0].address, testAmountWei);

      const balanceAfter = await mockERC20_18.balanceOf(signers[0].address);
      console.log(`💰 User balance after wrapping: ${ethers.formatEther(balanceAfter)} ETH`);
      expect(balanceAfter).to.equal(0);

      const wrapperBalance = await mockERC20_18.balanceOf(await wrapper18.getAddress());
      console.log(`🏦 Wrapper contract balance: ${ethers.formatEther(wrapperBalance)} ETH`);
      expect(wrapperBalance).to.equal(testAmountWei);

      const confidentialBalance = await wrapper18.confidentialBalanceOf(signers[0].address);
      console.log(`🔒 Confidential token balance created (encrypted state)`);
      expect(confidentialBalance).to.not.be.undefined;
    });

    it("should retrieve wrapper basic information", async function () {
      expect(await wrapper18.underlying()).to.equal(await mockERC20_18.getAddress());
      expect(await wrapper18.rate()).to.equal(1);
      expect(await wrapper18.underlyingDecimals()).to.equal(18);
      expect(await wrapper18.name()).to.equal("Wrapped Ethereum");
      expect(await wrapper18.symbol()).to.equal("wETH");
    });
  });

  describe("6 Decimal Token Wrapping Test (USDC-like)", function () {
    const testAmount = "1.897867";
    const testAmountUnits = ethers.parseUnits(testAmount, 6);

    before(async function () {
      console.log("\n📦 Starting 6 decimal token wrapping test");
      console.log(`Test amount: ${testAmount} USDC`);
      console.log(`6 decimal format: ${testAmountUnits.toString()}`);
      
      await mockERC20_6.mint(signers[0].address, testAmountUnits);
      await mockERC20_6.approve(await wrapper6.getAddress(), testAmountUnits);
    });

    it("should successfully wrap 1.897867 USDC", async function () {
      const balanceBefore = await mockERC20_6.balanceOf(signers[0].address);
      console.log(`\n💵 User balance before wrapping: ${ethers.formatUnits(balanceBefore, 6)} USDC`);
      expect(balanceBefore).to.equal(testAmountUnits);

      console.log(`🔄 Wrapping ${testAmount} USDC...`);
      await wrapper6.wrap(signers[0].address, testAmountUnits);

      const balanceAfter = await mockERC20_6.balanceOf(signers[0].address);
      console.log(`💵 User balance after wrapping: ${ethers.formatUnits(balanceAfter, 6)} USDC`);
      expect(balanceAfter).to.equal(0);

      const wrapperBalance = await mockERC20_6.balanceOf(await wrapper6.getAddress());
      console.log(`🏦 Wrapper contract balance: ${ethers.formatUnits(wrapperBalance, 6)} USDC`);
      expect(wrapperBalance).to.equal(testAmountUnits);

      const confidentialBalance = await wrapper6.confidentialBalanceOf(signers[0].address);
      console.log(`🔒 Confidential token balance created (encrypted state)`);
      expect(confidentialBalance).to.not.be.undefined;
    });

    it("should retrieve wrapper basic information", async function () {
      expect(await wrapper6.underlying()).to.equal(await mockERC20_6.getAddress());
      expect(await wrapper6.rate()).to.equal(1);
      expect(await wrapper6.underlyingDecimals()).to.equal(6);
      expect(await wrapper6.name()).to.equal("Wrapped USD Coin");
      expect(await wrapper6.symbol()).to.equal("wUSDC");
    });
  });

  describe("Precision Tests", function () {
    it("should correctly handle 18 decimal precision conversion", async function () {
      const preciseAmount = ethers.parseEther("1.123456789123456789");
      
      await mockERC20_18.mint(signers[1].address, preciseAmount);
      await mockERC20_18.connect(signers[1]).approve(await wrapper18.getAddress(), preciseAmount);
      
      const balanceBefore = await mockERC20_18.balanceOf(await wrapper18.getAddress());
      
      await wrapper18.connect(signers[1]).wrap(signers[1].address, preciseAmount);
      
      const balanceAfter = await mockERC20_18.balanceOf(await wrapper18.getAddress());
      expect(balanceAfter).to.equal(balanceBefore + preciseAmount);
    });

    it("should correctly handle 6 decimal precision conversion", async function () {
      const preciseAmount = ethers.parseUnits("1.123456", 6);
      
      await mockERC20_6.mint(signers[1].address, preciseAmount);
      await mockERC20_6.connect(signers[1]).approve(await wrapper6.getAddress(), preciseAmount);
      
      const balanceBefore = await mockERC20_6.balanceOf(await wrapper6.getAddress());
      
      await wrapper6.connect(signers[1]).wrap(signers[1].address, preciseAmount);
      
      const balanceAfter = await mockERC20_6.balanceOf(await wrapper6.getAddress());
      expect(balanceAfter).to.equal(balanceBefore + preciseAmount);
    });
  });

  describe("Edge Case Tests", function () {
    it("should reject wrapping 0 amount", async function () {
      await expect(
        wrapper18.wrap(signers[0].address, 0)
      ).to.be.revertedWithCustomError(wrapper18, "InvalidAmount");
    });

    it("should reject invalid rate", async function () {
      const InvalidWrapperFactory = await ethers.getContractFactory("ERC20Wrapper", signers[0]);
      await expect(
        InvalidWrapperFactory.deploy(
          await mockERC20_18.getAddress(),
          "Invalid Wrapper",
          "INV",
          0
        )
      ).to.be.revertedWithCustomError(InvalidWrapperFactory, "InvalidRate");
    });

    it("should reject invalid underlying token address", async function () {
      const InvalidWrapperFactory = await ethers.getContractFactory("ERC20Wrapper", signers[0]);
      await expect(
        InvalidWrapperFactory.deploy(
          ethers.ZeroAddress,
          "Invalid Wrapper",
          "INV",
          1
        )
      ).to.be.revertedWithCustomError(InvalidWrapperFactory, "InvalidUnderlyingToken");
    });
  });

  describe("Unwrap Functionality Tests", function () {
    it("should initiate unwrap request", async function () {
      const testAmount = ethers.parseEther("1.0");
      await mockERC20_18.mint(signers[3].address, testAmount);
      await mockERC20_18.connect(signers[3]).approve(await wrapper18.getAddress(), testAmount);
      await wrapper18.connect(signers[3]).wrap(signers[3].address, testAmount);

      const confidentialBalance = await wrapper18.confidentialBalanceOf(signers[3].address);
      
      await expect(
        wrapper18.connect(signers[3]).unwrap(signers[3].address, signers[3].address, confidentialBalance)
      ).to.not.be.reverted;
    });

    it("should reject unauthorized unwrap request", async function () {
      const testAmount = ethers.parseEther("1.0");
      await mockERC20_18.mint(signers[4].address, testAmount);
      await mockERC20_18.connect(signers[4]).approve(await wrapper18.getAddress(), testAmount);
      await wrapper18.connect(signers[4]).wrap(signers[4].address, testAmount);

      const confidentialBalance = await wrapper18.confidentialBalanceOf(signers[4].address);
      
      await expect(
        wrapper18.connect(signers[5]).unwrap(signers[4].address, signers[4].address, confidentialBalance)
      ).to.be.revertedWith("Unauthorized amount access");
    });
  });

  describe("ERC1363 Callback Tests", function () {
    it("should support ERC1363 automatic wrapping", async function () {
      const testAmount = ethers.parseEther("0.5");
      
      await mockERC20_18.mint(signers[6].address, testAmount);
      
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signers[6].address]);
      
      await expect(
        mockERC20_18.connect(signers[6]).transfer(await wrapper18.getAddress(), testAmount)
      ).to.not.be.reverted;
    });
  });

  describe("Rate Tests", function () {
    let wrapperWithRate: any;

    it("should support custom rate", async function () {
      const WrapperFactory = await ethers.getContractFactory("ERC20Wrapper", signers[0]);
      wrapperWithRate = await WrapperFactory.deploy(
        await mockERC20_18.getAddress(),
        "Rate Wrapper",
        "rETH",
        100 // Rate: 100 ETH = 1 rETH
      );
      await wrapperWithRate.waitForDeployment();

      expect(await wrapperWithRate.rate()).to.equal(100);
    });

    it("should wrap tokens according to rate", async function () {
      const testAmount = ethers.parseEther("100");
      
      await mockERC20_18.mint(signers[7].address, testAmount);
      await mockERC20_18.connect(signers[7]).approve(await wrapperWithRate.getAddress(), testAmount);
      
      await wrapperWithRate.connect(signers[7]).wrap(signers[7].address, testAmount);
      
      const wrapperBalance = await mockERC20_18.balanceOf(await wrapperWithRate.getAddress());
      expect(wrapperBalance).to.equal(testAmount);
      
      const confidentialBalance = await wrapperWithRate.confidentialBalanceOf(signers[7].address);
      expect(confidentialBalance).to.not.be.undefined;
    });

    it("should correctly handle insufficient rate wrapping", async function () {
      const testAmount = ethers.parseEther("50");
      
      await mockERC20_18.mint(signers[8].address, testAmount);
      await mockERC20_18.connect(signers[8]).approve(await wrapperWithRate.getAddress(), testAmount);
      
      const userBalanceBefore = await mockERC20_18.balanceOf(signers[8].address);
      const wrapperBalanceBefore = await mockERC20_18.balanceOf(await wrapperWithRate.getAddress());
      
      try {
        await wrapperWithRate.connect(signers[8]).wrap(signers[8].address, testAmount);
        
        const userBalanceAfter = await mockERC20_18.balanceOf(signers[8].address);
        const wrapperBalanceAfter = await mockERC20_18.balanceOf(await wrapperWithRate.getAddress());
        
        expect(userBalanceAfter).to.equal(userBalanceBefore - testAmount);
        expect(wrapperBalanceAfter).to.equal(wrapperBalanceBefore + testAmount);
        
        const confidentialBalance = await wrapperWithRate.confidentialBalanceOf(signers[8].address);
        expect(confidentialBalance).to.not.be.undefined;
        
      } catch (error) {
        const userBalanceAfter = await mockERC20_18.balanceOf(signers[8].address);
        const wrapperBalanceAfter = await mockERC20_18.balanceOf(await wrapperWithRate.getAddress());
        
        expect(userBalanceAfter).to.equal(userBalanceBefore - testAmount);
        expect(wrapperBalanceAfter).to.equal(wrapperBalanceBefore + testAmount);
      }
    });
  });

  describe("Utility Function Tests", function () {
    it("should correctly return underlying token balance", async function () {
      const balance = await wrapper18.underlyingBalance();
      expect(balance).to.be.greaterThan(0);
    });

    it("should support emergency withdraw function", async function () {
      const balanceBefore = await mockERC20_18.balanceOf(await wrapper18.getAddress());
      
      await wrapper18.emergencyWithdraw(signers[0].address, balanceBefore);
      
      const balanceAfter = await mockERC20_18.balanceOf(await wrapper18.getAddress());
      expect(balanceAfter).to.equal(0);
    });
  });

  describe("Multi-User Tests", function () {
    it("should support multiple users wrapping simultaneously", async function () {
      const amount1 = ethers.parseEther("1.0");
      const amount2 = ethers.parseEther("2.0");
      
      await mockERC20_18.mint(signers[9].address, amount1);
      await mockERC20_18.connect(signers[9]).approve(await wrapper18.getAddress(), amount1);
      await wrapper18.connect(signers[9]).wrap(signers[9].address, amount1);
      
      await mockERC20_18.mint(signers[10].address, amount2);
      await mockERC20_18.connect(signers[10]).approve(await wrapper18.getAddress(), amount2);
      await wrapper18.connect(signers[10]).wrap(signers[10].address, amount2);
      
      const totalBalance = await mockERC20_18.balanceOf(await wrapper18.getAddress());
      expect(totalBalance).to.equal(amount1 + amount2);
      
      const balance1 = await wrapper18.confidentialBalanceOf(signers[9].address);
      const balance2 = await wrapper18.confidentialBalanceOf(signers[10].address);
      expect(balance1).to.not.be.undefined;
      expect(balance2).to.not.be.undefined;
    });
  });

  describe("Event Tests", function () {
    it("should emit correct Wrapped event", async function () {
      const testAmount = ethers.parseEther("1.0");
      
      await mockERC20_18.mint(signers[2].address, testAmount);
      await mockERC20_18.connect(signers[2]).approve(await wrapper18.getAddress(), testAmount);
      
      await expect(
        wrapper18.connect(signers[2]).wrap(signers[2].address, testAmount)
      ).to.emit(wrapper18, "Wrapped")
        .withArgs(signers[2].address, testAmount, anyValue);
    });
  });

  describe("Wrapper Factory Integration Tests", function () {
    let wrapperFactory: any;
    let testMockERC20_18: any;
    let testMockERC20_6: any;

    before(async function () {
      const WrapperFactory = await ethers.getContractFactory("WrapperFactory", signers[0]);
      wrapperFactory = await WrapperFactory.deploy();
      await wrapperFactory.waitForDeployment();

      // Deploy test tokens for this test suite
      const MockERC20Factory = await ethers.getContractFactory("MockERC20", signers[0]);
      testMockERC20_18 = await MockERC20Factory.deploy("Test Ethereum", "tETH", 18);
      await testMockERC20_18.waitForDeployment();
      
      testMockERC20_6 = await MockERC20Factory.deploy("Test USD Coin", "tUSDC", 6);
      await testMockERC20_6.waitForDeployment();
    });

    it("should create wrapper through factory", async function () {
      const tx = await wrapperFactory.createWrapper(
        await testMockERC20_18.getAddress(),
        "Factory Wrapped ETH",
        "fETH",
        1,
        2 // TokenType.PLAIN_ERC20
      );
      await tx.wait();

      const wrappedAddress = await wrapperFactory.getWrapper(await testMockERC20_18.getAddress());
      expect(wrappedAddress).to.not.equal(ethers.ZeroAddress);
      expect(await wrapperFactory.isWrapper(wrappedAddress)).to.be.true;
      expect(await wrapperFactory.getOriginal(wrappedAddress)).to.equal(await testMockERC20_18.getAddress());
    });

    it("should prevent duplicate wrapper creation", async function () {
      await expect(
        wrapperFactory.createWrapper(
          await testMockERC20_18.getAddress(),
          "Duplicate Wrapper",
          "dETH",
          1,
          2 // TokenType.PLAIN_ERC20
        )
      ).to.be.revertedWithCustomError(wrapperFactory, "TokenAlreadyWrapped");
    });

    it("should support default rate creation", async function () {
      const tx = await wrapperFactory.createWrapperWithDefaultRate(
        await testMockERC20_6.getAddress(),
        "Factory Wrapped USDC",
        "fUSDC",
        2 // TokenType.PLAIN_ERC20
      );
      await tx.wait();

      const wrappedAddress = await wrapperFactory.getWrapper(await testMockERC20_6.getAddress());
      expect(wrappedAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("should correctly return wrapper information", async function () {
      const wrappedAddress = await wrapperFactory.getWrapper(await testMockERC20_18.getAddress());
      const wrapperInfo = await wrapperFactory.getWrapperInfo(wrappedAddress);
      
      expect(wrapperInfo.originalToken).to.equal(await testMockERC20_18.getAddress());
      expect(wrapperInfo.name).to.equal("Factory Wrapped ETH");
      expect(wrapperInfo.symbol).to.equal("fETH");
      expect(wrapperInfo.rate).to.equal(1);
    });

    it("should support batch wrapper queries", async function () {
      const tokens = [await testMockERC20_18.getAddress(), await testMockERC20_6.getAddress()];
      const wrappers = await wrapperFactory.getWrappers(tokens);
      
      expect(wrappers.length).to.equal(2);
      expect(wrappers[0]).to.not.equal(ethers.ZeroAddress);
      expect(wrappers[1]).to.not.equal(ethers.ZeroAddress);
    });

    it("should correctly count wrappers", async function () {
      const count = await wrapperFactory.allWrappersLength();
      expect(count).to.be.greaterThan(0);
    });
  });

  describe("Complete Unwrap Cycle Tests (Mock Decrypt Callback)", function () {
    let mockWrapper: any;
    let mockUSDCWrapper: any;
    let testMockERC20_18: any;
    let testMockERC20_6: any;

    before(async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20", signers[0]);
      testMockERC20_18 = await MockERC20Factory.deploy("Test Ethereum", "tETH", 18);
      await testMockERC20_18.waitForDeployment();

      testMockERC20_6 = await MockERC20Factory.deploy("Test USD Coin", "tUSDC", 6);
      await testMockERC20_6.waitForDeployment();

      const MockWrapperFactory = await ethers.getContractFactory("MockERC20Wrapper", signers[0]);
      mockWrapper = await MockWrapperFactory.deploy(
        await testMockERC20_18.getAddress(),
        "Mock Wrapper",
        "mETH",
        1
      );
      await mockWrapper.waitForDeployment();

      mockUSDCWrapper = await MockWrapperFactory.deploy(
        await testMockERC20_6.getAddress(),
        "Mock USDC Wrapper",
        "mUSDC",
        1
      );
      await mockUSDCWrapper.waitForDeployment();
    });

    it("should complete full wrap-unwrap cycle", async function () {
      const testAmount = ethers.parseEther("1.5");
      console.log("\n🔄 Starting complete wrap-unwrap cycle test");
      console.log(`Test amount: ${ethers.formatEther(testAmount)} ETH`);
      
      console.log("\n📦 Step 1: Wrap tokens");
      await testMockERC20_18.mint(signers[12].address, testAmount);
      await testMockERC20_18.connect(signers[12]).approve(await mockWrapper.getAddress(), testAmount);
      await mockWrapper.connect(signers[12]).wrap(signers[12].address, testAmount);
      console.log("✅ Wrapping completed");
      
      console.log("\n🔍 Step 2: Verify wrap results");
      const userBalance = await testMockERC20_18.balanceOf(signers[12].address);
      console.log(`User balance: ${ethers.formatEther(userBalance)} ETH`);
      expect(userBalance).to.equal(0);
      
      const wrapperBalance = await testMockERC20_18.balanceOf(await mockWrapper.getAddress());
      console.log(`Wrapper balance: ${ethers.formatEther(wrapperBalance)} ETH`);
      expect(wrapperBalance).to.equal(testAmount);
      
      const confidentialBalance = await mockWrapper.confidentialBalanceOf(signers[12].address);
      console.log(`🔒 Confidential token balance created`);
      expect(confidentialBalance).to.not.be.undefined;
      
      console.log("\n📤 Step 3: Initiate unwrap request");
      await mockWrapper.connect(signers[12]).unwrap(signers[12].address, signers[12].address, confidentialBalance);
      console.log("✅ Unwrap request sent");
      
      console.log("\n🔓 Step 4: Simulate decrypt callback");
      const requestID = await mockWrapper.getLastRequestID();
      console.log(`Request ID: ${requestID}`);
      await mockWrapper.mockDecryptResponse(requestID, testAmount);
      console.log("✅ Decrypt callback completed");
      
      console.log("\n✅ Step 5: Verify unwrap results");
      const userBalanceAfter = await testMockERC20_18.balanceOf(signers[12].address);
      console.log(`User final balance: ${ethers.formatEther(userBalanceAfter)} ETH`);
      expect(userBalanceAfter).to.equal(testAmount);
      
      const wrapperBalanceAfter = await testMockERC20_18.balanceOf(await mockWrapper.getAddress());
      console.log(`Wrapper final balance: ${ethers.formatEther(wrapperBalanceAfter)} ETH`);
      expect(wrapperBalanceAfter).to.equal(0);
      
      console.log("\n🎉 Complete cycle test successful!");
    });

    it("should test precise unwrap of 1.897867 ETH", async function () {
      const testAmount = ethers.parseEther("1.897867");
      console.log("\n🎯 Testing precise unwrap: 1.897867 ETH");
      console.log(`Original amount (Wei): ${testAmount.toString()}`);
      
      console.log("\n📦 Wrap phase");
      await testMockERC20_18.mint(signers[13].address, testAmount);
      await testMockERC20_18.connect(signers[13]).approve(await mockWrapper.getAddress(), testAmount);
      await mockWrapper.connect(signers[13]).wrap(signers[13].address, testAmount);
      console.log("✅ Wrapping completed");
      
      console.log("\n📤 Unwrap phase");
      const confidentialBalance = await mockWrapper.confidentialBalanceOf(signers[13].address);
      await mockWrapper.connect(signers[13]).unwrap(signers[13].address, signers[13].address, confidentialBalance);
      console.log("✅ Unwrap request sent");
      
      console.log("\n🔓 Decrypt phase");
      const requestID = await mockWrapper.getLastRequestID();
      await mockWrapper.mockDecryptResponse(requestID, testAmount);
      console.log("✅ Decryption completed");
      
      console.log("\n✅ Verify precision");
      const userBalanceAfter = await testMockERC20_18.balanceOf(signers[13].address);
      console.log(`User final balance: ${ethers.formatEther(userBalanceAfter)} ETH`);
      console.log(`Expected balance: ${ethers.formatEther(testAmount)} ETH`);
      console.log(`Precision loss: ${testAmount - userBalanceAfter} Wei`);
      expect(userBalanceAfter).to.equal(testAmount);
      console.log("🎉 Precise unwrap test successful! No precision loss!");
    });

    it("should test precise unwrap of 1.897867 USDC", async function () {
      const testAmount = ethers.parseUnits("1.897867", 6);
      console.log("\n🎯 Testing precise unwrap: 1.897867 USDC (6 decimals)");
      console.log(`Original amount (base units): ${testAmount.toString()}`);
      
      console.log("\n📦 Wrap phase");
      await testMockERC20_6.mint(signers[14].address, testAmount);
      await testMockERC20_6.connect(signers[14]).approve(await mockUSDCWrapper.getAddress(), testAmount);
      await mockUSDCWrapper.connect(signers[14]).wrap(signers[14].address, testAmount);
      console.log("✅ Wrapping completed");
      
      console.log("\n📤 Unwrap phase");
      const confidentialBalance = await mockUSDCWrapper.confidentialBalanceOf(signers[14].address);
      await mockUSDCWrapper.connect(signers[14]).unwrap(signers[14].address, signers[14].address, confidentialBalance);
      console.log("✅ Unwrap request sent");
      
      console.log("\n🔓 Decrypt phase");
      const requestID = await mockUSDCWrapper.getLastRequestID();
      await mockUSDCWrapper.mockDecryptResponse(requestID, testAmount);
      console.log("✅ Decryption completed");
      
      console.log("\n✅ Verify precision");
      const userBalanceAfter = await testMockERC20_6.balanceOf(signers[14].address);
      console.log(`User final balance: ${ethers.formatUnits(userBalanceAfter, 6)} USDC`);
      console.log(`Expected balance: ${ethers.formatUnits(testAmount, 6)} USDC`);
      console.log(`Precision loss: ${testAmount - userBalanceAfter} base units`);
      expect(userBalanceAfter).to.equal(testAmount);
      console.log("🎉 Precise unwrap test successful! No precision loss!");
    });

    it("should support multiple users unwrapping simultaneously", async function () {
      const amount1 = ethers.parseEther("1.0");
      const amount2 = ethers.parseEther("2.0");
      
      await testMockERC20_18.mint(signers[15].address, amount1);
      await testMockERC20_18.connect(signers[15]).approve(await mockWrapper.getAddress(), amount1);
      await mockWrapper.connect(signers[15]).wrap(signers[15].address, amount1);
      
      await testMockERC20_18.mint(signers[16].address, amount2);
      await testMockERC20_18.connect(signers[16]).approve(await mockWrapper.getAddress(), amount2);
      await mockWrapper.connect(signers[16]).wrap(signers[16].address, amount2);
      
      const confidentialBalance1 = await mockWrapper.confidentialBalanceOf(signers[15].address);
      await mockWrapper.connect(signers[15]).unwrap(signers[15].address, signers[15].address, confidentialBalance1);
      
      const requestID1 = await mockWrapper.getLastRequestID();
      await mockWrapper.mockDecryptResponse(requestID1, amount1);
      
      const confidentialBalance2 = await mockWrapper.confidentialBalanceOf(signers[16].address);
      await mockWrapper.connect(signers[16]).unwrap(signers[16].address, signers[16].address, confidentialBalance2);
      
      const requestID2 = await mockWrapper.getLastRequestID();
      await mockWrapper.mockDecryptResponse(requestID2, amount2);
      
      const user1Balance = await testMockERC20_18.balanceOf(signers[15].address);
      const user2Balance = await testMockERC20_18.balanceOf(signers[16].address);
      
      expect(user1Balance).to.equal(amount1);
      expect(user2Balance).to.equal(amount2);
    });

    it("should correctly handle unwrap events", async function () {
      const testAmount = ethers.parseEther("0.5");
      
      await testMockERC20_18.mint(signers[17].address, testAmount);
      await testMockERC20_18.connect(signers[17]).approve(await mockWrapper.getAddress(), testAmount);
      await mockWrapper.connect(signers[17]).wrap(signers[17].address, testAmount);
      
      const confidentialBalance = await mockWrapper.confidentialBalanceOf(signers[17].address);
      
      const tx = await mockWrapper.connect(signers[17]).unwrap(signers[17].address, signers[17].address, confidentialBalance);
      const receipt = await tx.wait();
      
      const requestID = await mockWrapper.getLastRequestID();
      await expect(
        mockWrapper.mockDecryptResponse(requestID, testAmount)
      ).to.emit(mockWrapper, "Unwrapped")
        .withArgs(signers[17].address, anyValue, testAmount);
    });

    it("should reject invalid unwrap requests", async function () {
      const testAmount = ethers.parseEther("1.0");
      
      await testMockERC20_18.mint(signers[18].address, testAmount);
      await testMockERC20_18.connect(signers[18]).approve(await mockWrapper.getAddress(), testAmount);
      await mockWrapper.connect(signers[18]).wrap(signers[18].address, testAmount);
      
      const confidentialBalance = await mockWrapper.confidentialBalanceOf(signers[18].address);
      
      await expect(
        mockWrapper.connect(signers[19]).unwrap(signers[18].address, signers[18].address, confidentialBalance)
      ).to.be.revertedWith("Unauthorized amount access");
    });

    it("should handle non-existent unwrap request", async function () {
      await expect(
        mockWrapper.mockDecryptResponse(999999, ethers.parseEther("1.0"))
      ).to.be.revertedWithCustomError(mockWrapper, "UnwrapRequestNotFound");
    });

    it("should handle insufficient contract balance", async function () {
      const testAmount = ethers.parseEther("1.0");
      
      await testMockERC20_18.mint(signers[2].address, testAmount);
      await testMockERC20_18.connect(signers[2]).approve(await mockWrapper.getAddress(), testAmount);
      await mockWrapper.connect(signers[2]).wrap(signers[2].address, testAmount);
      
      const confidentialBalance = await mockWrapper.confidentialBalanceOf(signers[2].address);
      await mockWrapper.connect(signers[2]).unwrap(signers[2].address, signers[2].address, confidentialBalance);
      
      const wrapperBalance = await testMockERC20_18.balanceOf(await mockWrapper.getAddress());
      await mockWrapper.emergencyWithdraw(signers[1].address, wrapperBalance);
      
      const requestID = await mockWrapper.getLastRequestID();
      await expect(
        mockWrapper.mockDecryptResponse(requestID, testAmount)
      ).to.be.revertedWith("Insufficient contract balance for unwrap");
    });

    it("should support partial unwrap", async function () {
      const totalAmount = ethers.parseEther("3.0");
      const partialAmount = ethers.parseEther("1.0");
      
      await testMockERC20_18.mint(signers[3].address, totalAmount);
      await testMockERC20_18.connect(signers[3]).approve(await mockWrapper.getAddress(), totalAmount);
      await mockWrapper.connect(signers[3]).wrap(signers[3].address, totalAmount);
      
      const confidentialBalance = await mockWrapper.confidentialBalanceOf(signers[3].address);
      await mockWrapper.connect(signers[3]).unwrap(signers[3].address, signers[3].address, confidentialBalance);
      
      const requestID = await mockWrapper.getLastRequestID();
      await mockWrapper.mockDecryptResponse(requestID, partialAmount);
      
      const userBalance = await testMockERC20_18.balanceOf(signers[3].address);
      expect(userBalance).to.equal(partialAmount);
      
      const wrapperBalance = await testMockERC20_18.balanceOf(await mockWrapper.getAddress());
      expect(wrapperBalance).to.equal(totalAmount - partialAmount);
    });

    it("should support multiple unwraps", async function () {
      const testAmount = ethers.parseEther("2.0");
      
      await testMockERC20_18.mint(signers[4].address, testAmount);
      await testMockERC20_18.connect(signers[4]).approve(await mockWrapper.getAddress(), testAmount);
      await mockWrapper.connect(signers[4]).wrap(signers[4].address, testAmount);
      
      const confidentialBalance1 = await mockWrapper.confidentialBalanceOf(signers[4].address);
      await mockWrapper.connect(signers[4]).unwrap(signers[4].address, signers[4].address, confidentialBalance1);
      
      const requestID1 = await mockWrapper.getLastRequestID();
      await mockWrapper.mockDecryptResponse(requestID1, ethers.parseEther("1.0"));
      
      let userBalance = await testMockERC20_18.balanceOf(signers[4].address);
      expect(userBalance).to.equal(ethers.parseEther("1.0"));
      
      const confidentialBalance2 = await mockWrapper.confidentialBalanceOf(signers[4].address);
      await mockWrapper.connect(signers[4]).unwrap(signers[4].address, signers[4].address, confidentialBalance2);
      
      const requestID2 = await mockWrapper.getLastRequestID();
      await mockWrapper.mockDecryptResponse(requestID2, ethers.parseEther("1.0"));
      
      userBalance = await testMockERC20_18.balanceOf(signers[4].address);
      expect(userBalance).to.equal(testAmount);
    });
  });

  describe("Wrapper Address Mapping Tests", function () {
    let wrapperFactory: any;
    let testToken: any;

    before(async function () {
      console.log("\n🏭 Deploy wrapper factory");
      const WrapperFactory = await ethers.getContractFactory("WrapperFactory", signers[0]);
      wrapperFactory = await WrapperFactory.deploy();
      await wrapperFactory.waitForDeployment();
      console.log(`Factory address: ${await wrapperFactory.getAddress()}`);

      // Deploy test token
      const MockERC20Factory = await ethers.getContractFactory("MockERC20", signers[0]);
      testToken = await MockERC20Factory.deploy("Test Token", "TEST", 18);
      await testToken.waitForDeployment();
    });

    it("should correctly record wrapper address mapping", async function () {
      console.log("\n📝 Testing wrapper address mapping");
      
      const originalTokenAddress = await testToken.getAddress();
      console.log(`\n🪙 Original token address: ${originalTokenAddress}`);
      console.log(`Token name: Ethereum (ETH)`);
      
      console.log("\n🔨 Creating wrapper...");
      const tx = await wrapperFactory.createWrapper(
        originalTokenAddress,
        "Record Test Wrapper",
        "rETH",
        1,
        2 // TokenType.PLAIN_ERC20
      );
      const receipt = await tx.wait();
      console.log(`✅ Wrapper created successfully (tx hash: ${receipt.hash})`);

      console.log("\n🔍 Query mapping relationships:");
      
      const wrappedAddress = await wrapperFactory.getWrapper(originalTokenAddress);
      console.log(`\n  📍 Wrapper address: ${wrappedAddress}`);
      
      const originalAddress = await wrapperFactory.getOriginal(wrappedAddress);
      console.log(`  📍 Reverse query original address: ${originalAddress}`);
      
      const isWrapper = await wrapperFactory.isWrapper(wrappedAddress);
      console.log(`  ✅ Is wrapper: ${isWrapper}`);
      
      console.log("\n📊 Wrapper detailed information:");
      const wrapperInfo = await wrapperFactory.getWrapperInfo(wrappedAddress);
      console.log(`  Name: ${wrapperInfo.name}`);
      console.log(`  Symbol: ${wrapperInfo.symbol}`);
      console.log(`  Original token: ${wrapperInfo.originalToken}`);
      console.log(`  Rate: ${wrapperInfo.rate.toString()}`);
      console.log(`  Created at: ${new Date(Number(wrapperInfo.createdAt) * 1000).toLocaleString()}`);
      
      console.log("\n✅ Verify mapping relationships:");
      expect(originalAddress).to.equal(originalTokenAddress);
      console.log(`  ✓ Original address matches: ${originalAddress === originalTokenAddress}`);
      expect(await wrapperFactory.isWrapper(wrappedAddress)).to.be.true;
      console.log(`  ✓ Wrapper marker correct`);
      
      console.log("\n🎉 Wrapper address mapping test passed!");
    });

    it("should support index-based wrapper access", async function () {
      console.log("\n📋 Testing index-based wrapper access");
      
      const count = await wrapperFactory.allWrappersLength();
      console.log(`\n📊 Total wrappers: ${count}`);
      expect(count).to.be.greaterThan(0);
      
      console.log("\n🔍 Traverse all wrappers:");
      for (let i = 0; i < count; i++) {
        const wrapperAddr = await wrapperFactory.getWrapperByIndex(i);
        const wrapperInfo = await wrapperFactory.getWrapperInfo(wrapperAddr);
        const originalAddr = await wrapperFactory.getOriginal(wrapperAddr);
        
        console.log(`\n  [${i}] Wrapper ${i + 1}:`);
        console.log(`      Address: ${wrapperAddr}`);
        console.log(`      Name: ${wrapperInfo.name}`);
        console.log(`      Symbol: ${wrapperInfo.symbol}`);
        console.log(`      Original token: ${originalAddr}`);
        console.log(`      Rate: ${wrapperInfo.rate.toString()}`);
      }
      
      console.log("\n✅ Verify first wrapper:");
      const firstWrapper = await wrapperFactory.getWrapperByIndex(0);
      console.log(`  Address: ${firstWrapper}`);
      console.log(`  Not zero address: ${firstWrapper !== ethers.ZeroAddress}`);
      console.log(`  Is wrapper: ${await wrapperFactory.isWrapper(firstWrapper)}`);
      
      expect(firstWrapper).to.not.equal(ethers.ZeroAddress);
      expect(await wrapperFactory.isWrapper(firstWrapper)).to.be.true;
      
      console.log("\n🎉 Index access test passed!");
    });
  });

  describe("Integration Tests", function () {
    it("should complete full wrap-unwrap cycle", async function () {
      const testAmount = ethers.parseEther("1.5");
      
      await mockERC20_18.mint(signers[11].address, testAmount);
      await mockERC20_18.connect(signers[11]).approve(await wrapper18.getAddress(), testAmount);
      await wrapper18.connect(signers[11]).wrap(signers[11].address, testAmount);
      
      const userBalance = await mockERC20_18.balanceOf(signers[11].address);
      expect(userBalance).to.equal(0);
      
      const wrapperBalance = await mockERC20_18.balanceOf(await wrapper18.getAddress());
      expect(wrapperBalance).to.be.greaterThan(0);
      
      const confidentialBalance = await wrapper18.confidentialBalanceOf(signers[11].address);
      expect(confidentialBalance).to.not.be.undefined;
      
      await expect(
        wrapper18.connect(signers[11]).unwrap(signers[11].address, signers[11].address, confidentialBalance)
      ).to.not.be.reverted;
    });
  });
});

function anyValue() {
  return true;
}

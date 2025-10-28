import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";


describe("FHERouter Complete Precision Tests (6 decimals)", function () {
    this.timeout(180000);

    let user1: any, user2: any;
    let router: any, factory: any, wrapperFactory: any;
    let token18A: any, token18B: any, token6A: any, token6B: any;
    let routerAddr: string;

    before(async function () {
        if (!hre.fhevm.isMock) {
            throw new Error("❌ Must run in Mock environment");
        }
        await fhevm.initializeCLIApi();
        console.log("✅ FHEVM Mock initialized");
    });

    beforeEach(async function () {
        const signers = await ethers.getSigners();
        user1 = signers[0];
        user2 = signers[1];


        const FHEPairLib = await ethers.getContractFactory("FHEPairLib");
        const lib = await FHEPairLib.deploy();
        const libAddr = await lib.getAddress();

        const FHEFactory = await ethers.getContractFactory("FHEFactory", {
            libraries: { FHEPairLib: libAddr },
        });
        factory = await FHEFactory.deploy();

        const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
        wrapperFactory = await WrapperFactory.deploy();

        const TokenConverter = await ethers.getContractFactory("TokenConverter");
        const tokenConverter = await TokenConverter.deploy(
            "0x0000000000000000000000000000000000000001",
            await wrapperFactory.getAddress()
        );

        const FHERouterFactory = await ethers.getContractFactory("FHERouter", {
            libraries: { FHEPairLib: libAddr },
        });
        router = await FHERouterFactory.deploy(
            await wrapperFactory.getAddress(),
            await factory.getAddress(),
            await tokenConverter.getAddress()
        );
        routerAddr = await router.getAddress();


        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        
        token18A = await MockERC20Factory.deploy("Mock ETH", "mETH", 18);
        token18B = await MockERC20Factory.deploy("Mock DAI", "mDAI", 18);
        token6A = await MockERC20Factory.deploy("USDT", "USDT", 6);
        token6B = await MockERC20Factory.deploy("USDC", "USDC", 6);


        const mint18 = ethers.parseUnits("1000000", 18);
        const mint6 = ethers.parseUnits("1000000", 6);
        
        await token18A.mint(user1.address, mint18);
        await token18A.mint(user2.address, mint18);
        await token18B.mint(user1.address, mint18);
        await token18B.mint(user2.address, mint18);
        await token6A.mint(user1.address, mint6);
        await token6A.mint(user2.address, mint6);
        await token6B.mint(user1.address, mint6);
        await token6B.mint(user2.address, mint6);

        console.log("✅ Test infrastructure and tokens deployed");
    });


    it("truet", async function () {
      
        const amountETH = ethers.parseUnits("100.123456", 18);
        const amountDAI = ethers.parseUnits("200000.654321", 18);
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        console.log("  ETH:", ethers.formatUnits(amountETH, 18));
        console.log("  DAI:", ethers.formatUnits(amountDAI, 18));

        await token18A.connect(user1).approve(routerAddr, ethers.MaxUint256);
        await token18B.connect(user1).approve(routerAddr, ethers.MaxUint256);

        const tx = await router.connect(user1)["addLiquidity(address,address,uint256,uint256,address,uint256)"](
            await token18A.getAddress(),
            await token18B.getAddress(),
            amountETH,
            amountDAI,
            user1.address,
            deadline
        );
        await tx.wait();
        await fhevm.awaitDecryptionOracle();

      
    });

  
    it("jhgf", async function () {
       

        const amountUSDT = ethers.parseUnits("10000.123456", 6);
        const amountUSDC = ethers.parseUnits("10000.654321", 6);
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        console.log("  USDT:", ethers.formatUnits(amountUSDT, 6));
        console.log("  USDC:", ethers.formatUnits(amountUSDC, 6));

        await token6A.connect(user1).approve(routerAddr, ethers.MaxUint256);
        await token6B.connect(user1).approve(routerAddr, ethers.MaxUint256);

        const tx = await router.connect(user1)["addLiquidity(address,address,uint256,uint256,address,uint256)"](
            await token6A.getAddress(),
            await token6B.getAddress(),
            amountUSDT,
            amountUSDC,
            user1.address,
            deadline
        );
        await tx.wait();
        await fhevm.awaitDecryptionOracle();

      
    });

   
    it("jhg", async function () {
      

        const deadline = Math.floor(Date.now() / 1000) + 3600;

  

        const ethLiquidity = ethers.parseUnits("100", 18);
        const usdtLiquidity = ethers.parseUnits("200000", 6);

        await token18A.connect(user1).approve(routerAddr, ethers.MaxUint256);
        await token6A.connect(user1).approve(routerAddr, ethers.MaxUint256);

        const addTx = await router.connect(user1)["addLiquidity(address,address,uint256,uint256,address,uint256)"](
            await token18A.getAddress(),
            await token6A.getAddress(),
            ethLiquidity,
            usdtLiquidity,
            user1.address,
            deadline
        );
        await addTx.wait();
        await fhevm.awaitDecryptionOracle();
       
        console.log("\n  Step 2: Swap ETH → USDT");
        const swapAmount = ethers.parseUnits("1.123456", 18);
        console.log("  Swap:", ethers.formatUnits(swapAmount, 18), "ETH");

        await token18A.connect(user2).approve(routerAddr, ethers.MaxUint256);

        const swapTx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
            await token18A.getAddress(),
            await token6A.getAddress(),
            swapAmount,
            50,
            user2.address,
            deadline
        );
        await swapTx.wait();
        await fhevm.awaitDecryptionOracle();
       
        const wrappedUSDT = await wrapperFactory.getWrapper(await token6A.getAddress());
        const wrapped = await ethers.getContractAt("ERC20Wrapper", wrappedUSDT);
        const balance = await fhevm.userDecryptEuint(
            FhevmType.euint64,
            await wrapped.confidentialBalanceOf(user2.address),
            wrappedUSDT,
            user2
        );
        
    
        expect(balance).to.be.gt(0);
      
    });

    it("jhg", async function () {
        

        const deadline = Math.floor(Date.now() / 1000) + 3600;

     
   
        await token18A.connect(user1).approve(routerAddr, ethers.MaxUint256);
        await token18B.connect(user1).approve(routerAddr, ethers.MaxUint256);

        const addTx = await router.connect(user1)["addLiquidity(address,address,uint256,uint256,address,uint256)"](
            await token18A.getAddress(),
            await token18B.getAddress(),
            ethers.parseUnits("100", 18),
            ethers.parseUnits("200000", 18),
            user1.address,
            deadline
        );
        await addTx.wait();
        await fhevm.awaitDecryptionOracle();
      
        await token18A.connect(user2).approve(routerAddr, ethers.MaxUint256);

        const swapTx = await router.connect(user2)["swapTokens(address,address,uint256,uint16,address,uint256)"](
            await token18A.getAddress(),
            await token18B.getAddress(),
            ethers.parseUnits("1", 18),
            50,
            user2.address,
            deadline
        );
        await swapTx.wait();
        await fhevm.awaitDecryptionOracle();
       
        const wrappedETH = await wrapperFactory.getWrapper(await token18A.getAddress());
        const wrappedDAI = await wrapperFactory.getWrapper(await token18B.getAddress());
        const pairAddr = await factory.getPair(wrappedETH, wrappedDAI);
        const pair = await ethers.getContractAt("FHEPair", pairAddr);

        const lpBalance = await fhevm.userDecryptEuint(
            FhevmType.euint64,
            await pair.confidentialBalanceOf(user1.address),
            pairAddr,
            user1
        );
        console.log("  LP Balance:", ethers.formatUnits(lpBalance.toString(), 6));

        await pair.connect(user1).setOperator(routerAddr, deadline);

        const removeInput = await fhevm.createEncryptedInput(routerAddr, user1.address)
            .add64(Number(lpBalance) / 2)
            .encrypt();

        const removeTx = await router.connect(user1)["removeLiquidity(address,address,bytes32,bytes,address,uint256)"](
            await token18A.getAddress(),
            await token18B.getAddress(),
            removeInput.handles[0],
            removeInput.inputProof,
            user1.address,
            deadline
        );
        await removeTx.wait();
        await fhevm.awaitDecryptionOracle();
       
        const wrappedDAIContract = await ethers.getContractAt("ERC20Wrapper", wrappedDAI);
        const wrappedDAIBalance = await fhevm.userDecryptEuint(
            FhevmType.euint64,
            await wrappedDAIContract.confidentialBalanceOf(user2.address),
            wrappedDAI,
            user2
        );

        if (wrappedDAIBalance > 0n) {
            const unwrapInput = await fhevm.createEncryptedInput(wrappedDAI, user2.address)
                .add64(Number(wrappedDAIBalance))
                .encrypt();

            await wrappedDAIContract.connect(user2).unwrapWithProof(
                user2.address,
                user2.address,
                unwrapInput.handles[0],
                unwrapInput.inputProof
            );
            await fhevm.awaitDecryptionOracle();
           
        }

        
    });

    it("jhgf", async function () {
      
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        const amount9Decimals = ethers.parseUnits("100.123456789", 18);
       

        await token18A.connect(user1).approve(routerAddr, ethers.MaxUint256);
        await token18B.connect(user1).approve(routerAddr, ethers.MaxUint256);

        const tx = await router.connect(user1)["addLiquidity(address,address,uint256,uint256,address,uint256)"](
            await token18A.getAddress(),
            await token18B.getAddress(),
            amount9Decimals,
            amount9Decimals,
            user1.address,
            deadline
        );
        await tx.wait();
        await fhevm.awaitDecryptionOracle();

       
    });
});


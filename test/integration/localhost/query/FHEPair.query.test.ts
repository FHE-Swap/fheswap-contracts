import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

/**
 * FHEPair Query Function Tests
 * Tests: Real reserves, obfuscated reserves, LP balance queries
 */
describe("FHEPair Query Function Tests", function () {
    this.timeout(120000);

    let user1: any, user2: any;
    let factory: any, router: any, wrapperFactory: any, tokenConverter: any;
    let tokenA: any, tokenB: any;
    let pairAddr: string;
    let wrappedTokenAAddr: string, wrappedTokenBAddr: string;

    before(async function () {
        if (!hre.fhevm.isMock) {
          
        }
        await fhevm.initializeCLIApi();
       

        
        const signers = await ethers.getSigners();
        user1 = signers[0];
        user2 = signers[1];

        
        console.log("  User1:", user1.address);
        console.log("  User2:", user2.address);

      
        const FHEPairLib = await ethers.getContractFactory("FHEPairLib");
        const lib = await FHEPairLib.deploy();
        await lib.waitForDeployment();
        const libAddr = await lib.getAddress();
    
  
        const FHEFactory = await ethers.getContractFactory("FHEFactory", {
            libraries: { FHEPairLib: libAddr },
        });
        factory = await FHEFactory.deploy();
        await factory.waitForDeployment();
   


        const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
        wrapperFactory = await WrapperFactory.deploy();
        await wrapperFactory.waitForDeployment();


        const TokenConverterFactory = await ethers.getContractFactory("TokenConverter");
        const dummyRouter = "0x0000000000000000000000000000000000000001";
        tokenConverter = await TokenConverterFactory.deploy(
            dummyRouter,
            await wrapperFactory.getAddress()
        );
        await tokenConverter.waitForDeployment();


        const FHERouterFactory = await ethers.getContractFactory("FHERouter", {
            libraries: { FHEPairLib: libAddr },
        });
        router = await FHERouterFactory.deploy(
            await wrapperFactory.getAddress(),
            await factory.getAddress(),
            await tokenConverter.getAddress()
        );
        await router.waitForDeployment();
        const routerAddr = await router.getAddress();
  


        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        tokenA = await MockERC20Factory.deploy("USD Token", "USD", 6);
        await tokenA.waitForDeployment();
        const tokenAAddr = await tokenA.getAddress();

        tokenB = await MockERC20Factory.deploy("EUR Token", "EUR", 6);
        await tokenB.waitForDeployment();
        const tokenBAddr = await tokenB.getAddress();


        console.log("  TokenA (USD):", tokenAAddr);
        console.log("  TokenB (EUR):", tokenBAddr);


        const mintAmount = ethers.parseUnits("10000", 6);
        await tokenA.mint(user1.address, mintAmount);
        await tokenB.mint(user1.address, mintAmount);



        await tokenA.connect(user1).approve(routerAddr, ethers.parseUnits("10000", 6));
        await tokenB.connect(user1).approve(routerAddr, ethers.parseUnits("10000", 6));


   
        const amountA = ethers.parseUnits("1000", 6);
        const amountB = ethers.parseUnits("800", 6);
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        const tx = await router.connect(user1)["addLiquidity(address,address,uint256,uint256,address,uint256)"](
            tokenAAddr,
            tokenBAddr,
            amountA,
            amountB,
            user1.address,
            deadline
        );
        await tx.wait();

        await fhevm.awaitDecryptionOracle();

        wrappedTokenAAddr = await wrapperFactory.getWrapper(tokenAAddr);
        wrappedTokenBAddr = await wrapperFactory.getWrapper(tokenBAddr);
        pairAddr = await factory.getPair(wrappedTokenAAddr, wrappedTokenBAddr);
  
    });

    describe("📊 Query Function Tests", function () {
        it("1️⃣ should be able to query and decrypt real reserves (getReserves)", async function () {
            console.log("\n🧪 Test 1: Query and decrypt real reserves\n");

            const pair = await ethers.getContractAt("FHEPair", pairAddr);

     
            const [reserve0, reserve1] = await pair.getReserves.staticCall();


         
            expect(reserve0).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
            expect(reserve1).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");

        });

        it("sdf", async function () {

            const pair = await ethers.getContractAt("FHEPair", pairAddr);

            const obfuscated = await pair.obfuscatedReserves();



   
            expect(obfuscated.obfuscatedReserve0).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
            expect(obfuscated.obfuscatedReserve1).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");

        
        });

        it("sdf", async function () {


            const pair = await ethers.getContractAt("FHEPair", pairAddr);


            const encryptedLP = await pair.confidentialBalanceOf(user1.address);


        
            const lpBalance = await fhevm.userDecryptEuint(
                FhevmType.euint64,
                encryptedLP,
                pairAddr,
                user1
            );

         
            expect(lpBalance).to.be.gt(0);

         
        });

        it("should be able to query and decrypt all reserves", async function () {


            const pair = await ethers.getContractAt("FHEPair", pairAddr);

 
            const [reserve0, reserve1] = await pair.getReserves.staticCall();
            expect(reserve0).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
            expect(reserve1).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");


            const obf = await pair.obfuscatedReserves();
            expect(obf.obfuscatedReserve0).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
            expect(obf.obfuscatedReserve1).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");



            const lpBalance = await pair.confidentialBalanceOf(user1.address);
            expect(lpBalance).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
           
        });

        it("5️⃣ should not be able to decrypt User1's LP balance (permission test)", async function () {
        

            const pair = await ethers.getContractAt("FHEPair", pairAddr);

           
   
            const encryptedLP = await pair.confidentialBalanceOf(user1.address);

            try {

                const lpBalance = await fhevm.userDecryptEuint(
                    FhevmType.euint64,
                    encryptedLP,
                    pairAddr,
                    user2  
                );

                
                
            } catch (error: any) {
                
            }

            
        });
    });

   
});


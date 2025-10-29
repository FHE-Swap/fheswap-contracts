const { ethers } = require("hardhat");

async function main() {

    const signatures = [
        "addLiquidity(address,address,uint256,uint256,address,uint256)",
        "addLiquidity(address,address,externalEuint64,externalEuint64,bytes,address,uint256)",
        "addLiquidity(externalEuint64,externalEuint64,address,uint256,bytes)",
        "swapTokens(address,address,uint256,uint16,address,uint256)",
        "swapTokens(address,address,externalEuint64,bytes,uint16,address,uint256)"
    ];

    console.log("sart:");
    signatures.forEach(sig => {
        const selector = ethers.id(sig).substring(0, 10);
        console.log(`${selector} - ${sig}`);
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

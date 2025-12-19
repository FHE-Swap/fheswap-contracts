const { ethers } = require("hardhat");
const fs = require("fs");

/**
 * Calculate function selector for a given signature
 * @param {string} signature - Function signature
 * @returns {string} Function selector (4 bytes)
 */
function getSelector(signature) {
    return ethers.id(signature).substring(0, 10);
}

/**
 * Check for selector collisions in a list of signatures
 * @param {Array} signatures - Array of function signatures
 * @returns {Object} Collision information
 */
function checkCollisions(signatures) {
    const selectorMap = new Map();
    const collisions = [];

    signatures.forEach(sig => {
        const selector = getSelector(sig);
        if (selectorMap.has(selector)) {
            collisions.push({
                selector,
                signatures: [selectorMap.get(selector), sig]
            });
        } else {
            selectorMap.set(selector, sig);
        }
    });

    return { selectorMap, collisions };
}

/**
 * Group signatures by contract/category
 */
function getSignatureGroups() {
    return {
        router: [
            "addLiquidity(address,address,uint256,uint256,address,uint256)",
            "addLiquidity(address,address,externalEuint64,externalEuint64,bytes,address,uint256)",
            "removeLiquidity(address,address,externalEuint64,bytes,address,uint256)",
            "swapTokens(address,address,uint256,uint16,address,uint256)",
            "swapTokens(address,address,externalEuint64,bytes,uint16,address,uint256)",
            "wrapToken(address,uint256,address)",
            "getAmountOut(address,address,uint256)",
            "getPair(address,address)",
            "getRouterStats()",
            "getUserStats(address)",
            "getRouterAnalytics()"
        ],
        pair: [
            "addLiquidity(euint64,euint64,address,uint256)",
            "addLiquidity(externalEuint64,externalEuint64,address,uint256,bytes)",
            "removeLiquidity(euint64,address,uint256)",
            "removeLiquidity(externalEuint64,address,uint256,bytes)",
            "swapTokens(euint64,euint64,euint128,euint128,uint16,bool,address,uint256)",
            "getReserves()",
            "getPairStats()",
            "getUserOperationCount(address)",
            "getTokens()",
            "getPairInfo()"
        ],
        factory: [
            "createPair(address,address)",
            "createPairWithInfo(address,address,address,address,uint8,uint8)",
            "getPair(address,address)",
            "allPairsLength()",
            "setFeeTo(address)",
            "setPlatformFeeBps(uint16)",
            "getFeeConfig()",
            "getFactoryStats()",
            "getPairsBatch(uint256,uint256)",
            "pairExists(address,address)"
        ],
        token: [
            "transfer(address,uint256)",
            "approve(address,uint256)",
            "transferFrom(address,address,uint256)",
            "balanceOf(address)",
            "totalSupply()",
            "mint(address,uint256)",
            "burn(address,uint256)",
            "getStats()"
        ]
    };
}

async function main() {
    console.log("\n" + "=".repeat(80));
    console.log("Function Selector Analysis");
    console.log("=".repeat(80) + "\n");

    const signatureGroups = getSignatureGroups();
    const allSignatures = [];
    const results = [];

    // Process each group
    for (const [groupName, signatures] of Object.entries(signatureGroups)) {
        console.log(`\n📋 ${groupName.toUpperCase()} Functions:`);
        console.log("-".repeat(80));

        signatures.forEach(sig => {
            const selector = getSelector(sig);
            console.log(`${selector} - ${sig}`);

            allSignatures.push(sig);
            results.push({ group: groupName, selector, signature: sig });
        });
    }

    // Check for collisions across all signatures
    console.log("\n" + "=".repeat(80));
    console.log("Collision Analysis");
    console.log("=".repeat(80));

    const { selectorMap, collisions } = checkCollisions(allSignatures);

    if (collisions.length === 0) {
        console.log("\n✅ No selector collisions found!");
    } else {
        console.log(`\n⚠️  Found ${collisions.length} collision(s):`);
        collisions.forEach((collision, index) => {
            console.log(`\n  Collision ${index + 1}:`);
            console.log(`    Selector: ${collision.selector}`);
            collision.signatures.forEach((sig, i) => {
                console.log(`    ${i + 1}. ${sig}`);
            });
        });
    }

    // Statistics
    console.log("\n" + "=".repeat(80));
    console.log("Statistics");
    console.log("=".repeat(80));
    console.log(`Total signatures analyzed: ${allSignatures.length}`);
    console.log(`Unique selectors: ${selectorMap.size}`);
    console.log(`Collisions found: ${collisions.length}`);

    // Group statistics
    console.log("\nBy category:");
    for (const [groupName, signatures] of Object.entries(signatureGroups)) {
        console.log(`  ${groupName}: ${signatures.length} functions`);
    }

    // Export results to JSON file
    const outputData = {
        timestamp: new Date().toISOString(),
        totalSignatures: allSignatures.length,
        uniqueSelectors: selectorMap.size,
        collisions: collisions.length,
        groups: signatureGroups,
        results: results
    };

    const outputPath = "./selector-analysis.json";
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    console.log(`\n📄 Results exported to: ${outputPath}`);

    console.log("\n" + "=".repeat(80));
    console.log("Analysis Complete");
    console.log("=".repeat(80) + "\n");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

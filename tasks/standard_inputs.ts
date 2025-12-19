import { task } from "hardhat/config";
import fs from "fs";
import path from "path";

/**
 * Clean up old standard input files
 * @param outputPath - Directory to clean
 * @returns Number of files deleted
 */
function cleanupOldFiles(outputPath: string): number {
  if (!fs.existsSync(outputPath)) {
    return 0;
  }

  const existingFiles = fs.readdirSync(outputPath).filter(f => f.endsWith(".json"));
  let deletedCount = 0;

  for (const file of existingFiles) {
    try {
      fs.unlinkSync(path.join(outputPath, file));
      deletedCount++;
    } catch (error) {
      console.warn(`⚠️  Failed to delete ${file}: ${error}`);
    }
  }

  return deletedCount;
}

/**
 * Extract metadata from build info content
 * @param content - Build info content
 * @returns Metadata object
 */
function extractMetadata(content: any) {
  return {
    solcVersion: content.solcVersion || "unknown",
    solcLongVersion: content.solcLongVersion || "unknown",
    id: content.id || "unknown",
    sourceCount: content.input?.sources ? Object.keys(content.input.sources).length : 0
  };
}

/**
 * Generate summary report
 * @param stats - Statistics object
 * @param outputPath - Output directory path
 */
function generateSummaryReport(stats: any, outputPath: string): void {
  const reportPath = path.join(outputPath, "_extraction-summary.json");
  const report = {
    timestamp: new Date().toISOString(),
    statistics: stats,
    outputDirectory: outputPath
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📊 Summary report: ${reportPath}`);
}

task("extract-standard-inputs", "Extract Solidity standard JSON inputs from build-info")
  .addOptionalParam("clean", "Clean old files before extraction", true)
  .addOptionalParam("verbose", "Enable verbose logging", false)
  .setAction(async (taskArgs, hre) => {
    console.log("\n" + "=".repeat(80));
    console.log("Standard Input Extraction Task");
    console.log("=".repeat(80) + "\n");

    const buildInfoPath = path.join(hre.config.paths.artifacts, "build-info");
    const outputPath = path.join(hre.config.paths.root, "standard-inputs");

    // Check if build-info directory exists
    if (!fs.existsSync(buildInfoPath)) {
      console.error(`❌ Build info directory not found: ${buildInfoPath}`);
      console.log("💡 Hint: Run 'npx hardhat compile' first");
      return;
    }

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
      console.log(`📁 Created output directory: ${outputPath}`);
    }

    // Clean up old files if requested
    if (taskArgs.clean) {
      console.log("\n🧹 Cleaning up old files...");
      const deletedCount = cleanupOldFiles(outputPath);
      if (deletedCount > 0) {
        console.log(`   Deleted ${deletedCount} old file(s)`);
      }
    }

    // Statistics tracking
    const stats = {
      buildInfoFiles: 0,
      contractsProcessed: 0,
      filesExported: 0,
      errors: 0,
      solcVersions: new Set<string>()
    };

    const files = fs.readdirSync(buildInfoPath).filter((f) => f.endsWith(".json"));

    if (files.length === 0) {
      console.warn("⚠️  No build info files found");
      return;
    }

    console.log(`\n📦 Processing ${files.length} build info file(s)...\n`);

    // Process each build info file
    for (const file of files) {
      stats.buildInfoFiles++;
      const fullPath = path.join(buildInfoPath, file);

      try {
        const content = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        const metadata = extractMetadata(content);
        stats.solcVersions.add(metadata.solcVersion);

        if (taskArgs.verbose) {
          console.log(`\n📄 Processing: ${file}`);
          console.log(`   Solc version: ${metadata.solcVersion}`);
          console.log(`   Sources: ${metadata.sourceCount}`);
        }

        const input = content.input;
        if (!input || !input.sources) {
          console.warn(`⚠️  Skipping ${file}: No input sources found`);
          continue;
        }

        // Extract standard inputs for each source file
        const processedContracts = new Set<string>();

        for (const [sourcePath] of Object.entries(input.sources)) {
          const contractName = path.basename(sourcePath, ".sol").replace(/[^a-zA-Z0-9]/g, "_");

          // Avoid duplicate processing
          if (processedContracts.has(contractName)) {
            continue;
          }

          processedContracts.add(contractName);
          stats.contractsProcessed++;

          const outputFile = path.join(outputPath, `${contractName}-standard-input.json`);

          // Write standard input file
          fs.writeFileSync(outputFile, JSON.stringify({ ...input }, null, 2));
          stats.filesExported++;

          if (taskArgs.verbose) {
            console.log(`   ✅ Exported: ${path.basename(outputFile)}`);
          } else {
            console.log(`✅ ${contractName}`);
          }
        }
      } catch (error) {
        stats.errors++;
        console.error(`❌ Error processing ${file}: ${error}`);
      }
    }

    // Display statistics
    console.log("\n" + "=".repeat(80));
    console.log("Extraction Statistics");
    console.log("=".repeat(80));
    console.log(`Build info files processed: ${stats.buildInfoFiles}`);
    console.log(`Contracts processed: ${stats.contractsProcessed}`);
    console.log(`Files exported: ${stats.filesExported}`);
    console.log(`Errors encountered: ${stats.errors}`);
    console.log(`Solc versions used: ${Array.from(stats.solcVersions).join(", ")}`);

    // Generate summary report
    generateSummaryReport({
      buildInfoFiles: stats.buildInfoFiles,
      contractsProcessed: stats.contractsProcessed,
      filesExported: stats.filesExported,
      errors: stats.errors,
      solcVersions: Array.from(stats.solcVersions)
    }, outputPath);

    console.log("\n" + "=".repeat(80));
    if (stats.errors === 0) {
      console.log("🎉 Extraction completed successfully!");
    } else {
      console.log(`⚠️  Extraction completed with ${stats.errors} error(s)`);
    }
    console.log("=".repeat(80) + "\n");
  });

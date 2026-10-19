#!/usr/bin/env node
const {
  loadProductionBackfillConfig,
  parseArguments,
  parseBoundedInteger,
  runProductionBackfill,
  validateSourceScope,
  validateStatePaths,
} = require("../src/thumbnail/production-backfill");
const { createThumbnailPrdBackfillStorage } = require("../src/storage/thumbnail-prd-backfill-wasabi");

const SAFE_CATEGORIES = new Set(["dry-run", "completed", "paused-cap", "failed"]);
const SUMMARY_COUNTS = [
  "examined",
  "generated",
  "alreadyPresent",
  "unsupported",
  "oversize",
  "failed",
];

const safeSummary = (result) => {
  const validCounts = result
    && typeof result === "object"
    && SUMMARY_COUNTS.every((key) => Number.isSafeInteger(result[key]) && result[key] >= 0);
  const terminalCount = validCounts
    ? result.generated + result.alreadyPresent + result.unsupported + result.oversize
    : Number.POSITIVE_INFINITY;
  const valid = validCounts
    && result.examined <= 10
    && terminalCount <= result.examined
    && result.failed <= result.examined + 1
    && SAFE_CATEGORIES.has(result.category);
  return {
    category: valid ? result.category : "failed",
    ...Object.fromEntries(SUMMARY_COUNTS.map((key) => [key, valid ? result[key] : 0])),
  };
};

const failureSummary = () => ({
  category: "failed",
  examined: 0,
  generated: 0,
  alreadyPresent: 0,
  unsupported: 0,
  oversize: 0,
  failed: 1,
});

const main = async (
  args = process.argv.slice(2),
  {
    env = process.env,
    write = (message) => console.log(message),
    createStorage = createThumbnailPrdBackfillStorage,
    runScan = runProductionBackfill,
    platform = process.platform,
  } = {},
) => {
  try {
    const options = parseArguments(args);
    const config = loadProductionBackfillConfig(env);
    validateSourceScope(options, config);
    const maxObjects = parseBoundedInteger(options.maxObjects, 1, 10, "invalid-max-objects");
    const pageSize = options.pageSize === undefined
      ? 5
      : parseBoundedInteger(options.pageSize, 1, 10, "invalid-page-size");
    let statePaths;
    if (options.execute) {
      if (platform === "win32") throw new Error("directory-sync-unsupported");
      statePaths = validateStatePaths({
        checkpointPath: options.checkpoint,
        auditPath: options.audit,
      });
    } else if (options.checkpoint !== undefined || options.audit !== undefined) {
      throw new Error("dry-run-local-state-not-allowed");
    }

    const scope = {
      sourceBucket: config.sourceBucket,
      sourceRegion: config.sourceRegion,
      prefix: config.prefix,
      destinationBucket: config.destinationBucket,
      destinationRegion: config.destinationRegion,
    };
    const storage = createStorage({
      scope,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
    const result = await runScan({
      scope,
      storage,
      maxObjects,
      pageSize,
      dryRun: !options.execute,
      checkpointPath: statePaths?.checkpointPath,
      auditPath: statePaths?.auditPath,
      platform,
    });
    const summary = safeSummary(result);
    write(JSON.stringify(summary));
    return summary.category === "failed" || summary.failed > 0 ? 1 : 0;
  } catch {
    write(JSON.stringify(failureSummary()));
    return 1;
  }
};

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = { main, safeSummary };

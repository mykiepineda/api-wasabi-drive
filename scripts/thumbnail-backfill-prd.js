#!/usr/bin/env node
const {
  loadProductionBackfillConfig,
  maxObjectsForRecipe,
  parseArguments,
  parseBoundedInteger,
  recipeStatePaths,
  runProductionBackfill,
  validateSourceScope,
  validateStatePaths,
} = require("../src/thumbnail/production-backfill");
const { createThumbnailPrdBackfillStorage } = require("../src/storage/thumbnail-prd-backfill-wasabi");

const SAFE_CATEGORIES = new Set(["dry-run", "completed", "paused-cap", "failed"]);
const SAFE_CODES = new Set([
  "configuration-rejected",
  "scope-rejected",
  "provider-denied",
  "provider-failure",
  "invalid-state",
  "unknown-write-outcome",
  "state-complete",
  "empty-scope",
]);
const STATE_FAILURE_CODES = new Set([
  "invalid-checkpoint",
  "checkpoint-scope-mismatch",
  "checkpoint-cleanup-failed",
  "checkpoint-durability-unknown",
  "checkpoint-write-failed",
  "invalid-audit-file",
  "invalid-audit-boundary",
  "invalid-audit-record",
  "audit-write-failed",
  "invalid-local-state-path",
  "non-private-path",
  "non-private-lock-directory",
  "lock-already-held",
  "lock-acquisition-failed",
  "lock-cleanup-failed",
  "lock-ownership-lost",
]);
const SUMMARY_COUNTS = [
  "examined",
  "generated",
  "alreadyPresent",
  "unsupported",
  "oversize",
  "failed",
];

const safeSummary = (result, { recipeId = "v1", maxObjects = 10 } = {}) => {
  const recipeMaxObjects = maxObjectsForRecipe(recipeId);
  const validLimit = recipeMaxObjects !== undefined
    && Number.isSafeInteger(maxObjects)
    && maxObjects >= 1
    && maxObjects <= recipeMaxObjects;
  const validCounts = result
    && typeof result === "object"
    && SUMMARY_COUNTS.every((key) => Number.isSafeInteger(result[key]) && result[key] >= 0);
  const terminalCount = validCounts
    ? result.generated + result.alreadyPresent + result.unsupported + result.oversize
    : Number.POSITIVE_INFINITY;
  const valid = validCounts
    && validLimit
    && result.examined <= maxObjects
    && result.examined <= recipeMaxObjects
    && terminalCount <= result.examined
    && result.failed <= result.examined + 1
    && SAFE_CATEGORIES.has(result.category);
  return {
    category: valid ? result.category : "failed",
    ...(valid && SAFE_CODES.has(result.code) ? { code: result.code } : {}),
    ...Object.fromEntries(SUMMARY_COUNTS.map((key) => [key, valid ? result[key] : 0])),
  };
};

const failureSummary = (code) => ({
  category: "failed",
  ...(SAFE_CODES.has(code) ? { code } : {}),
  examined: 0,
  generated: 0,
  alreadyPresent: 0,
  unsupported: 0,
  oversize: 0,
  failed: 1,
});

const classifyOuterFailure = (error) => {
  const code = error?.code ?? error?.message;
  if (
    code === "invalid-arguments"
    || code === "invalid-max-objects"
    || code === "invalid-page-size"
    || code === "directory-sync-unsupported"
    || code === "dry-run-local-state-not-allowed"
  ) return "configuration-rejected";
  if (
    code === "source-scope-mismatch"
    || code === "invalid-prd-v2-source-enrollment"
    || code === "invalid-prd-v2-migration"
    || code === "invalid-prd-v2-derived-bucket"
    || code === "invalid-production-backfill-scope"
  ) return "scope-rejected";
  if (
    code === "invalid-production-backfill-configuration"
    || code === "invalid-prd-v2-enrollment"
    || code === "missing-preflight-configuration"
    || code === "forbidden-credential-provider"
    || code === "invalid-bucket"
    || code === "invalid-prefix"
    || code === "unsupported-thumbnail-recipe"
    || code === "invalid-production-backfill-region"
  ) return "configuration-rejected";
  if (code === "provider-denied") return "provider-denied";
  if (code === "provider-failure") return "provider-failure";
  if (
    code === "unknown-write-outcome"
    || code === "ambiguous-write"
    || code === "unresolved-write-intent"
  ) return "unknown-write-outcome";
  if (STATE_FAILURE_CODES.has(code)) return "invalid-state";
  return undefined;
};

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
    const config = loadProductionBackfillConfig(env, options.recipeId);
    validateSourceScope(options, config, options.recipeId);
    const maxObjects = parseBoundedInteger(
      options.maxObjects,
      1,
      maxObjectsForRecipe(options.recipeId),
      "invalid-max-objects",
    );
    const pageSize = options.pageSize === undefined
      ? 5
      : parseBoundedInteger(options.pageSize, 1, 10, "invalid-page-size");
    if (options.execute) {
      if (platform === "win32") throw new Error("directory-sync-unsupported");
      validateStatePaths(recipeStatePaths({
        recipeId: options.recipeId,
        checkpointPath: options.checkpoint,
        auditPath: options.audit,
      }));
    } else if (options.checkpoint !== undefined || options.audit !== undefined) {
      throw new Error("dry-run-local-state-not-allowed");
    }

    const scope = {
      sourceBucket: options.sourceBucket,
      sourceRegion: options.sourceRegion,
      prefix: options.prefix,
      wholeBucket: options.wholeBucket === true,
      destinationBucket: config.destinationBucket,
      destinationRegion: config.destinationRegion,
      prdV2: Boolean(config._prdV2),
      sourceEnrollment: config._prdV2?.enrollment,
    };
    const storage = createStorage({
      scope,
      recipeId: options.recipeId,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
    const result = await runScan({
      scope,
      storage,
      maxObjects,
      pageSize,
      dryRun: !options.execute,
      checkpointPath: options.checkpoint,
      auditPath: options.audit,
      recipeId: options.recipeId,
      platform,
    });
    const summary = safeSummary(result, { recipeId: options.recipeId, maxObjects });
    write(JSON.stringify(summary));
    return summary.category === "failed" || summary.failed > 0 ? 1 : 0;
  } catch (error) {
    write(JSON.stringify(failureSummary(classifyOuterFailure(error))));
    return 1;
  }
};

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = { main, safeSummary };

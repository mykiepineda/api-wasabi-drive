#!/usr/bin/env node
require("dotenv").config();
const path = require("node:path");

const {
  createThumbnailWasabiStorage,
  validateWasabiRegion,
} = require("../src/storage/thumbnail-wasabi");
const { normalizePrefix, runBackfillScan } = require("../src/thumbnail/backfill");

const PRODUCTION_BUCKET_PATTERN = /(^|[-_.])(prod|prd|production)([-_.]|$)/i;
const TEST_BUCKET_PATTERN = /(^|[-_.])test([-_.]|$)/i;
const SAFE_CATEGORIES = new Set(["dry-run", "completed", "paused-cap", "failed"]);
const VALUE_FLAGS = new Set([
  "--source-bucket",
  "--source-region",
  "--prefix",
  "--max-objects",
  "--page-size",
  "--checkpoint",
]);
const BOOLEAN_FLAGS = new Set(["--execute", "--confirm-test-backfill"]);

const parseArguments = (args) => {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (VALUE_FLAGS.has(argument)) {
      if (values.has(argument) || !args[index + 1] || args[index + 1].startsWith("--")) {
        throw new Error("invalid-arguments");
      }
      values.set(argument, args[index + 1]);
      index += 1;
    } else if (BOOLEAN_FLAGS.has(argument)) {
      if (flags.has(argument)) {
        throw new Error("invalid-arguments");
      }
      flags.add(argument);
    } else {
      throw new Error("invalid-arguments");
    }
  }
  for (const flag of ["--source-bucket", "--source-region", "--prefix", "--max-objects"]) {
    if (!values.has(flag)) {
      throw new Error("invalid-arguments");
    }
  }
  if (flags.has("--confirm-test-backfill") !== flags.has("--execute")) {
    throw new Error("invalid-arguments");
  }

  return {
    sourceBucket: values.get("--source-bucket"),
    sourceRegion: values.get("--source-region"),
    prefix: values.get("--prefix"),
    maxObjects: values.get("--max-objects"),
    pageSize: values.get("--page-size"),
    checkpoint: values.get("--checkpoint"),
    execute: flags.has("--execute"),
  };
};

const safeSummary = (result) => {
  const countNames = [
    "examined",
    "generated",
    "alreadyPresent",
    "unsupported",
    "oversize",
    "failed",
  ];
  const countsValid = result
    && typeof result === "object"
    && countNames.every((name) => Number.isSafeInteger(result[name]) && result[name] >= 0);
  const totalTerminal = countsValid
    ? result.generated + result.alreadyPresent + result.unsupported + result.oversize
    : Number.POSITIVE_INFINITY;
  const validResult = countsValid
    && result.examined <= 10
    && totalTerminal <= result.examined;
  const summary = Object.fromEntries(countNames.map((name) => [
    name,
    validResult ? result[name] : 0,
  ]));
  return {
    category: validResult && SAFE_CATEGORIES.has(result.category) ? result.category : "failed",
    ...summary,
  };
};

const loadBackfillConfig = (env) => {
  if (
    env.THUMBNAIL_PILOT_STAGE !== "test"
    || env.NODE_ENV?.trim().toLowerCase() === "production"
    || (env.DEPLOYMENT_STAGE && env.DEPLOYMENT_STAGE !== "test")
  ) {
    throw new Error("invalid-test-stage");
  }

  const config = {
    sourceBucket: env.THUMBNAIL_TEST_SOURCE_BUCKET,
    destinationBucket: env.THUMBNAIL_TEST_DERIVED_BUCKET,
    destinationRegion: env.THUMBNAIL_TEST_DERIVED_REGION,
    accessKeyId: env.THUMBNAIL_TEST_WASABI_ACCESS_KEY_ID,
    secretAccessKey: env.THUMBNAIL_TEST_WASABI_SECRET_ACCESS_KEY,
  };
  if (Object.values(config).some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("missing-test-configuration");
  }
  if (
    config.destinationRegion !== "ap-southeast-1"
    || config.sourceBucket === config.destinationBucket
    || !TEST_BUCKET_PATTERN.test(config.sourceBucket)
    || !TEST_BUCKET_PATTERN.test(config.destinationBucket)
    || PRODUCTION_BUCKET_PATTERN.test(config.sourceBucket)
    || PRODUCTION_BUCKET_PATTERN.test(config.destinationBucket)
  ) {
    throw new Error("invalid-test-configuration");
  }
  validateWasabiRegion(config.destinationRegion);
  return config;
};

const parseBoundedInteger = (value, minimum, maximum, errorCode) => {
  if (!/^\d+$/.test(value)) {
    throw new Error(errorCode);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(errorCode);
  }
  return parsed;
};

const main = async (
  args = process.argv.slice(2),
  {
    env = process.env,
    write = (message) => console.log(message),
    createStorage = createThumbnailWasabiStorage,
    runScan = runBackfillScan,
  } = {},
) => {
  try {
    const options = parseArguments(args);
    const config = loadBackfillConfig(env);
    if (options.sourceBucket !== config.sourceBucket) {
      throw new Error("invalid-source-bucket");
    }
    validateWasabiRegion(options.sourceRegion);
    const prefix = normalizePrefix(options.prefix);
    const maxObjects = parseBoundedInteger(options.maxObjects, 1, 10, "invalid-max-objects");
    const pageSize = options.pageSize === undefined
      ? 5
      : parseBoundedInteger(options.pageSize, 1, 10, "invalid-page-size");

    if (
      options.execute
      && (
        typeof options.checkpoint !== "string"
        || !options.checkpoint.trim()
        || !path.isAbsolute(options.checkpoint)
      )
    ) {
      throw new Error("invalid-checkpoint");
    }
    if (options.checkpoint !== undefined && !path.isAbsolute(options.checkpoint)) {
      throw new Error("invalid-checkpoint");
    }

    const storage = createStorage({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
    const result = await runScan({
      sourceBucket: config.sourceBucket,
      sourceRegion: options.sourceRegion,
      prefix,
      destinationBucket: config.destinationBucket,
      destinationRegion: config.destinationRegion,
      storage,
      maxObjects,
      pageSize,
      dryRun: !options.execute,
      checkpointPath: options.checkpoint,
    });
    const summary = safeSummary(result);
    write(JSON.stringify(summary));
    return summary.category === "failed" || summary.failed > 0 ? 1 : 0;
  } catch {
    write(JSON.stringify({
      category: "failed",
      examined: 0,
      generated: 0,
      alreadyPresent: 0,
      unsupported: 0,
      oversize: 0,
      failed: 1,
    }));
    return 1;
  }
};

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  loadBackfillConfig,
  main,
  parseArguments,
  safeSummary,
};

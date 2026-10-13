#!/usr/bin/env node
require("dotenv").config();

const { createThumbnailWasabiStorage, validateWasabiRegion } = require("../src/storage/thumbnail-wasabi");
const { runBackfillScan } = require("../src/thumbnail/backfill");

const PRODUCTION_BUCKET_PATTERN = /(^|[-_.])(prod|prd|production)([-_.]|$)/i;
const TEST_BUCKET_PATTERN = /(^|[-_.])test([-_.]|$)/i;
const SAFE_CATEGORIES = new Set([
  "dry-run",
  "completed",
  "paused-cap",
  "failed",
]);

const parseArguments = (args) => {
  const values = new Map();
  const flags = new Set();
  const valueFlags = new Set([
    "--source-bucket",
    "--source-region",
    "--prefix",
    "--max-objects",
    "--page-size",
    "--checkpoint",
  ]);
  const booleanFlags = new Set(["--execute", "--confirm-test-backfill"]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (valueFlags.has(argument)) {
      if (values.has(argument) || !args[index + 1] || args[index + 1].startsWith("--")) {
        throw new Error("invalid-arguments");
      }
      values.set(argument, args[index + 1]);
      index += 1;
    } else if (booleanFlags.has(argument)) {
      if (flags.has(argument)) {
        throw new Error("invalid-arguments");
      }
      flags.add(argument);
    } else {
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
  const plain = {
    category: SAFE_CATEGORIES.has(result?.category) ? result.category : "failed",
    examined: Number.isInteger(result?.examined) ? result.examined : 0,
    generated: Number.isInteger(result?.generated) ? result.generated : 0,
    alreadyPresent: Number.isInteger(result?.alreadyPresent) ? result.alreadyPresent : 0,
    unsupported: Number.isInteger(result?.unsupported) ? result.unsupported : 0,
    oversize: Number.isInteger(result?.oversize) ? result.oversize : 0,
    failed: Number.isInteger(result?.failed) ? result.failed : 0,
  };
  if (result?.pausedCap) {
    plain.pausedCap = 1;
  }
  if (typeof result?.stopReason === "string") {
    plain.stopReason = "failure";
  }
  return plain;
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

  if (config.destinationRegion !== "ap-southeast-1") {
    throw new Error("invalid-test-destination-region");
  }
  validateWasabiRegion(config.destinationRegion);
  if (
    config.sourceBucket === config.destinationBucket
    || !TEST_BUCKET_PATTERN.test(config.sourceBucket)
    || !TEST_BUCKET_PATTERN.test(config.destinationBucket)
    || PRODUCTION_BUCKET_PATTERN.test(config.sourceBucket)
    || PRODUCTION_BUCKET_PATTERN.test(config.destinationBucket)
  ) {
    throw new Error("invalid-test-buckets");
  }
  return config;
};

const main = async (args = process.argv.slice(2), { env = process.env, write = (message) => console.log(message) } = {}) => {
  try {
    const options = parseArguments(args);
    const config = loadBackfillConfig(env);
    const sourceBucket = options.sourceBucket || config.sourceBucket;
    const sourceRegion = options.sourceRegion || "ap-southeast-2";
    const prefix = options.prefix || "pilot/";

    if (sourceBucket !== config.sourceBucket) {
      throw new Error("invalid-source-bucket");
    }
    validateWasabiRegion(sourceRegion);
    if (!prefix.startsWith("pilot/")) {
      throw new Error("invalid-prefix");
    }
    if (options.maxObjects !== undefined && (!/^\d+$/.test(options.maxObjects) || Number(options.maxObjects) < 1 || Number(options.maxObjects) > 10)) {
      throw new Error("invalid-max-objects");
    }
    if (options.pageSize !== undefined && (!/^\d+$/.test(options.pageSize) || Number(options.pageSize) < 1 || Number(options.pageSize) > 10)) {
      throw new Error("invalid-page-size");
    }
    if (!options.execute && options.checkpoint !== undefined && !options.checkpoint.trim()) {
      throw new Error("invalid-checkpoint");
    }
    if (options.execute && !options.checkpoint) {
      throw new Error("invalid-checkpoint");
    }

    const storage = createThumbnailWasabiStorage({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });

    const result = await runBackfillScan({
      sourceBucket: config.sourceBucket,
      sourceRegion,
      prefix,
      destinationBucket: config.destinationBucket,
      destinationRegion: config.destinationRegion,
      storage,
      maxObjects: options.maxObjects ? Number(options.maxObjects) : 10,
      pageSize: options.pageSize ? Number(options.pageSize) : 5,
      dryRun: !options.execute,
      checkpointPath: options.checkpoint,
    });

    write(JSON.stringify(safeSummary(result)));
    return result.category === "failed" || (result.category === "paused-cap" && result.failed > 0) ? 1 : 0;
  } catch (error) {
    write(JSON.stringify({ category: "failed", examined: 0, generated: 0, alreadyPresent: 0, unsupported: 0, oversize: 0, failed: 1 }));
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

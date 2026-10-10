require("dotenv").config();

const { createThumbnailWasabiStorage, validateWasabiRegion } = require("../src/storage/thumbnail-wasabi");
const { generateThumbnailForObject } = require("../src/thumbnail/generate");

const PRODUCTION_BUCKET_PATTERN = /(^|[-_.])(prod|prd|production)([-_.]|$)/i;
const TEST_BUCKET_PATTERN = /(^|[-_.])test([-_.]|$)/i;
const SAFE_CATEGORIES = new Set([
  "dry-run",
  "generated",
  "already-present",
  "unsupported",
  "etag-mismatch",
  "precondition-unsupported",
  "failed",
]);

const parseArguments = (args) => {
  const values = new Map();
  const flags = new Set();
  const valueFlags = new Set(["--source-bucket", "--source-key", "--source-region"]);
  const booleanFlags = new Set(["--execute", "--confirm-test-write"]);

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

  for (const flag of valueFlags) {
    if (!values.has(flag)) {
      throw new Error("invalid-arguments");
    }
  }
  if (flags.has("--confirm-test-write") !== flags.has("--execute")) {
    throw new Error("invalid-arguments");
  }

  return {
    sourceBucket: values.get("--source-bucket"),
    sourceKey: values.get("--source-key"),
    sourceRegion: values.get("--source-region"),
    execute: flags.has("--execute"),
  };
};

const loadTestConfig = (env) => {
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

const safeSummary = (result) => {
  const summary = {
    category: SAFE_CATEGORIES.has(result?.category) ? result.category : "failed",
    count: 1,
  };
  if (
    Number.isSafeInteger(result?.dimensions?.width) && result.dimensions.width > 0
    && Number.isSafeInteger(result?.dimensions?.height) && result.dimensions.height > 0
  ) {
    summary.dimensions = result.dimensions;
  }
  if (Number.isSafeInteger(result?.bytes) && result.bytes >= 0) {
    summary.bytes = result.bytes;
  }
  if (result?.contentType === "image/webp") {
    summary.contentType = result.contentType;
  }
  return summary;
};

const main = async (
  args = process.argv.slice(2),
  {
    env = process.env,
    createStorage = createThumbnailWasabiStorage,
    generate = generateThumbnailForObject,
    write = (message) => console.log(message),
  } = {},
) => {
  let result;
  try {
    const options = parseArguments(args);
    const config = loadTestConfig(env);
    validateWasabiRegion(options.sourceRegion);
    if (
      options.sourceBucket !== config.sourceBucket
      || options.sourceBucket === config.destinationBucket
      || options.sourceKey.endsWith("/")
    ) {
      throw new Error("invalid-source-selection");
    }

    const storage = createStorage({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
    result = await generate({
      sourceBucket: options.sourceBucket,
      sourceKey: options.sourceKey,
      sourceRegion: options.sourceRegion,
      destinationBucket: config.destinationBucket,
      destinationRegion: config.destinationRegion,
      storage,
      dryRun: !options.execute,
    });
  } catch {
    result = { category: "failed" };
  }

  write(JSON.stringify(safeSummary(result)));
  return ["generated", "already-present", "dry-run"].includes(safeSummary(result).category) ? 0 : 1;
};

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  PRODUCTION_BUCKET_PATTERN,
  TEST_BUCKET_PATTERN,
  loadTestConfig,
  main,
  parseArguments,
  safeSummary,
};

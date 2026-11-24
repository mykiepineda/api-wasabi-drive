const { SUPPORTED_WASABI_REGIONS } = require("../storage/wasabi-regions");
const { loadPrdV2Enrollment, validatePrdV2Scope } = require("./prd-v2-config");

const CONFIG_KEYS = {
  sourceBucket: "THUMBNAIL_PRD_PREFLIGHT_SOURCE_BUCKET",
  sourceRegion: "THUMBNAIL_PRD_PREFLIGHT_SOURCE_REGION",
  sourcePrefix: "THUMBNAIL_PRD_PREFLIGHT_SOURCE_PREFIX",
  accessKeyId: "THUMBNAIL_PRD_PREFLIGHT_WASABI_ACCESS_KEY_ID",
  secretAccessKey: "THUMBNAIL_PRD_PREFLIGHT_WASABI_SECRET_ACCESS_KEY",
};

const isSafeConfiguredValue = (value) =>
  typeof value === "string"
  && value.length > 0
  && value === value.trim()
  && !/[\u0000-\u001f\u007f]/.test(value);

const validatePrefix = (prefix) => {
  if (prefix === "") return prefix;
  if (
    !isSafeConfiguredValue(prefix)
    || prefix.startsWith("/")
    || prefix.includes("\\")
    || prefix.includes("//")
    || prefix.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("invalid-source-prefix");
  }
  return prefix;
};

const validateOptInV2Prefix = (prefix, wholeBucket) => {
  if (wholeBucket === true) {
    if (prefix !== "") throw new Error("invalid-source-prefix");
    return prefix;
  }
  if (typeof prefix !== "string" || prefix === "") {
    throw new Error("invalid-source-prefix");
  }
  if (
    !isSafeConfiguredValue(prefix)
    || !prefix.endsWith("/")
    || prefix.startsWith("/")
    || prefix.includes("\\")
    || prefix.includes("//")
    || prefix.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("invalid-source-prefix");
  }
  return prefix;
};

const validateSourceBucket = (bucket) => {
  if (
    !isSafeConfiguredValue(bucket)
    || bucket.length < 3
    || bucket.length > 63
    || !/^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(bucket)
    || bucket.includes("..")
    || bucket.includes(".-")
    || bucket.includes("-.")
  ) {
    throw new Error("invalid-source-bucket");
  }
  return bucket;
};

const validateDedicatedPreflightCredentials = (env, accessKeyId, secretAccessKey) => {
  const otherAccessKeyIds = [
    env.WASABI_ACCESS_KEY_ID,
    env.THUMBNAIL_TEST_WASABI_ACCESS_KEY_ID,
    env.THUMBNAIL_PRD_BACKFILL_WASABI_ACCESS_KEY_ID,
    env.THUMBNAIL_API_READ_ACCESS_KEY_ID,
    env.AWS_ACCESS_KEY_ID,
  ];
  const otherSecretAccessKeys = [
    env.WASABI_SECRET_ACCESS_KEY,
    env.THUMBNAIL_TEST_WASABI_SECRET_ACCESS_KEY,
    env.THUMBNAIL_PRD_BACKFILL_WASABI_SECRET_ACCESS_KEY,
    env.THUMBNAIL_API_READ_SECRET_ACCESS_KEY,
    env.AWS_SECRET_ACCESS_KEY,
  ];
  if (
    otherAccessKeyIds.includes(accessKeyId)
    || otherSecretAccessKeys.includes(secretAccessKey)
  ) {
    throw new Error("reused-preflight-credentials");
  }
};

const loadPreflightConfig = (env, recipeId = "v1") => {
  if (recipeId === "v2" && env.THUMBNAIL_PRD_V2_SOURCE_BUCKETS_JSON !== undefined) {
    const prdV2 = loadPrdV2Enrollment(env);
    if (!prdV2) throw new Error("invalid-prd-v2-enrollment");
    const destinationBucket = prdV2.derivedBucket;
    const accessKeyId = env.THUMBNAIL_PRD_PREFLIGHT_WASABI_ACCESS_KEY_ID;
    const secretAccessKey = env.THUMBNAIL_PRD_PREFLIGHT_WASABI_SECRET_ACCESS_KEY;
    if (
      typeof accessKeyId !== "string"
      || !isSafeConfiguredValue(accessKeyId)
      || typeof secretAccessKey !== "string"
      || !isSafeConfiguredValue(secretAccessKey)
    ) {
      throw new Error("missing-preflight-configuration");
    }
    validateDedicatedPreflightCredentials(env, accessKeyId, secretAccessKey);
    return {
      sourceBucket: undefined,
      sourceRegion: undefined,
      sourcePrefix: undefined,
      destinationBucket,
      destinationRegion: prdV2.derivedRegion,
      accessKeyId,
      secretAccessKey,
      prdV2,
    };
  }
  const config = Object.fromEntries(
    Object.entries(CONFIG_KEYS).map(([key, envName]) => [key, env[envName]]),
  );
  if (Object.values(config).some((value) => !isSafeConfiguredValue(value))) {
    throw new Error("missing-preflight-configuration");
  }
  validateSourceBucket(config.sourceBucket);
  validatePrefix(config.sourcePrefix);
  if (!SUPPORTED_WASABI_REGIONS.has(config.sourceRegion)) {
    throw new Error("invalid-source-region");
  }
  validateDedicatedPreflightCredentials(env, config.accessKeyId, config.secretAccessKey);
  return config;
};

const validateScope = (options, config) => {
  if (config.prdV2) {
    if (options.recipeId !== "v2") throw new Error("source-scope-mismatch");
    validatePrdV2Scope({
      sourceBucket: options.sourceBucket,
      sourceRegion: options.sourceRegion,
      destinationBucket: config.destinationBucket,
      destinationRegion: config.destinationRegion,
    }, config.prdV2);
    const wholeBucket = options.wholeBucket === true;
    try {
      validateOptInV2Prefix(options.prefix, wholeBucket);
    } catch {
      throw new Error("source-scope-mismatch");
    }
    return;
  }
  if (
    options.sourceBucket !== config.sourceBucket
    || options.sourceRegion !== config.sourceRegion
    || options.prefix !== config.sourcePrefix
  ) {
    throw new Error("source-scope-mismatch");
  }
};

module.exports = {
  loadPreflightConfig,
  validatePrefix,
  validateOptInV2Prefix,
  validateScope,
  validateSourceBucket,
};

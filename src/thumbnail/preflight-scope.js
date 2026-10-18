const { SUPPORTED_WASABI_REGIONS } = require("../storage/wasabi-regions");

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

const loadPreflightConfig = (env) => {
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
  const otherAccessKeyIds = [
    env.WASABI_ACCESS_KEY_ID,
    env.THUMBNAIL_TEST_WASABI_ACCESS_KEY_ID,
    env.AWS_ACCESS_KEY_ID,
  ];
  const otherSecretAccessKeys = [
    env.WASABI_SECRET_ACCESS_KEY,
    env.THUMBNAIL_TEST_WASABI_SECRET_ACCESS_KEY,
    env.AWS_SECRET_ACCESS_KEY,
  ];
  if (
    otherAccessKeyIds.includes(config.accessKeyId)
    || otherSecretAccessKeys.includes(config.secretAccessKey)
  ) {
    throw new Error("reused-preflight-credentials");
  }
  return config;
};

const validateScope = (options, config) => {
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
  validateScope,
  validateSourceBucket,
};

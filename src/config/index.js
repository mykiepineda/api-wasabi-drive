const { SUPPORTED_WASABI_REGIONS } = require("../storage/wasabi-regions");

const isValidTrustedUserObjectId = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
};

const parseTrustedUserObjectIds = (value, { strict = false } = {}) => {
  if (value === undefined || value === null) {
    return Object.freeze([]);
  }

  const entries = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return Object.freeze([]);
  }

  const normalizedEntries = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!isValidTrustedUserObjectId(entry)) {
      if (strict) {
        throw new Error(
          "Invalid ENTRA_TRUSTED_USER_OBJECT_IDS value. Provide valid Entra user Object IDs separated by commas.",
        );
      }
      continue;
    }

    const normalizedEntry = entry.toLowerCase();
    if (!seen.has(normalizedEntry)) {
      seen.add(normalizedEntry);
      normalizedEntries.push(normalizedEntry);
    }
  }

  return Object.freeze(normalizedEntries);
};

const parseCommaSeparatedValues = (value) => {
  if (value === undefined || value === null) {
    return Object.freeze([]);
  }

  const entries = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const uniqueEntries = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!seen.has(entry)) {
      seen.add(entry);
      uniqueEntries.push(entry);
    }
  }

  return Object.freeze(uniqueEntries);
};

const parseExactList = (name, value, validateEntry) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return Object.freeze([]);
  }

  const entries = String(value).split(",").map((entry) => entry.trim());
  const seen = new Set();

  for (const entry of entries) {
    if (!entry || !validateEntry(entry)) {
      throw new Error(`Invalid ${name} value.`);
    }
    if (seen.has(entry)) {
      throw new Error(`Duplicate ${name} value.`);
    }
    seen.add(entry);
  }

  return Object.freeze(entries);
};

const isValidBucketName = (value) =>
  value.length >= 3
  && value.length <= 63
  && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value)
  && !value.includes("..")
  && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);

const isValidThumbnailSourcePrefix = (value) =>
  typeof value === "string"
  && value !== "/"
  && !value.startsWith("/")
  && !value.includes("*")
  && !value.includes("?")
  && value.endsWith("/")
  && !value.includes("\\")
  && !value.includes("//")
  && !value.split("/").some((part) => part === "." || part === "..");

const isValidReleaseSha = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  return /^[0-9a-fA-F]{40}$/.test(value.trim());
};

const parseBoolean = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "false") {
    return false;
  }
  if (normalized === "true") {
    return true;
  }

  throw new Error(`Unsupported boolean value: ${value}`);
};

const parseThumbnailKeys = (value) => {
  const entries = parseExactList(
    "THUMBNAIL_API_ALLOWED_KEYS",
    value,
    (entry) => /^v1\/([0-9a-f]{2})\/([0-9a-f]{64})\.webp$/i.test(entry),
  );
  const validEntries = [];
  const seen = new Set();

  for (const entry of entries) {
    const normalizedEntry = entry.toLowerCase();
    const [, shard, digest] = normalizedEntry.match(/^v1\/([0-9a-f]{2})\/([0-9a-f]{64})\.webp$/);
    if (shard !== digest.slice(0, 2)) {
      throw new Error("THUMBNAIL_API_ALLOWED_KEYS contains a key with a mismatched shard.");
    }
    if (seen.has(normalizedEntry)) {
      throw new Error("Duplicate THUMBNAIL_API_ALLOWED_KEYS value.");
    }
    seen.add(normalizedEntry);
    validEntries.push(normalizedEntry);
  }

  if (validEntries.length > 13) {
    throw new Error("THUMBNAIL_API_ALLOWED_KEYS exceeds the approved 13-key pilot limit.");
  }

  return Object.freeze(validEntries);
};

const parseThumbnailApiConfig = () => {
  const enabled = parseBoolean(process.env.THUMBNAIL_API_ENABLED);
  const v2Enabled = parseBoolean(process.env.THUMBNAIL_API_V2_ENABLED);
  if (!enabled && !v2Enabled) {
    return {
      enabled: false,
      enabledValue: process.env.THUMBNAIL_API_ENABLED,
      allowedKeys: new Set(),
      allowedKeyList: Object.freeze([]),
      v2: {
        enabled: false,
        enabledValue: process.env.THUMBNAIL_API_V2_ENABLED,
      },
    };
  }

  const derivedBucket = process.env.THUMBNAIL_API_DERIVED_BUCKET?.trim();
  const derivedRegion = process.env.THUMBNAIL_API_DERIVED_REGION?.trim();
  const accessKeyId = process.env.THUMBNAIL_API_READ_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.THUMBNAIL_API_READ_SECRET_ACCESS_KEY?.trim();
  const ttlValue = process.env.THUMBNAIL_API_URL_TTL_SECONDS;
  const ttlSeconds = typeof ttlValue === "string" && /^\d+$/.test(ttlValue.trim())
    ? Number(ttlValue.trim())
    : NaN;

  if (!derivedBucket || !derivedRegion || !accessKeyId || !secretAccessKey) {
    throw new Error("An enabled thumbnail API mode requires the shared derived bucket, region, and read credentials.");
  }

  if (!isValidBucketName(derivedBucket)) {
    throw new Error("Thumbnail API derived bucket must be a valid exact bucket name.");
  }
  if (derivedRegion !== "ap-southeast-1") {
    throw new Error("THUMBNAIL_API_DERIVED_REGION must be ap-southeast-1.");
  }

  const stage = process.env.DEPLOYMENT_STAGE?.trim().toLowerCase();
  if (!["test", "prd"].includes(stage)) {
    throw new Error("An enabled thumbnail API mode requires DEPLOYMENT_STAGE to be test or prd.");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
    throw new Error("THUMBNAIL_API_URL_TTL_SECONDS must be an integer between 60 and 3600 seconds.");
  }

  if (accessKeyId === process.env.WASABI_ACCESS_KEY_ID?.trim()) {
    throw new Error("Thumbnail API read credentials must be distinct from the original Wasabi identity.");
  }

  let sourceBucket;
  let sourceRegion;
  let sourcePrefix;
  let allowedKeys = Object.freeze([]);
  if (enabled) {
    sourceBucket = process.env.THUMBNAIL_API_SOURCE_BUCKET?.trim();
    sourceRegion = process.env.THUMBNAIL_API_SOURCE_REGION?.trim();
    sourcePrefix = process.env.THUMBNAIL_API_SOURCE_PREFIX?.trim();
    allowedKeys = parseThumbnailKeys(process.env.THUMBNAIL_API_ALLOWED_KEYS);

    if (!sourceBucket || !sourceRegion || !sourcePrefix || allowedKeys.length === 0) {
      throw new Error("THUMBNAIL_API_ENABLED requires its source scope and exact allowed keys.");
    }
    if (!isValidBucketName(sourceBucket) || !SUPPORTED_WASABI_REGIONS.has(sourceRegion)) {
      throw new Error("Thumbnail API v1 source bucket or region is invalid.");
    }
    if (!isValidThumbnailSourcePrefix(sourcePrefix)) {
      throw new Error("THUMBNAIL_API_SOURCE_PREFIX must be a non-empty slash-terminated prefix.");
    }
    if (stage === "prd" && sourceRegion !== "ap-northeast-1") {
      throw new Error("The prd thumbnail source region must be ap-northeast-1.");
    }
    if (stage === "test" && sourceRegion === "ap-northeast-1") {
      throw new Error("The test thumbnail source region must not use the prd Tokyo region.");
    }
    if (sourceRegion === derivedRegion || sourceBucket === derivedBucket) {
      throw new Error("The thumbnail source and derived bucket and regions must differ.");
    }
  }

  let v2SourceBucket;
  let v2SourceRegion;
  let v2SourcePrefix;
  if (v2Enabled) {
    v2SourceBucket = process.env.THUMBNAIL_API_V2_SOURCE_BUCKET?.trim();
    v2SourceRegion = process.env.THUMBNAIL_API_V2_SOURCE_REGION?.trim();
    v2SourcePrefix = process.env.THUMBNAIL_API_V2_SOURCE_PREFIX?.trim();

    if (!v2SourceBucket || !v2SourceRegion || !v2SourcePrefix) {
      throw new Error("THUMBNAIL_API_V2_ENABLED requires its source bucket, region, and prefix.");
    }
    if (!isValidBucketName(v2SourceBucket) || v2SourceRegion !== "ap-southeast-2") {
      throw new Error("Thumbnail API v2 requires a valid source bucket in ap-southeast-2.");
    }
    if (!isValidThumbnailSourcePrefix(v2SourcePrefix)) {
      throw new Error("THUMBNAIL_API_V2_SOURCE_PREFIX must be a non-empty slash-terminated prefix.");
    }
    if (v2SourceRegion === derivedRegion || v2SourceBucket === derivedBucket) {
      throw new Error("The v2 source and derived bucket and regions must differ.");
    }
  }

  const internalBuckets = parseExactList(
    "WASABI_INTERNAL_BUCKETS",
    process.env.WASABI_INTERNAL_BUCKETS,
    isValidBucketName,
  );
  if (internalBuckets.length === 0 || !internalBuckets.includes(derivedBucket)) {
    throw new Error("WASABI_INTERNAL_BUCKETS must include the configured THUMBNAIL_API_DERIVED_BUCKET.");
  }

  if (
    enabled
    && v2Enabled
    && sourceBucket === v2SourceBucket
    && sourceRegion === v2SourceRegion
    && (sourcePrefix.startsWith(v2SourcePrefix) || v2SourcePrefix.startsWith(sourcePrefix))
  ) {
    throw new Error("Thumbnail API v1 and v2 source scopes must not overlap.");
  }

  const allowedKeySet = new Set(allowedKeys.map((key) => key.toLowerCase()));

  return {
    enabled,
    enabledValue: process.env.THUMBNAIL_API_ENABLED,
    sourceBucket,
    sourceRegion,
    sourcePrefix,
    derivedBucket,
    derivedRegion,
    allowedKeys: allowedKeySet,
    allowedKeyList: allowedKeys,
    readAccessKeyId: accessKeyId,
    readSecretAccessKey: secretAccessKey,
    urlTtlSeconds: ttlSeconds,
    v2: {
      enabled: v2Enabled,
      enabledValue: process.env.THUMBNAIL_API_V2_ENABLED,
      sourceBucket: v2SourceBucket,
      sourceRegion: v2SourceRegion,
      sourcePrefix: v2SourcePrefix,
    },
  };
};

const entraTenantId = process.env.ENTRA_TENANT_ID?.trim();
const trustedUserObjectIds = parseTrustedUserObjectIds(
  process.env.ENTRA_TRUSTED_USER_OBJECT_IDS,
  { strict: true },
);

if (trustedUserObjectIds.length === 0) {
  throw new Error("Missing ENTRA_TRUSTED_USER_OBJECT_IDS configuration.");
}

const internalBuckets = parseExactList(
  "WASABI_INTERNAL_BUCKETS",
  process.env.WASABI_INTERNAL_BUCKETS,
  isValidBucketName,
);
const thumbnailApi = parseThumbnailApiConfig();
const deploymentStage = process.env.DEPLOYMENT_STAGE?.trim().toLowerCase();

if (deploymentStage && !["test", "prd"].includes(deploymentStage)) {
  throw new Error("DEPLOYMENT_STAGE must be test or prd when set.");
}
if (deploymentStage && internalBuckets.length === 0) {
  throw new Error("WASABI_INTERNAL_BUCKETS must be configured for deployed test/prd stages.");
}

const config = {
  port: process.env.PORT || 8080,
  stage: process.env.DEPLOYMENT_STAGE?.trim() || undefined,
  releaseSha: isValidReleaseSha(process.env.RELEASE_SHA)
    ? process.env.RELEASE_SHA.trim().toLowerCase()
    : undefined,
  wasabi: {
    serviceUrl: process.env.WASABI_SERVICE_URL,
    region: process.env.WASABI_REGION,
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID,
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY,
    internalBuckets,
    internalBucketSet: new Set(internalBuckets),
  },
  thumbnailApi,
  entra: {
    tenantId: entraTenantId,
    apiClientId: process.env.ENTRA_API_CLIENT_ID?.trim(),
    requiredScope: process.env.ENTRA_REQUIRED_SCOPE?.trim(),
    trustedUserObjectIds,
    issuer: entraTenantId
      ? `https://login.microsoftonline.com/${entraTenantId}/v2.0`
      : undefined,
    jwksUri: entraTenantId
      ? `https://login.microsoftonline.com/${entraTenantId}/discovery/v2.0/keys`
      : undefined,
  },
};

module.exports = config;
module.exports.parseTrustedUserObjectIds = parseTrustedUserObjectIds;
module.exports.parseCommaSeparatedValues = parseCommaSeparatedValues;
module.exports.parseThumbnailApiConfig = parseThumbnailApiConfig;

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
  const entries = parseCommaSeparatedValues(value);
  const validEntries = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!/^v1\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/i.test(entry)) {
      throw new Error(`Invalid THUMBNAIL_API_ALLOWED_KEYS value: ${entry}`);
    }

    const normalizedEntry = entry.toLowerCase();
    if (seen.has(normalizedEntry)) {
      throw new Error(`Duplicate THUMBNAIL_API_ALLOWED_KEYS value: ${entry}`);
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
  if (!enabled) {
    return {
      enabled: false,
      enabledValue: process.env.THUMBNAIL_API_ENABLED,
      allowedKeys: new Set(),
      allowedKeyList: Object.freeze([]),
    };
  }

  const sourceBucket = process.env.THUMBNAIL_API_SOURCE_BUCKET?.trim();
  const sourceRegion = process.env.THUMBNAIL_API_SOURCE_REGION?.trim();
  const sourcePrefix = process.env.THUMBNAIL_API_SOURCE_PREFIX?.trim();
  const derivedBucket = process.env.THUMBNAIL_API_DERIVED_BUCKET?.trim();
  const derivedRegion = process.env.THUMBNAIL_API_DERIVED_REGION?.trim();
  const allowedKeys = parseThumbnailKeys(process.env.THUMBNAIL_API_ALLOWED_KEYS);
  const accessKeyId = process.env.THUMBNAIL_API_READ_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.THUMBNAIL_API_READ_SECRET_ACCESS_KEY?.trim();
  const ttlSeconds = Number.parseInt(process.env.THUMBNAIL_API_URL_TTL_SECONDS, 10);

  if (!sourceBucket || !sourceRegion || !sourcePrefix || !derivedBucket || !derivedRegion || !accessKeyId || !secretAccessKey) {
    throw new Error("THUMBNAIL_API_ENABLED requires all thumbnail API environment variables to be configured.");
  }

  if (!sourcePrefix.endsWith("/")) {
    throw new Error("THUMBNAIL_API_SOURCE_PREFIX must be a non-empty slash-terminated prefix.");
  }

  if (!SUPPORTED_WASABI_REGIONS.has(sourceRegion)) {
    throw new Error(`Unsupported THUMBNAIL_API_SOURCE_REGION value: ${sourceRegion}`);
  }
  if (!SUPPORTED_WASABI_REGIONS.has(derivedRegion)) {
    throw new Error(`Unsupported THUMBNAIL_API_DERIVED_REGION value: ${derivedRegion}`);
  }

  if (sourceBucket === derivedBucket) {
    throw new Error("THUMBNAIL_API_SOURCE_BUCKET and THUMBNAIL_API_DERIVED_BUCKET must differ.");
  }
  if (sourceRegion === derivedRegion) {
    throw new Error("THUMBNAIL_API_SOURCE_REGION and THUMBNAIL_API_DERIVED_REGION must differ.");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
    throw new Error("THUMBNAIL_API_URL_TTL_SECONDS must be an integer between 60 and 3600 seconds.");
  }

  const internalBuckets = parseCommaSeparatedValues(process.env.WASABI_INTERNAL_BUCKETS);
  if (internalBuckets.length === 0 || !internalBuckets.includes(derivedBucket)) {
    throw new Error("WASABI_INTERNAL_BUCKETS must include the configured THUMBNAIL_API_DERIVED_BUCKET.");
  }

  const allowedKeySet = new Set(allowedKeys.map((key) => key.toLowerCase()));

  return {
    enabled: true,
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

const internalBuckets = parseCommaSeparatedValues(process.env.WASABI_INTERNAL_BUCKETS);
const thumbnailApi = parseThumbnailApiConfig();

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

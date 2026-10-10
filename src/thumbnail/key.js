const crypto = require("node:crypto");

const THUMBNAIL_FORMAT_VERSION = "v1";
const THUMBNAIL_FORMAT_PATTERN = /^v[1-9]\d*$/;

const resolveValue = (source, keys) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      return source[key];
    }
  }
  return undefined;
};

const sanitizeVersion = (version) => {
  if (typeof version !== "string") {
    return "";
  }

  const trimmed = version.trim();
  if (!trimmed || trimmed !== version || !THUMBNAIL_FORMAT_PATTERN.test(trimmed)) {
    return "";
  }

  return trimmed;
};

const normalizeEtag = (etag) => {
  if (typeof etag !== "string") {
    return "";
  }

  const trimmed = etag.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const createThumbnailKey = (input = {}) => {
  const region = resolveValue(input, ["sourceRegion", "region"]);
  const bucket = resolveValue(input, ["sourceBucket", "bucket"]);
  const sourceKey = resolveValue(input, ["completeSourceKey", "sourceKey", "key"]);
  const etag = resolveValue(input, ["normalizedETag", "etag", "ETag"]);
  const formatVersion = sanitizeVersion(resolveValue(input, ["formatVersion"]) ?? THUMBNAIL_FORMAT_VERSION);

  if (!formatVersion) {
    throw new TypeError("Thumbnail format version must be a safe version like v1 or v2.");
  }

  if (typeof region !== "string" || !region.trim()) {
    throw new Error("Thumbnail key requires a nonblank source region.");
  }
  if (typeof bucket !== "string" || !bucket.trim()) {
    throw new Error("Thumbnail key requires a nonblank source bucket.");
  }
  if (typeof sourceKey !== "string" || !sourceKey.trim()) {
    throw new Error("Thumbnail key requires a nonblank source key.");
  }

  const normalizedEtag = normalizeEtag(etag);
  if (!normalizedEtag) {
    throw new Error("Thumbnail key requires a nonblank ETag.");
  }

  const payload = [formatVersion, region, bucket, sourceKey, normalizedEtag];
  const digest = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const bucketPrefix = digest.slice(0, 2);

  return `${formatVersion}/${bucketPrefix}/${digest}.webp`;
};

module.exports = {
  THUMBNAIL_FORMAT_VERSION,
  THUMBNAIL_FORMAT_PATTERN,
  createThumbnailKey,
  normalizeEtag,
  sanitizeVersion,
};

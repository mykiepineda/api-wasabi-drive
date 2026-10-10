const STANDARD_THUMBNAIL_EXTENSIONS = new Set(["jpg", "jpeg", "jfif", "png", "webp"]);
const RAW_PREVIEW_EXTENSIONS = new Set(["cr2"]);
const DEFERRED_RAW_EXTENSIONS = new Set(["nef"]);

const normalizeExtension = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const withoutDot = trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
  return withoutDot.toLowerCase();
};

const evaluateThumbnailEligibility = (input = {}) => {
  const size = input.size ?? input.objectSize;
  const extension = input.extension ?? input.format ?? input.fileExtension;
  const format = input.format ?? input.extension ?? input.fileFormat;
  const sourceKey = input.sourceKey ?? input.completeSourceKey ?? input.key;
  const region = input.region ?? input.sourceRegion;
  const bucket = input.bucket ?? input.sourceBucket;
  const etag = input.etag ?? input.normalizedETag ?? input.ETag;
  const allowCR2Preview = Boolean(input.allowCR2Preview ?? input.allowRawPreview ?? false);

  if (!Number.isFinite(size) || size <= 0) {
    return { eligible: false, reason: "zero-byte-object", category: "unsupported" };
  }

  if (typeof sourceKey !== "string" || !sourceKey.trim()) {
    return { eligible: false, reason: "missing-source-key", category: "unsupported" };
  }
  if (typeof sourceKey === "string" && sourceKey.endsWith("/")) {
    return { eligible: false, reason: "folder-marker-key", category: "unsupported" };
  }
  if (typeof region !== "string" || !region.trim()) {
    return { eligible: false, reason: "missing-source-region", category: "unsupported" };
  }
  if (typeof bucket !== "string" || !bucket.trim()) {
    return { eligible: false, reason: "missing-source-bucket", category: "unsupported" };
  }
  if (typeof etag !== "string" || !etag.trim()) {
    return { eligible: false, reason: "missing-source-etag", category: "unsupported" };
  }

  const normalizedExtension = normalizeExtension(extension || format);
  if (!normalizedExtension) {
    return { eligible: false, reason: "unsupported-format", category: "unsupported" };
  }

  if (STANDARD_THUMBNAIL_EXTENSIONS.has(normalizedExtension)) {
    return {
      eligible: true,
      reason: "standard-image-supported",
      category: "standard-image",
      extension: normalizedExtension,
    };
  }

  if (RAW_PREVIEW_EXTENSIONS.has(normalizedExtension)) {
    if (allowCR2Preview) {
      return {
        eligible: true,
        reason: "cr2-preview-enabled",
        category: "raw-preview",
        extension: normalizedExtension,
      };
    }

    return {
      eligible: false,
      reason: "cr2-preview-not-enabled",
      category: "unsupported",
      extension: normalizedExtension,
    };
  }

  if (DEFERRED_RAW_EXTENSIONS.has(normalizedExtension)) {
    return {
      eligible: false,
      reason: "nef-deferred",
      category: "unsupported",
      extension: normalizedExtension,
    };
  }

  return {
    eligible: false,
    reason: "unsupported-format",
    category: "unsupported",
    extension: normalizedExtension,
  };
};

module.exports = {
  DEFERRED_RAW_EXTENSIONS,
  RAW_PREVIEW_EXTENSIONS,
  STANDARD_THUMBNAIL_EXTENSIONS,
  evaluateThumbnailEligibility,
  normalizeExtension,
};

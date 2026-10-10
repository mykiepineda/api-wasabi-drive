const { createThumbnailKey, normalizeEtag } = require("./key");
const { evaluateThumbnailEligibility, normalizeExtension } = require("./eligibility");
const { transformToWebp } = require("./transform");

const FIXED_THUMBNAIL_MAX_EDGE = 512;
const FIXED_THUMBNAIL_QUALITY = 80;

const applyThumbnailPolicy = async ({
  region,
  bucket,
  sourceKey,
  etag,
  sourceBytes,
  extension,
  format,
  size,
  allowCR2Preview = false,
  maxEdge,
  quality,
}) => {
  if (!Buffer.isBuffer(sourceBytes)) {
    return {
      eligible: false,
      reason: "missing-source-bytes",
      derivedKey: null,
      dimensions: null,
      contentType: null,
      bytes: null,
    };
  }

  if (maxEdge !== undefined || quality !== undefined) {
    return {
      eligible: false,
      reason: "unsupported-custom-recipe",
      derivedKey: null,
      dimensions: null,
      contentType: null,
      bytes: null,
    };
  }

  const normalizedEtag = normalizeEtag(etag);
  if (typeof extension === "string" && normalizeExtension(extension) === "cr2") {
    return {
      eligible: false,
      reason: "cr2-preview-pending-approval",
      derivedKey: null,
      dimensions: null,
      contentType: null,
      bytes: null,
    };
  }
  if (typeof format === "string" && normalizeExtension(format) === "cr2") {
    return {
      eligible: false,
      reason: "cr2-preview-pending-approval",
      derivedKey: null,
      dimensions: null,
      contentType: null,
      bytes: null,
    };
  }

  const eligibility = evaluateThumbnailEligibility({
    size,
    extension,
    format,
    sourceKey,
    region,
    bucket,
    etag: normalizedEtag || etag,
    allowCR2Preview,
  });

  if (!eligibility.eligible) {
    return {
      eligible: false,
      reason: eligibility.reason,
      derivedKey: null,
      dimensions: null,
      contentType: null,
      bytes: null,
    };
  }

  try {
    const derivedKey = createThumbnailKey({
      region,
      bucket,
      sourceKey,
      etag: normalizedEtag || etag,
    });

    const transformed = await transformToWebp({
      input: sourceBytes,
      maxEdge: FIXED_THUMBNAIL_MAX_EDGE,
      quality: FIXED_THUMBNAIL_QUALITY,
    });

    return {
      eligible: true,
      reason: "thumbnail-generated",
      derivedKey,
      dimensions: {
        width: transformed.width,
        height: transformed.height,
      },
      contentType: transformed.contentType,
      bytes: transformed.bytes,
      format: transformed.format,
      webpBuffer: transformed.buffer,
    };
  } catch (error) {
    return {
      eligible: false,
      reason: "thumbnail-generation-failed",
      derivedKey: null,
      dimensions: null,
      contentType: null,
      bytes: null,
      message: "thumbnail processing failed",
    };
  }
};

module.exports = {
  FIXED_THUMBNAIL_MAX_EDGE,
  FIXED_THUMBNAIL_QUALITY,
  applyThumbnailPolicy,
};

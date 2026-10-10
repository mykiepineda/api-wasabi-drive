const { createThumbnailKey, normalizeEtag } = require("./key");
const { evaluateThumbnailEligibility } = require("./eligibility");
const cr2 = require("./cr2");
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
  const eligibility = evaluateThumbnailEligibility({
    size,
    extension,
    format,
    sourceKey,
    region,
    bucket,
    etag: normalizedEtag || etag,
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
    let transformInput = sourceBytes;
    let fallbackOrientation;

    if (eligibility.category === "cr2-preview") {
      const preview = await cr2.extractCR2EmbeddedPreview({ input: sourceBytes });
      if (!preview?.eligible || !Buffer.isBuffer(preview.buffer) || preview.buffer.length === 0) {
        return {
          eligible: false,
          reason: "cr2-preview-unavailable",
          derivedKey: null,
          dimensions: null,
          contentType: null,
          bytes: null,
        };
      }
      transformInput = preview.buffer;
      fallbackOrientation = preview.fallbackOrientation;
    }

    const transformed = await transformToWebp({
      input: transformInput,
      maxEdge: FIXED_THUMBNAIL_MAX_EDGE,
      quality: FIXED_THUMBNAIL_QUALITY,
      ...(fallbackOrientation === undefined ? {} : { fallbackOrientation }),
    });
    const derivedKey = createThumbnailKey({
      region,
      bucket,
      sourceKey,
      etag: normalizedEtag || etag,
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

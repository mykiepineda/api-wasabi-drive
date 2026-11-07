const { createThumbnailKey, normalizeEtag } = require("./key");
const { evaluateThumbnailEligibility } = require("./eligibility");
const cr2 = require("./cr2");
const {
  DEFAULT_MAX_EDGE,
  DEFAULT_QUALITY,
  DEFAULT_THUMBNAIL_RECIPE_ID,
  isSupportedThumbnailRecipe,
  transformToWebp,
} = require("./transform");

const FIXED_THUMBNAIL_MAX_EDGE = DEFAULT_MAX_EDGE;
const FIXED_THUMBNAIL_QUALITY = DEFAULT_QUALITY;

const applyThumbnailPolicy = async ({
  region,
  bucket,
  sourceKey,
  etag,
  sourceBytes,
  extension,
  format,
  size,
  recipeId = DEFAULT_THUMBNAIL_RECIPE_ID,
  maxEdge,
  quality,
}) => {
  if (!isSupportedThumbnailRecipe(recipeId)) {
    return {
      eligible: false,
      reason: "unsupported-thumbnail-recipe",
      derivedKey: null,
      dimensions: null,
      contentType: null,
      bytes: null,
    };
  }

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
      recipeId,
      ...(fallbackOrientation === undefined ? {} : { fallbackOrientation }),
    });
    const derivedKey = createThumbnailKey({
      region,
      bucket,
      sourceKey,
      etag: normalizedEtag || etag,
      formatVersion: recipeId,
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
    if (error?.code === "thumbnail-source-too-small") {
      return {
        eligible: false,
        reason: "thumbnail-source-too-small",
        derivedKey: null,
        dimensions: null,
        contentType: null,
        bytes: null,
      };
    }
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

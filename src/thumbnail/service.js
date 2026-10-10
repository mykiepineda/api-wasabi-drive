const { createThumbnailKey, normalizeEtag } = require("./key");
const { evaluateThumbnailEligibility } = require("./eligibility");
const { transformToWebp } = require("./transform");

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
  maxEdge = 512,
  quality = 80,
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

  const normalizedEtag = normalizeEtag(etag);
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
      maxEdge,
      quality,
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
  applyThumbnailPolicy,
};

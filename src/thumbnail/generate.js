const { createThumbnailKey, normalizeEtag } = require("./key");
const { evaluateThumbnailEligibility } = require("./eligibility");
const { applyThumbnailPolicy } = require("./service");
const { MAX_SOURCE_BYTES, ThumbnailStorageError } = require("../storage/thumbnail-wasabi");

const extensionFromKey = (key) => {
  const filename = key.slice(key.lastIndexOf("/") + 1);
  const extensionIndex = filename.lastIndexOf(".");
  return extensionIndex >= 0 ? filename.slice(extensionIndex + 1) : "";
};

const failure = (category = "failed", reason) => ({
  category,
  count: 1,
  ...(reason ? { reason } : {}),
});

const generateThumbnailForObject = async ({
  sourceBucket,
  sourceKey,
  sourceRegion,
  destinationBucket,
  destinationRegion,
  storage,
  dryRun = true,
  applyPolicy = applyThumbnailPolicy,
}) => {
  if (
    typeof sourceBucket !== "string" || !sourceBucket
    || typeof destinationBucket !== "string" || !destinationBucket
    || sourceBucket === destinationBucket
  ) {
    return failure("failed", "invalid-bucket-configuration");
  }
  if (!storage || typeof storage.headSource !== "function" || typeof storage.headDerived !== "function") {
    return failure("failed", "invalid-storage-configuration");
  }

  try {
    const metadata = await storage.headSource({
      bucket: sourceBucket,
      key: sourceKey,
      region: sourceRegion,
    });
    const normalizedEtag = normalizeEtag(metadata?.etag);
    const eligibility = evaluateThumbnailEligibility({
      size: metadata?.size,
      extension: extensionFromKey(sourceKey),
      sourceKey,
      region: sourceRegion,
      bucket: sourceBucket,
      etag: normalizedEtag,
    });
    if (!eligibility.eligible) {
      return failure("unsupported", eligibility.reason);
    }
    if (metadata.size > MAX_SOURCE_BYTES) {
      return failure("failed", "source-too-large");
    }

    const derivedKey = createThumbnailKey({
      sourceRegion,
      sourceBucket,
      completeSourceKey: sourceKey,
      normalizedETag: normalizedEtag,
    });
    const alreadyPresent = await storage.headDerived({
      bucket: destinationBucket,
      key: derivedKey,
      region: destinationRegion,
    });
    if (alreadyPresent) {
      return { ...failure("already-present"), derivedKey };
    }
    if (dryRun) {
      return { ...failure("dry-run"), derivedKey };
    }
    if (typeof storage.getSourceBuffer !== "function" || typeof storage.putDerived !== "function") {
      return failure("failed", "invalid-storage-configuration");
    }

    const sourceBytes = await storage.getSourceBuffer({
      bucket: sourceBucket,
      key: sourceKey,
      region: sourceRegion,
      etag: metadata.etag,
      size: metadata.size,
    });
    const result = await applyPolicy({
      region: sourceRegion,
      bucket: sourceBucket,
      sourceKey,
      etag: normalizedEtag,
      sourceBytes,
      extension: extensionFromKey(sourceKey),
      size: metadata.size,
    });
    if (!result?.eligible) {
      return failure(
        result?.reason === "thumbnail-generation-failed" ? "failed" : "unsupported",
        "thumbnail-unavailable",
      );
    }
    if (
      result.derivedKey !== derivedKey
      || !Buffer.isBuffer(result.webpBuffer)
      || result.webpBuffer.length === 0
      || result.contentType !== "image/webp"
      || !Number.isSafeInteger(result.dimensions?.width)
      || !Number.isSafeInteger(result.dimensions?.height)
      || result.dimensions.width <= 0
      || result.dimensions.height <= 0
    ) {
      return failure("failed", "invalid-thumbnail-result");
    }

    try {
      await storage.putDerived({
        bucket: destinationBucket,
        key: derivedKey,
        region: destinationRegion,
        body: result.webpBuffer,
      });
    } catch (error) {
      if (error instanceof ThumbnailStorageError && error.code === "already-exists") {
        const racedObjectExists = await storage.headDerived({
          bucket: destinationBucket,
          key: derivedKey,
          region: destinationRegion,
        });
        if (racedObjectExists) {
          return { ...failure("already-present"), derivedKey };
        }
      }
      throw error;
    }

    return {
      category: "generated",
      count: 1,
      derivedKey,
      dimensions: result.dimensions,
      bytes: result.webpBuffer.length,
      contentType: "image/webp",
    };
  } catch (error) {
    if (error instanceof ThumbnailStorageError) {
      if (error.code === "etag-mismatch") {
        return failure("etag-mismatch");
      }
      if (error.code === "precondition-unsupported") {
        return failure("precondition-unsupported");
      }
      if (error.code === "source-too-large") {
        return failure("failed", "source-too-large");
      }
    }
    return failure("failed", "storage-or-processing-failure");
  }
};

module.exports = {
  extensionFromKey,
  generateThumbnailForObject,
};

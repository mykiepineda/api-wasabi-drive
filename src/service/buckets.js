const wasabi = require("../storage/wasabi");
const config = require("../config");
const { NotFoundError } = require("../errors");
const { evaluateThumbnailEligibility } = require("../thumbnail/eligibility");
const { createThumbnailKey } = require("../thumbnail/key");
const { createThumbnailApiWasabiStorage } = require("../storage/thumbnail-api-wasabi");

const getInternalBucketSet = () => config.wasabi.internalBucketSet;

const getThumbnailCandidateKey = (object, bucketName, bucketRegion, thumbnailConfig) => {
  if (
    bucketName !== thumbnailConfig.sourceBucket
    || bucketRegion !== thumbnailConfig.sourceRegion
    || typeof object?.Key !== "string"
    || !object.Key.startsWith(thumbnailConfig.sourcePrefix)
    || object.Key.endsWith("/")
  ) {
    return undefined;
  }

  const eligibility = evaluateThumbnailEligibility({
    size: object.Size,
    extension: object.Key.split("/").at(-1)?.split(".").at(-1),
    sourceKey: object.Key,
    region: bucketRegion,
    bucket: bucketName,
    etag: object.ETag,
  });
  if (!eligibility.eligible) {
    return undefined;
  }

  const candidateKey = createThumbnailKey({
    sourceRegion: bucketRegion,
    sourceBucket: bucketName,
    sourceKey: object.Key,
    etag: object.ETag,
  });
  return thumbnailConfig.allowedKeys.has(candidateKey) ? candidateKey : undefined;
};

const logThumbnailFailure = (errorCategory, count) => {
  console.warn(JSON.stringify({
    level: "warn",
    operation: "thumbnailSigning",
    errorCategory,
    count,
  }));
};

const getListBuckets = async () => {
  const results = await wasabi.getListBuckets();
  const internalBucketSet = getInternalBucketSet();
  if (!results?.Buckets || internalBucketSet.size === 0) {
    return results;
  }

  return {
    ...results,
    Buckets: results.Buckets.filter((bucket) => !internalBucketSet.has(bucket?.Name)),
  };
};

const getBucketRegion = async (name) => {
  if (getInternalBucketSet().has(name)) {
    throw new NotFoundError();
  }

  return wasabi.getBucketRegion(name);
};

const getListObjects = async (params) => {
  if (getInternalBucketSet().has(params?.Bucket)) {
    throw new NotFoundError();
  }

  const ListObjects = await wasabi.getListObjects(params);
  if (!ListObjects.Contents?.length) {
    return ListObjects;
  }

  const thumbnailConfig = config.thumbnailApi;
  const isThumbnailSourceBucket = thumbnailConfig.enabled
    && params.Bucket === thumbnailConfig.sourceBucket;
  let sourceRegion;
  let regionLookupFailed = false;

  if (isThumbnailSourceBucket) {
    try {
      sourceRegion = (await wasabi.getBucketRegion(params.Bucket))?.region;
    } catch {
      regionLookupFailed = true;
    }
  }

  const objects = ListObjects.Contents;
  const candidateKeys = isThumbnailSourceBucket && sourceRegion === thumbnailConfig.sourceRegion
    ? objects.map((object) => getThumbnailCandidateKey(
      object,
      params.Bucket,
      sourceRegion,
      thumbnailConfig,
    ))
    : objects.map(() => undefined);
  const candidateCount = candidateKeys.filter(Boolean).length;
  let signer;
  let signerInitializationFailed = false;

  if (candidateCount > 0) {
    try {
      signer = createThumbnailApiWasabiStorage({
        bucket: thumbnailConfig.derivedBucket,
        region: thumbnailConfig.derivedRegion,
        accessKeyId: thumbnailConfig.readAccessKeyId,
        secretAccessKey: thumbnailConfig.readSecretAccessKey,
        urlTtlSeconds: thumbnailConfig.urlTtlSeconds,
      });
    } catch {
      signerInitializationFailed = true;
    }
  }

  let signingFailureCount = 0;
  const Contents = await Promise.all(objects.map(async (object, index) => {
    const AccessUrl = await wasabi.getObjectAccessUrl({
      Bucket: params.Bucket,
      Key: object.Key,
    });

    const candidateKey = candidateKeys[index];
    if (!candidateKey || !signer || signerInitializationFailed) {
      return { ...object, AccessUrl };
    }

    try {
      const ThumbnailAccessUrl = await signer.getObjectAccessUrl({ Key: candidateKey });
      if (typeof ThumbnailAccessUrl !== "string" || !ThumbnailAccessUrl) {
        throw new Error("Thumbnail URL signing returned no URL.");
      }
      return { ...object, AccessUrl, ThumbnailAccessUrl };
    } catch {
      signingFailureCount += 1;
      return { ...object, AccessUrl };
    }
  }));

  if (signingFailureCount > 0) {
    logThumbnailFailure("signing", signingFailureCount);
  } else if (signerInitializationFailed) {
    logThumbnailFailure("signer_initialization", candidateCount);
  } else if (regionLookupFailed) {
    logThumbnailFailure("region_resolution", 1);
  }

  return {
    ...ListObjects,
    Contents,
  };
};

module.exports = {
  getListBuckets,
  getBucketRegion,
  getListObjects,
};

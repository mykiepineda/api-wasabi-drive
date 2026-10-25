const wasabi = require("../storage/wasabi");
const { NotFoundError } = require("../errors");
const { evaluateThumbnailEligibility } = require("../thumbnail/eligibility");
const { createThumbnailKey } = require("../thumbnail/key");
const { createThumbnailApiWasabiStorage } = require("../storage/thumbnail-api-wasabi");

const getRuntimeConfig = () => {
  try {
    return require("../config");
  } catch {
    return {
      wasabi: { internalBucketSet: new Set(), internalBuckets: [] },
      thumbnailApi: { enabled: false },
    };
  }
};

const getInternalBucketSet = () => {
  const config = getRuntimeConfig();
  return config.wasabi?.internalBucketSet || new Set();
};

const getThumbnailSigner = () => {
  const config = getRuntimeConfig();
  if (!config.thumbnailApi?.enabled) {
    return undefined;
  }

  const { derivedBucket, derivedRegion, readAccessKeyId, readSecretAccessKey, urlTtlSeconds } = config.thumbnailApi;
  if (!derivedBucket || !derivedRegion || !readAccessKeyId || !readSecretAccessKey) {
    return undefined;
  }

  return createThumbnailApiWasabiStorage({
    bucket: derivedBucket,
    region: derivedRegion,
    accessKeyId: readAccessKeyId,
    secretAccessKey: readSecretAccessKey,
    urlTtlSeconds,
  });
};

const getThumbnailAccessUrl = async (object, bucketName, bucketRegion) => {
  const config = getRuntimeConfig();
  if (!config.thumbnailApi?.enabled) {
    return undefined;
  }

  const { sourceBucket, sourceRegion, sourcePrefix, allowedKeys, derivedBucket } = config.thumbnailApi;
  if (bucketName !== sourceBucket || bucketRegion !== sourceRegion || !object?.Key || typeof object.Key !== "string") {
    return undefined;
  }
  if (!object.Key.startsWith(sourcePrefix) || object.Key.endsWith("/")) {
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

  if (!allowedKeys.has(candidateKey)) {
    return undefined;
  }

  try {
    const signer = getThumbnailSigner();
    if (!signer) {
      return undefined;
    }
    return await signer.getObjectAccessUrl({
      Bucket: derivedBucket,
      Key: candidateKey,
    });
  } catch {
    return undefined;
  }
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
  const internalBucketSet = getInternalBucketSet();
  if (internalBucketSet.has(name)) {
    throw new NotFoundError();
  }

  return wasabi.getBucketRegion(name);
};

const getListObjects = async (params) => {
  const internalBucketSet = getInternalBucketSet();
  if (internalBucketSet.has(params?.Bucket)) {
    throw new NotFoundError();
  }

  const ListObjects = await wasabi.getListObjects(params);

  if (!ListObjects.Contents?.length) {
    return ListObjects;
  }

  const sourceRegion = await wasabi.getBucketRegion(params.Bucket).then((result) => result?.region).catch(() => undefined);
  const config = getRuntimeConfig();
  const isThumbnailAllowedScope = config.thumbnailApi?.enabled
    && params?.Bucket === config.thumbnailApi.sourceBucket
    && sourceRegion === config.thumbnailApi.sourceRegion;

  return {
    ...ListObjects,
    Contents: await Promise.all(ListObjects.Contents.map(async (object) => {
      const baseObject = { ...object };
      const accessUrl = await wasabi.getObjectAccessUrl({
        Bucket: params.Bucket,
        Key: object.Key,
      });

      if (!isThumbnailAllowedScope) {
        return {
          ...baseObject,
          AccessUrl: accessUrl,
        };
      }

      const thumbnailAccessUrl = await getThumbnailAccessUrl(object, params.Bucket, sourceRegion);
      return {
        ...baseObject,
        AccessUrl: accessUrl,
        ...(thumbnailAccessUrl ? { ThumbnailAccessUrl: thumbnailAccessUrl } : {}),
      };
    })),
  };
};

module.exports = {
  getListBuckets,
  getBucketRegion,
  getListObjects,
};
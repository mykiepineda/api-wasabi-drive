const {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { createThumbnailKey, normalizeEtag } = require("../thumbnail/key");
const { MAX_SOURCE_BYTES } = require("../thumbnail/policy");
const { endpointForRegion, SUPPORTED_WASABI_REGIONS } = require("./wasabi-regions");
const { ThumbnailStorageError } = require("./thumbnail-wasabi");

const DERIVED_KEY_PATTERN = /^v1\/([a-f0-9]{2})\/([a-f0-9]{64})\.webp$/;

const validDerivedKey = (key) => {
  if (typeof key !== "string") return false;
  const match = DERIVED_KEY_PATTERN.exec(key);
  return Boolean(match && match[1] === match[2].slice(0, 2));
};

const validBucketName = (bucket) =>
  typeof bucket === "string"
  && bucket === bucket.trim()
  && bucket.length >= 3
  && bucket.length <= 63
  && /^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(bucket)
  && !bucket.includes("..")
  && !bucket.includes(".-")
  && !bucket.includes("-.")
  && !/(^|[-_.])test/i.test(bucket);

const createThumbnailPrdBackfillStorage = ({
  scope,
  accessKeyId,
  secretAccessKey,
  createClient = (options) => new S3Client(options),
}) => {
  if (
    !scope
    || !validBucketName(scope.sourceBucket)
    || typeof scope.sourceRegion !== "string"
    || typeof scope.prefix !== "string"
    || !validBucketName(scope.destinationBucket)
    || typeof scope.destinationRegion !== "string"
    || scope.sourceRegion !== "ap-northeast-1"
    || !SUPPORTED_WASABI_REGIONS.has(scope.sourceRegion)
    || scope.destinationRegion !== "ap-southeast-1"
    || scope.sourceBucket === scope.destinationBucket
    || !scope.prefix
    || !scope.prefix.endsWith("/")
    || scope.prefix !== scope.prefix.trim()
    || scope.prefix.startsWith("/")
    || scope.prefix.includes("\\")
    || scope.prefix.includes("//")
    || /[\u0000-\u001f\u007f]/.test(scope.prefix)
    || scope.prefix.split("/").some((part) => part === "." || part === "..")
    || typeof accessKeyId !== "string"
    || !accessKeyId.trim()
    || accessKeyId !== accessKeyId.trim()
    || /[\u0000-\u001f\u007f]/.test(accessKeyId)
    || typeof secretAccessKey !== "string"
    || !secretAccessKey.trim()
    || secretAccessKey !== secretAccessKey.trim()
    || /[\u0000-\u001f\u007f]/.test(secretAccessKey)
    || typeof createClient !== "function"
  ) {
    throw new ThumbnailStorageError("invalid-prd-backfill-storage-configuration");
  }

  const clients = new Map();
  const approvedDerivedKeys = new Set();
  const getClient = (region) => {
    if (!SUPPORTED_WASABI_REGIONS.has(region)) {
      throw new ThumbnailStorageError("invalid-region");
    }
    if (!clients.has(region)) {
      clients.set(region, createClient({
        region,
        endpoint: endpointForRegion(region),
        forcePathStyle: true,
        maxAttempts: 1,
        credentials: { accessKeyId, secretAccessKey },
      }));
    }
    return clients.get(region);
  };
  const assertSource = ({ bucket, region, key }) => {
    if (
      bucket !== scope.sourceBucket
      || region !== scope.sourceRegion
      || typeof key !== "string"
      || !key.startsWith(scope.prefix)
    ) {
      throw new ThumbnailStorageError("invalid-source-scope");
    }
  };
  const assertDestination = ({ bucket, region, key }) => {
    if (
      bucket !== scope.destinationBucket
      || region !== scope.destinationRegion
      || !validDerivedKey(key)
      || !approvedDerivedKeys.has(key)
    ) {
      throw new ThumbnailStorageError("invalid-destination-scope");
    }
  };
  const send = async (region, command, operation) => {
    try {
      return await getClient(region).send(command);
    } catch (error) {
      if (error instanceof ThumbnailStorageError) throw error;
      const status = error?.$metadata?.httpStatusCode ?? error?.statusCode;
      const code = error?.Code || error?.code || error?.name;
      if (operation === "head-derived" && status === 404 && ["NotFound", "NoSuchKey"].includes(code)) {
        throw new ThumbnailStorageError("destination-not-found");
      }
      if (operation === "get-source" && (status === 412 || code === "PreconditionFailed")) {
        throw new ThumbnailStorageError("etag-mismatch");
      }
      if (
        ["get-source", "put-derived"].includes(operation)
        && (
          status === 501
          || ["NotImplemented", "UnsupportedArgument"].includes(code)
          || (status === 400 && ["InvalidRequest", "InvalidArgument"].includes(code))
        )
      ) {
        throw new ThumbnailStorageError("precondition-unsupported");
      }
      if (
        operation === "put-derived"
        && (status === 412 || code === "PreconditionFailed")
      ) {
        throw new ThumbnailStorageError("already-exists");
      }
      throw new ThumbnailStorageError("provider-failure");
    }
  };

  return Object.freeze({
    async listSourcePage({ bucket, region, prefix, maxKeys, startAfter }) {
      if (
        bucket !== scope.sourceBucket
        || region !== scope.sourceRegion
        || prefix !== scope.prefix
        || !Number.isSafeInteger(maxKeys)
        || maxKeys < 1
        || maxKeys > 10
        || (
          startAfter !== undefined
          && (
            typeof startAfter !== "string"
            || !startAfter.startsWith(scope.prefix)
            || !startAfter
          )
        )
      ) {
        throw new ThumbnailStorageError("invalid-source-list-request");
      }
      const input = { Bucket: scope.sourceBucket, Prefix: scope.prefix, MaxKeys: maxKeys };
      if (startAfter !== undefined) input.StartAfter = startAfter;
      const page = await send(scope.sourceRegion, new ListObjectsV2Command(input), "list-source-page");
      return {
        IsTruncated: page?.IsTruncated,
        ...(page?.KeyCount === undefined ? {} : { KeyCount: page.KeyCount }),
        ...(page?.CommonPrefixes === undefined ? {} : { CommonPrefixes: page.CommonPrefixes }),
        ...(Array.isArray(page?.Contents)
          ? { Contents: page.Contents.map(({ Key, Size, ETag }) => ({ Key, Size, ETag })) }
          : page?.Contents === undefined
            ? {}
            : { Contents: page.Contents }),
      };
    },

    async headSource({ bucket, key, region }) {
      assertSource({ bucket, key, region });
      const result = await send(
        scope.sourceRegion,
        new HeadObjectCommand({ Bucket: scope.sourceBucket, Key: key }),
        "head-source",
      );
      const etag = normalizeEtag(result?.ETag);
      if (etag) {
        approvedDerivedKeys.add(createThumbnailKey({
          sourceRegion: scope.sourceRegion,
          sourceBucket: scope.sourceBucket,
          completeSourceKey: key,
          normalizedETag: etag,
        }));
      }
      return { etag: result?.ETag, size: result?.ContentLength };
    },

    async headDerived({ bucket, key, region }) {
      assertDestination({ bucket, key, region });
      try {
        await send(
          scope.destinationRegion,
          new HeadObjectCommand({ Bucket: scope.destinationBucket, Key: key }),
          "head-derived",
        );
        return true;
      } catch (error) {
        if (error instanceof ThumbnailStorageError && error.code === "destination-not-found") {
          return false;
        }
        throw error;
      }
    },

    async getSourceBuffer({ bucket, key, region, etag, size }) {
      assertSource({ bucket, key, region });
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SOURCE_BYTES) {
        throw new ThumbnailStorageError("source-too-large");
      }
      if (!normalizeEtag(etag)) throw new ThumbnailStorageError("invalid-source-etag");
      const response = await send(
        scope.sourceRegion,
        new GetObjectCommand({ Bucket: scope.sourceBucket, Key: key, IfMatch: etag }),
        "get-source",
      );
      if (normalizeEtag(response?.ETag) !== normalizeEtag(etag)) {
        response?.Body?.destroy?.();
        throw new ThumbnailStorageError("etag-mismatch");
      }
      if (
        response.ContentLength !== undefined
        && (!Number.isSafeInteger(response.ContentLength) || response.ContentLength !== size)
      ) {
        response?.Body?.destroy?.();
        throw new ThumbnailStorageError("source-size-mismatch");
      }
      if (!response?.Body || typeof response.Body[Symbol.asyncIterator] !== "function") {
        throw new ThumbnailStorageError("invalid-source-body");
      }
      const chunks = [];
      let length = 0;
      try {
        for await (const chunk of response.Body) {
          if (!(chunk instanceof Uint8Array) || length + chunk.byteLength > MAX_SOURCE_BYTES) {
            throw new ThumbnailStorageError("source-too-large");
          }
          chunks.push(Buffer.from(chunk));
          length += chunk.byteLength;
        }
      } catch (error) {
        response.Body.destroy?.();
        if (error instanceof ThumbnailStorageError) throw error;
        throw new ThumbnailStorageError("provider-failure");
      }
      if (length !== size) throw new ThumbnailStorageError("source-size-mismatch");
      return Buffer.concat(chunks, length);
    },

    async putDerived({ bucket, key, region, body }) {
      assertDestination({ bucket, key, region });
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new ThumbnailStorageError("invalid-derived-body");
      }
      const result = await send(
        scope.destinationRegion,
        new PutObjectCommand({
          Bucket: scope.destinationBucket,
          Key: key,
          Body: body,
          ContentType: "image/webp",
          IfNoneMatch: "*",
        }),
        "put-derived",
      );
      if (!normalizeEtag(result?.ETag)) {
        throw new ThumbnailStorageError("ambiguous-write");
      }
      return result;
    },
  });
};

module.exports = {
  createThumbnailPrdBackfillStorage,
  validDerivedKey,
};

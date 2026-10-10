const {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { normalizeEtag } = require("../thumbnail/key");

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_WASABI_REGIONS = new Set([
  "us-east-1",
  "us-east-2",
  "us-central-1",
  "us-west-1",
  "ca-central-1",
  "eu-central-1",
  "eu-central-2",
  "eu-west-1",
  "eu-west-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-southeast-2",
]);

class ThumbnailStorageError extends Error {
  constructor(code) {
    super(code);
    this.name = "ThumbnailStorageError";
    this.code = code;
  }
}

const validateWasabiRegion = (region) => {
  if (typeof region !== "string" || !SUPPORTED_WASABI_REGIONS.has(region)) {
    throw new ThumbnailStorageError("invalid-region");
  }
  return region;
};

const endpointForRegion = (region) => region === "us-east-1"
  ? "https://s3.wasabisys.com"
  : `https://s3.${region}.wasabisys.com`;

const getErrorCode = (error) => error?.Code || error?.code || error?.name;
const getStatusCode = (error) => error?.$metadata?.httpStatusCode ?? error?.statusCode;

const isNotFound = (error) => ["NotFound", "NoSuchKey"].includes(getErrorCode(error));
const isPreconditionFailure = (error) =>
  getStatusCode(error) === 412
  || getErrorCode(error) === "PreconditionFailed"
  || (getStatusCode(error) === 409 && getErrorCode(error) === "ConditionalRequestConflict");
const isUnsupportedPrecondition = (error) =>
  getStatusCode(error) === 501
  || ["NotImplemented", "UnsupportedArgument"].includes(getErrorCode(error))
  || (
    getStatusCode(error) === 400
    && ["InvalidRequest", "InvalidArgument"].includes(getErrorCode(error))
  );

const disposeBody = (body) => {
  if (typeof body?.destroy === "function" && !body.destroyed) {
    body.destroy();
  } else if (typeof body?.cancel === "function") {
    void body.cancel();
  }
};

const readBodyWithLimit = async (body, maxBytes) => {
  if (!body || typeof body[Symbol.asyncIterator] !== "function") {
    disposeBody(body);
    throw new ThumbnailStorageError("invalid-source-body");
  }

  const chunks = [];
  let byteCount = 0;
  const iterator = body[Symbol.asyncIterator]();

  try {
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw new ThumbnailStorageError("invalid-source-body");
      }
      if (byteCount + value.byteLength > maxBytes) {
        throw new ThumbnailStorageError("source-too-large");
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      byteCount += chunk.length;
    }
  } catch (error) {
    disposeBody(body);
    if (error instanceof ThumbnailStorageError) {
      throw error;
    }
    throw new ThumbnailStorageError("provider-failure");
  }

  return Buffer.concat(chunks, byteCount);
};

const createThumbnailWasabiStorage = ({
  accessKeyId,
  secretAccessKey,
  createClient = (options) => new S3Client(options),
} = {}) => {
  if (
    typeof accessKeyId !== "string" || !accessKeyId.trim()
    || typeof secretAccessKey !== "string" || !secretAccessKey.trim()
  ) {
    throw new ThumbnailStorageError("missing-test-credentials");
  }

  const clients = new Map();
  const getClient = (regionValue) => {
    const region = validateWasabiRegion(regionValue);
    if (!clients.has(region)) {
      clients.set(region, createClient({
        endpoint: endpointForRegion(region),
        region,
        credentials: { accessKeyId, secretAccessKey },
      }));
    }
    return clients.get(region);
  };

  const send = async (region, command, operation) => {
    try {
      return await getClient(region).send(command);
    } catch (error) {
      if (error instanceof ThumbnailStorageError) {
        throw error;
      }
      if (operation === "head-derived" && isNotFound(error)) {
        throw new ThumbnailStorageError("destination-not-found");
      }
      if (operation === "get-source") {
        if (isPreconditionFailure(error)) {
          throw new ThumbnailStorageError("etag-mismatch");
        }
        if (isUnsupportedPrecondition(error)) {
          throw new ThumbnailStorageError("precondition-unsupported");
        }
      }
      if (operation === "put-derived") {
        if (isPreconditionFailure(error)) {
          throw new ThumbnailStorageError("already-exists");
        }
        if (isUnsupportedPrecondition(error)) {
          throw new ThumbnailStorageError("precondition-unsupported");
        }
      }
      throw new ThumbnailStorageError("provider-failure");
    }
  };

  return Object.freeze({
    async headSource({ bucket, key, region }) {
      const result = await send(
        region,
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
        "head-source",
      );
      return {
        etag: result?.ETag,
        size: result?.ContentLength,
      };
    },

    async headDerived({ bucket, key, region }) {
      try {
        await send(
          region,
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
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

    async getSourceBuffer({
      bucket,
      key,
      region,
      etag,
      size,
    }) {
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SOURCE_BYTES) {
        throw new ThumbnailStorageError("source-too-large");
      }
      const expectedEtag = normalizeEtag(etag);
      if (!expectedEtag) {
        throw new ThumbnailStorageError("invalid-source-etag");
      }

      const response = await send(
        region,
        new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: etag }),
        "get-source",
      );
      const responseEtag = normalizeEtag(response?.ETag);
      if (!responseEtag || responseEtag !== expectedEtag) {
        disposeBody(response?.Body);
        throw new ThumbnailStorageError("etag-mismatch");
      }
      if (
        response.ContentLength !== undefined
        && (!Number.isSafeInteger(response.ContentLength) || response.ContentLength !== size)
      ) {
        disposeBody(response.Body);
        throw new ThumbnailStorageError("source-size-mismatch");
      }

      const sourceBytes = await readBodyWithLimit(response.Body, MAX_SOURCE_BYTES);
      if (sourceBytes.length !== size) {
        throw new ThumbnailStorageError("source-size-mismatch");
      }
      return sourceBytes;
    },

    async putDerived({ bucket, key, region, body }) {
      return send(
        region,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "image/webp",
          IfNoneMatch: "*",
        }),
        "put-derived",
      );
    },
  });
};

module.exports = {
  MAX_SOURCE_BYTES,
  SUPPORTED_WASABI_REGIONS,
  ThumbnailStorageError,
  createThumbnailWasabiStorage,
  endpointForRegion,
  validateWasabiRegion,
};

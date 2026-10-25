const { GetObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { endpointForRegion, SUPPORTED_WASABI_REGIONS } = require("./wasabi-regions");

class ThumbnailApiWasabiError extends Error {
  constructor(message) {
    super(message);
    this.name = "ThumbnailApiWasabiError";
  }
}

const createThumbnailApiWasabiStorage = ({
  bucket,
  region,
  accessKeyId,
  secretAccessKey,
  urlTtlSeconds = 3600,
} = {}) => {
  if (typeof bucket !== "string" || !bucket.trim()) {
    throw new ThumbnailApiWasabiError("Thumbnail API derived bucket is required.");
  }
  if (typeof region !== "string" || !SUPPORTED_WASABI_REGIONS.has(region)) {
    throw new ThumbnailApiWasabiError("Thumbnail API derived region is invalid.");
  }
  if (typeof accessKeyId !== "string" || !accessKeyId.trim()) {
    throw new ThumbnailApiWasabiError("Thumbnail API read access key is required.");
  }
  if (typeof secretAccessKey !== "string" || !secretAccessKey.trim()) {
    throw new ThumbnailApiWasabiError("Thumbnail API read secret is required.");
  }

  const normalizedBucket = bucket.trim();
  const normalizedRegion = region.trim();
  const ttl = Number.isInteger(urlTtlSeconds) ? urlTtlSeconds : 3600;

  const client = new S3Client({
    endpoint: endpointForRegion(normalizedRegion),
    region: normalizedRegion,
    credentials: {
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
    },
  });

  return Object.freeze({
    async getObjectAccessUrl({ Bucket = normalizedBucket, Key, expiresIn = ttl } = {}) {
      if (typeof Key !== "string" || !Key.trim()) {
        throw new ThumbnailApiWasabiError("Thumbnail API object key is required.");
      }
      if (typeof Bucket !== "string" || !Bucket.trim()) {
        throw new ThumbnailApiWasabiError("Thumbnail API bucket is required.");
      }

      const expires = Number(expiresIn);
      if (!Number.isInteger(expires) || expires < 1 || expires > 3600) {
        throw new ThumbnailApiWasabiError("Thumbnail API URL TTL must be between 1 and 3600 seconds.");
      }

      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), {
        expiresIn: expires,
      });
    },
  });
};

module.exports = {
  ThumbnailApiWasabiError,
  createThumbnailApiWasabiStorage,
  endpointForRegion,
  SUPPORTED_WASABI_REGIONS,
};

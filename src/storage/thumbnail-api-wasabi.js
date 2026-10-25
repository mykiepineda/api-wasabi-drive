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
  createClient = (options) => new S3Client(options),
  signUrl = getSignedUrl,
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
  if (!Number.isInteger(urlTtlSeconds) || urlTtlSeconds < 60 || urlTtlSeconds > 3600) {
    throw new ThumbnailApiWasabiError("Thumbnail API URL TTL must be between 60 and 3600 seconds.");
  }

  const client = createClient({
    endpoint: endpointForRegion(normalizedRegion),
    region: normalizedRegion,
    credentials: {
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
    },
  });

  return Object.freeze({
    async getObjectAccessUrl({ Key } = {}) {
      if (
        typeof Key !== "string"
        || Key !== Key.toLowerCase()
        || !/^v1\/([0-9a-f]{2})\/([0-9a-f]{64})\.webp$/i.test(Key)
        || Key.split("/")[1].toLowerCase() !== Key.split("/")[2].slice(0, 2).toLowerCase()
      ) {
        throw new ThumbnailApiWasabiError("Thumbnail API object key is invalid.");
      }

      return signUrl(client, new GetObjectCommand({ Bucket: normalizedBucket, Key }), {
        expiresIn: urlTtlSeconds,
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

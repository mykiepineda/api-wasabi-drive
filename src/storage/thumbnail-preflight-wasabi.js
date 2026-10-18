const { ListObjectsV2Command, S3Client } = require("@aws-sdk/client-s3");
const { endpointForRegion, SUPPORTED_WASABI_REGIONS } = require("./wasabi-regions");
const { validatePrefix, validateSourceBucket } = require("../thumbnail/preflight-scope");
const { MAX_PREFLIGHT_PAGE_SIZE } = require("../thumbnail/policy");

const createThumbnailPreflightStorage = ({
  bucket,
  prefix,
  region,
  accessKeyId,
  secretAccessKey,
  createClient = (options) => new S3Client(options),
}) => {
  if (
    !SUPPORTED_WASABI_REGIONS.has(region)
    || validateSourceBucket(bucket) !== bucket
    || validatePrefix(prefix) !== prefix
    || typeof accessKeyId !== "string"
    || !accessKeyId.trim()
    || typeof secretAccessKey !== "string"
    || !secretAccessKey.trim()
    || typeof createClient !== "function"
  ) {
    throw new Error("invalid-preflight-storage-configuration");
  }

  const client = createClient({
    region,
    endpoint: endpointForRegion(region),
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  return {
    async listPage({ pageSize, continuationToken }) {
      if (
        !Number.isSafeInteger(pageSize)
        || pageSize < 1
        || pageSize > MAX_PREFLIGHT_PAGE_SIZE
        || (
          continuationToken !== undefined
          && (typeof continuationToken !== "string" || !continuationToken)
        )
      ) {
        throw new Error("invalid-preflight-list-request");
      }
      const input = {
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: pageSize,
      };
      if (continuationToken !== undefined) {
        input.ContinuationToken = continuationToken;
      }
      return client.send(new ListObjectsV2Command(input));
    },
  };
};

module.exports = {
  createThumbnailPreflightStorage,
};

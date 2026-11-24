const { ListObjectsV2Command, S3Client } = require("@aws-sdk/client-s3");
const { endpointForRegion, SUPPORTED_WASABI_REGIONS } = require("./wasabi-regions");
const { validatePrefix, validateOptInV2Prefix, validateSourceBucket } = require("../thumbnail/preflight-scope");
const { MAX_PREFLIGHT_PAGE_SIZE } = require("../thumbnail/policy");

const createThumbnailPreflightStorage = ({
  bucket,
  prefix,
  region,
  wholeBucket = false,
  accessKeyId,
  secretAccessKey,
  sourceEnrollment,
  createClient = (options) => new S3Client(options),
}) => {
  if (
    !SUPPORTED_WASABI_REGIONS.has(region)
    || validateSourceBucket(bucket) !== bucket
    || (
      sourceEnrollment !== undefined
      && (
        !sourceEnrollment
        || typeof sourceEnrollment.isEnrolled !== "function"
        || !sourceEnrollment.isEnrolled(bucket, region)
      )
    )
    || (
      sourceEnrollment !== undefined
        ? (() => {
          try {
            validateOptInV2Prefix(prefix, wholeBucket);
            return false;
          } catch {
            return true;
          }
        })()
        : (
          (prefix !== "" && validatePrefix(prefix) !== prefix)
          || (prefix === "" && wholeBucket !== true)
        )
    )
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

const {
  GetObjectCommand,
  GetBucketLocationCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3ServiceException,
  S3Client,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const config = require("../config");
const { StorageProviderError } = require("../errors");

const transportErrorCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

const isProviderFailure = (error) => {
  const status = error?.$metadata?.httpStatusCode;
  return error instanceof S3ServiceException ||
    (Number.isInteger(status) && status >= 100 && status <= 599) ||
    error?.name === "TimeoutError" ||
    transportErrorCodes.has(error?.code);
};

const sendProviderRequest = async (client, command, operation) => {
  try {
    return await client.send(command);
  } catch (error) {
    if (error instanceof StorageProviderError) {
      throw error;
    }
    if (isProviderFailure(error)) {
      throw new StorageProviderError(operation, error);
    }
    throw error;
  }
};

const s3 = new S3Client({
  endpoint: config.wasabi.serviceUrl,
  region: config.wasabi.region,
  credentials: {
    accessKeyId: config.wasabi.accessKeyId,
    secretAccessKey: config.wasabi.secretAccessKey,
  },
});

const bucketRegions = new Map();
const regionalClients = new Map([[config.wasabi.region, s3]]);

const getListBuckets = () => {
  return sendProviderRequest(s3, new ListBucketsCommand({}), "ListBuckets");
};

const getRedirectRegion = (error, bucket) => {
  const statusCode = error?.$metadata?.httpStatusCode ?? error?.statusCode;
  const errorNames = [error?.name, error?.Code, error?.code];
  const endpoint = error?.Endpoint;

  if (statusCode !== 307 || !errorNames.includes("TemporaryRedirect") || typeof endpoint !== "string") {
    return undefined;
  }

  let hostname = endpoint;
  if (endpoint.includes("://")) {
    try {
      const parsedEndpoint = new URL(endpoint);
      if (
        parsedEndpoint.protocol !== "https:" ||
        parsedEndpoint.port ||
        parsedEndpoint.pathname !== "/" ||
        parsedEndpoint.search ||
        parsedEndpoint.hash ||
        parsedEndpoint.username ||
        parsedEndpoint.password
      ) {
        return undefined;
      }
      hostname = parsedEndpoint.hostname;
    } catch {
      return undefined;
    }
  }

  const escapedBucket = bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = hostname.match(new RegExp(`^${escapedBucket}\\.s3\\.([a-z0-9]+(?:-[a-z0-9]+)*-[0-9]+)\\.wasabisys\\.com$`, "i"));
  if (match) {
    return match[1].toLowerCase();
  }

  const usEastOneAlias = new RegExp(`^${escapedBucket}\\.s3\\.wasabisys\\.com$`, "i");
  return usEastOneAlias.test(hostname) ? "us-east-1" : undefined;
};

const normalizeRegion = (locationConstraint) => {
  const location = typeof locationConstraint === "string" ? locationConstraint.trim() : "";
  const closingTagIndex = location.lastIndexOf(">");
  const region = (closingTagIndex >= 0 ? location.substring(closingTagIndex + 1) : location).trim();

  if (!region) {
    return "us-east-1";
  }

  return region === "EU" ? "eu-west-1" : region;
};

const discoverBucketRegion = async (name) => {
  try {
    const results = await s3.send(new GetBucketLocationCommand({ Bucket: name }));
    return normalizeRegion(results?.LocationConstraint);
  } catch (error) {
    const redirectedRegion = getRedirectRegion(error, name);
    if (redirectedRegion) {
      return redirectedRegion;
    }
    if (!(error instanceof StorageProviderError) && isProviderFailure(error)) {
      throw new StorageProviderError("GetBucketLocation", error);
    }
    throw error;
  }
};

const resolveBucketRegion = (name) => {
  const cachedRegion = bucketRegions.get(name);
  if (cachedRegion) {
    return cachedRegion;
  }

  const regionPromise = discoverBucketRegion(name);
  bucketRegions.set(name, regionPromise);
  regionPromise.catch(() => {
    if (bucketRegions.get(name) === regionPromise) {
      bucketRegions.delete(name);
    }
  });
  return regionPromise;
};

const getBucketClient = async (name) => {
  const region = await resolveBucketRegion(name);
  const cachedClient = regionalClients.get(region);
  if (cachedClient) {
    return cachedClient;
  }

  const client = new S3Client({
    endpoint: `https://s3.${region}.wasabisys.com`,
    region,
    credentials: {
      accessKeyId: config.wasabi.accessKeyId,
      secretAccessKey: config.wasabi.secretAccessKey,
    },
  });
  regionalClients.set(region, client);
  return client;
};

const getBucketRegion = async (name) => {
  const region = await resolveBucketRegion(name);

  let longDescription, shortDescription;
  switch (region) {
    case "us-east-2":
      longDescription = "Wasabi US East 1 (N. Virginia)";
      shortDescription = "N. Virginia";
      break;
    case "us-central-1":
      longDescription = "Wasabi US Central 1 (Texas)";
      shortDescription = "Texas";
      break;
    case "us-west-1":
      longDescription = "Wasabi US West 1 (Oregon)";
      shortDescription = "Oregon";
      break;
    case "ca-central-1":
      longDescription = "Wasabi CA Central 1 (Toronto)";
      shortDescription = "Toronto";
      break;
    case "eu-central-1":
      longDescription = "Wasabi EU Central 1 (Amsterdam)";
      shortDescription = "Amsterdam";
      break;
    case "eu-central-2":
      longDescription = "Wasabi EU Central 2 (Frankfurt)";
      shortDescription = "Frankfurt";
      break;
    case "eu-west-1":
      longDescription = "Wasabi EU West 1 (London)";
      shortDescription = "London";
      break;
    case "eu-west-2":
      longDescription = "Wasabi EU West 2 (Paris)";
      shortDescription = "Paris";
      break;
    case "ap-northeast-1":
      longDescription = "Wasabi AP Northeast 1 (Tokyo)";
      shortDescription = "Tokyo";
      break;
    case "ap-northeast-2":
      longDescription = "Wasabi AP Northeast 2 (Osaka)";
      shortDescription = "Osaka";
      break;
    case "ap-southeast-1":
      longDescription = "Wasabi AP Southeast 1 (Singapore)";
      shortDescription = "Singapore";
      break;
    case "ap-southeast-2":
      longDescription = "Wasabi AP Southeast 2 (Sydney)";
      shortDescription = "Sydney";
      break;
  }

  let response = { region };

  if (longDescription) {
    response = {
      ...response,
      longDescription,
    };
  }

  if (shortDescription) {
    response = {
      ...response,
      shortDescription,
    };
  }

  return response;
};

const getListObjects = async (params) => {
  const { Bucket, Prefix, MaxKeys, ContinuationToken } = params;
  let bucketParams = {
    Bucket,
    Delimiter: "/",
  };
  if (Prefix) {
    bucketParams = { ...bucketParams, Prefix };
  }
  if (MaxKeys !== undefined) {
    bucketParams = { ...bucketParams, MaxKeys };
  }
  if (ContinuationToken) {
    bucketParams = { ...bucketParams, ContinuationToken };
  }

  const client = await getBucketClient(Bucket);
  return sendProviderRequest(
    client,
    new ListObjectsV2Command(bucketParams),
    "ListObjectsV2",
  );
};

const getObjectMetadataPage = async (params) => {
  const { Bucket, Prefix, MaxKeys, ContinuationToken } = params;
  const pageParams = { Bucket };
  if (Prefix !== undefined) {
    pageParams.Prefix = Prefix;
  }
  if (MaxKeys !== undefined) {
    pageParams.MaxKeys = MaxKeys;
  }
  if (ContinuationToken !== undefined) {
    pageParams.ContinuationToken = ContinuationToken;
  }

  const client = await getBucketClient(Bucket);
  return sendProviderRequest(
    client,
    new ListObjectsV2Command(pageParams),
    "ListObjectsV2",
  );
};

const getObjectAccessUrl = async ({ Bucket, Key }) => {
  const client = await getBucketClient(Bucket);
  return getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), {
    expiresIn: 3600,
  });
};

module.exports = {
  getListBuckets,
  getBucketRegion,
  getListObjects,
  getObjectMetadataPage,
  getObjectAccessUrl,
};
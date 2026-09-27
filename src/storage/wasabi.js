const {
  GetObjectCommand,
  GetBucketLocationCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3Client,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const config = require("../config");

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
  return s3.send(new ListBucketsCommand({}));
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
  return match?.[1]?.toLowerCase();
};

const normalizeRegion = (locationConstraint) => {
  if (typeof locationConstraint !== "string" || locationConstraint.trim() === "") {
    return config.wasabi.region;
  }

  const region = locationConstraint.trim();
  const closingTagIndex = region.lastIndexOf(">");
  return (closingTagIndex >= 0 ? region.substring(closingTagIndex + 1) : region).trim() || config.wasabi.region;
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
  if (MaxKeys) {
    bucketParams = { ...bucketParams, MaxKeys: parseInt(MaxKeys) };
  }
  if (ContinuationToken) {
    bucketParams = { ...bucketParams, ContinuationToken };
  }

  const client = await getBucketClient(Bucket);
  return client.send(new ListObjectsV2Command(bucketParams));
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
  getObjectAccessUrl,
};
const AWS = require("aws-sdk");
const config = require("../config");

AWS.config.update({
  accessKeyId: config.wasabi.accessKeyId,
  secretAccessKey: config.wasabi.secretAccessKey,
  endpoint: new AWS.Endpoint(config.wasabi.serviceUrl),
});

const s3 = new AWS.S3();

const getListBuckets = () => {
  return s3.listBuckets().promise();
};

const getBucketRegion = async (name) => {
  const results = await s3.getBucketLocation({ Bucket: name }).promise();

  let region = results.LocationConstraint;
  region = region.substring(region.lastIndexOf(">") + 1);

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

  return s3.listObjectsV2(bucketParams).promise();
};

const getTotalKeyCount = async (params) => {
  const { Bucket, Prefix } = params;

  let ListObjects = await getListObjects({ Bucket, Prefix });

  let IsTruncated = ListObjects.IsTruncated;
  let TotalKeyCount = ListObjects.KeyCount;
  let NextContinuationToken = ListObjects.NextContinuationToken;

  while (IsTruncated) {
    ListObjects = await getListObjects({
      Bucket,
      ContinuationToken: NextContinuationToken,
    });
    IsTruncated = ListObjects.IsTruncated;
    TotalKeyCount = TotalKeyCount + ListObjects.KeyCount;
    NextContinuationToken = ListObjects.NextContinuationToken;
  }
  return TotalKeyCount;
};

module.exports = {
  getListBuckets,
  getBucketRegion,
  getListObjects,
  getTotalKeyCount,
};
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

const getBucketLocation = (name) => {
  return s3.getBucketLocation({ Bucket: name }).promise();
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
  getBucketLocation,
  getListObjects,
  getTotalKeyCount,
};

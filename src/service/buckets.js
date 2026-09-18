const wasabi = require("../storage/wasabi");

const getListBuckets = () => {
  return wasabi.getListBuckets();
};

const getBucketRegion = (name) => {
  return wasabi.getBucketRegion(name);
};

const getListObjects = async (params) => {
  const TotalKeyCount = await wasabi.getTotalKeyCount({
    Bucket: params.Bucket,
    Prefix: params.Prefix,
  });

  const ListObjects = await wasabi.getListObjects(params);
  const response = { ...ListObjects, TotalKeyCount };

  if (!ListObjects.Contents?.length) {
    return response;
  }

  return {
    ...response,
    Contents: await Promise.all(ListObjects.Contents.map(async (object) => ({
      ...object,
      AccessUrl: await wasabi.getObjectAccessUrl({
        Bucket: params.Bucket,
        Key: object.Key,
      }),
    }))),
  };
};

module.exports = {
  getListBuckets,
  getBucketRegion,
  getListObjects,
};
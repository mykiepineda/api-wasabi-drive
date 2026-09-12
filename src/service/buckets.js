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

  return { ...ListObjects, TotalKeyCount };
};

module.exports = {
  getListBuckets,
  getBucketRegion,
  getListObjects,
};
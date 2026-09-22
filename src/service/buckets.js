const wasabi = require("../storage/wasabi");

const getListBuckets = () => {
  return wasabi.getListBuckets();
};

const getBucketRegion = (name) => {
  return wasabi.getBucketRegion(name);
};

const getListObjects = async (params) => {
  const ListObjects = await wasabi.getListObjects(params);

  if (!ListObjects.Contents?.length) {
    return ListObjects;
  }

  return {
    ...ListObjects,
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
const test = require("node:test");
const assert = require("node:assert/strict");

const storagePath = require.resolve("../src/storage/wasabi");
const servicePath = require.resolve("../src/service/buckets");
const originalStorageModule = require.cache[storagePath];
const storage = {
  getListBuckets: () => Promise.resolve(["bucket"]),
  getBucketRegion: () => Promise.resolve({ region: "us-east-2" }),
  getListObjects: () => Promise.resolve({ Contents: [] }),
  getTotalKeyCount: () => Promise.resolve(0),
};

require.cache[storagePath] = {
  id: storagePath,
  filename: storagePath,
  loaded: true,
  exports: storage,
};
const buckets = require(servicePath);

test.after(() => {
  delete require.cache[servicePath];
  if (originalStorageModule) {
    require.cache[storagePath] = originalStorageModule;
  } else {
    delete require.cache[storagePath];
  }
});

test("getListBuckets delegates to storage", async () => {
  const expected = [{ Name: "documents" }];
  storage.getListBuckets = () => Promise.resolve(expected);

  assert.equal(await buckets.getListBuckets(), expected);
});

test("getBucketRegion forwards the bucket name", async () => {
  let receivedName;
  storage.getBucketRegion = (name) => {
    receivedName = name;
    return Promise.resolve({ region: "eu-central-1" });
  };

  assert.deepEqual(await buckets.getBucketRegion("documents"), {
    region: "eu-central-1",
  });
  assert.equal(receivedName, "documents");
});

test("getListObjects combines objects with the total key count", async () => {
  let countParams;
  let listParams;
  storage.getTotalKeyCount = (params) => {
    countParams = params;
    return Promise.resolve(12);
  };
  storage.getListObjects = (params) => {
    listParams = params;
    return Promise.resolve({ Contents: [{ Key: "file.txt" }] });
  };

  const params = { Bucket: "documents", Prefix: "reports/" };
  assert.deepEqual(await buckets.getListObjects(params), {
    Contents: [{ Key: "file.txt" }],
    TotalKeyCount: 12,
  });
  assert.deepEqual(countParams, params);
  assert.equal(listParams, params);
});
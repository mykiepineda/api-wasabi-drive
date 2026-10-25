const test = require("node:test");
const assert = require("node:assert/strict");

const storagePath = require.resolve("../src/storage/wasabi");
const configPath = require.resolve("../src/config");
const thumbnailSignerPath = require.resolve("../src/storage/thumbnail-api-wasabi");
const servicePath = require.resolve("../src/service/buckets");
const { createThumbnailKey } = require("../src/thumbnail/key");
const originalStorageModule = require.cache[storagePath];
const originalConfigModule = require.cache[configPath];
const originalThumbnailSignerModule = require.cache[thumbnailSignerPath];
const storage = {
  getListBuckets: () => Promise.resolve(["bucket"]),
  getBucketRegion: () => Promise.resolve({ region: "us-east-2" }),
  getListObjects: () => Promise.resolve({ Contents: [] }),
  getObjectAccessUrl: () => Promise.resolve("https://example.test/fake-object-url"),
};

require.cache[storagePath] = {
  id: storagePath,
  filename: storagePath,
  loaded: true,
  exports: storage,
};
const buckets = require(servicePath);

const installConfig = (config) => {
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: config,
  };
};

const installThumbnailSigner = (impl) => {
  require.cache[thumbnailSignerPath] = {
    id: thumbnailSignerPath,
    filename: thumbnailSignerPath,
    loaded: true,
    exports: impl,
  };
};

test.after(() => {
  delete require.cache[servicePath];
  if (originalStorageModule) {
    require.cache[storagePath] = originalStorageModule;
  } else {
    delete require.cache[storagePath];
  }
  if (originalConfigModule) {
    require.cache[configPath] = originalConfigModule;
  } else {
    delete require.cache[configPath];
  }
  if (originalThumbnailSignerModule) {
    require.cache[thumbnailSignerPath] = originalThumbnailSignerModule;
  } else {
    delete require.cache[thumbnailSignerPath];
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

test("getListObjects delegates once and preserves listing metadata while signing objects", async () => {
  let listParams;
  let listCallCount = 0;
  storage.getListObjects = (params) => {
    listParams = params;
    listCallCount += 1;
    return Promise.resolve({
      Contents: [{ Key: "file.txt", Size: 42, ETag: "etag" }],
      CommonPrefixes: [{ Prefix: "nested/" }],
      IsTruncated: true,
      NextContinuationToken: "next-token",
      ContinuationToken: "current-token",
      KeyCount: 1,
      MaxKeys: 25,
      Prefix: "reports/",
    });
  };
  storage.getObjectAccessUrl = ({ Bucket, Key }) => {
    assert.equal(Bucket, "documents");
    assert.equal(Key, "file.txt");
    return Promise.resolve("https://example.test/file.txt");
  };

  const params = { Bucket: "documents", Prefix: "reports/" };
  assert.deepEqual(await buckets.getListObjects(params), {
    Contents: [{ Key: "file.txt", Size: 42, ETag: "etag", AccessUrl: "https://example.test/file.txt" }],
    CommonPrefixes: [{ Prefix: "nested/" }],
    IsTruncated: true,
    NextContinuationToken: "next-token",
    ContinuationToken: "current-token",
    KeyCount: 1,
    MaxKeys: 25,
    Prefix: "reports/",
  });
  assert.equal(listParams, params);
  assert.equal(listCallCount, 1);
});

test("getListObjects signs multiple objects without signing common prefixes", async () => {
  const received = [];
  storage.getListObjects = () => Promise.resolve({
    Contents: [{ Key: "one.txt", Size: 1 }, { Key: "two.txt", Size: 2 }],
    CommonPrefixes: [{ Prefix: "folder/" }],
  });
  storage.getObjectAccessUrl = (params) => {
    received.push(params);
    return Promise.resolve(`https://example.test/${params.Key}`);
  };

  assert.deepEqual(await buckets.getListObjects({ Bucket: "documents" }), {
    Contents: [
      { Key: "one.txt", Size: 1, AccessUrl: "https://example.test/one.txt" },
      { Key: "two.txt", Size: 2, AccessUrl: "https://example.test/two.txt" },
    ],
    CommonPrefixes: [{ Prefix: "folder/" }],
  });
  assert.deepEqual(received, [
    { Bucket: "documents", Key: "one.txt" },
    { Bucket: "documents", Key: "two.txt" },
  ]);
});

test("getListObjects preserves absent or empty contents", async () => {
  storage.getObjectAccessUrl = () => {
    throw new Error("should not sign an empty page");
  };

  storage.getListObjects = () => Promise.resolve({ IsTruncated: false });
  assert.deepEqual(await buckets.getListObjects({ Bucket: "documents" }), {
    IsTruncated: false,
  });

  storage.getListObjects = () => Promise.resolve({ Contents: [], KeyCount: 0 });
  assert.deepEqual(await buckets.getListObjects({ Bucket: "documents" }), {
    Contents: [],
    KeyCount: 0,
  });
});

test("getListObjects propagates signing failures", async () => {
  storage.getListObjects = () => Promise.resolve({ Contents: [{ Key: "file.txt" }] });
  storage.getObjectAccessUrl = () => Promise.reject(new Error("signing failed"));

  await assert.rejects(
    buckets.getListObjects({ Bucket: "documents" }),
    { message: "signing failed" },
  );
});

test("getListBuckets hides internal buckets and getListObjects adds ThumbnailAccessUrl for allowlisted derived objects", async () => {
  const sourceKey = "photos/pilot.jpg";
  const sourceEtag = '"abc"';
  const allowedKey = createThumbnailKey({
    sourceRegion: "ap-northeast-1",
    sourceBucket: "source-bucket",
    sourceKey,
    etag: sourceEtag,
  });

  installConfig({
    wasabi: { internalBucketSet: new Set(["internal-derived"]), internalBuckets: ["internal-derived"] },
    thumbnailApi: {
      enabled: true,
      sourceBucket: "source-bucket",
      sourceRegion: "ap-northeast-1",
      sourcePrefix: "photos/",
      derivedBucket: "derived-bucket",
      derivedRegion: "ap-southeast-1",
      allowedKeys: new Set([allowedKey]),
      readAccessKeyId: "test-read-key",
      readSecretAccessKey: "test-read-secret",
      urlTtlSeconds: 3600,
    },
  });
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => ({
      getObjectAccessUrl: ({ Bucket, Key }) => Promise.resolve(`https://thumb.example/${Bucket}/${Key}`),
    }),
  });

  delete require.cache[servicePath];
  const testBuckets = require(servicePath);

  storage.getListBuckets = () => Promise.resolve({ Buckets: [{ Name: "source-bucket" }, { Name: "internal-derived" }, { Name: "other-bucket" }] });
  storage.getBucketRegion = async (bucket) => ({ region: bucket === "source-bucket" ? "ap-northeast-1" : "us-east-1" });
  storage.getListObjects = () => Promise.resolve({
    Contents: [{ Key: sourceKey, Size: 123, ETag: sourceEtag }],
  });
  storage.getObjectAccessUrl = ({ Key }) => Promise.resolve(`https://source.example/${Key}`);

  assert.deepEqual(await testBuckets.getListBuckets(), {
    Buckets: [{ Name: "source-bucket" }, { Name: "other-bucket" }],
  });

  const result = await testBuckets.getListObjects({ Bucket: "source-bucket", Prefix: "photos/" });
  assert.deepEqual(result.Contents, [{
    Key: sourceKey,
    Size: 123,
    ETag: sourceEtag,
    AccessUrl: `https://source.example/${sourceKey}`,
    ThumbnailAccessUrl: `https://thumb.example/derived-bucket/${allowedKey}`,
  }]);
});

test("internal bucket names are rejected before listing or region lookup", async () => {
  installConfig({
    wasabi: { internalBucketSet: new Set(["internal-derived"]), internalBuckets: ["internal-derived"] },
    thumbnailApi: { enabled: false },
  });

  await assert.rejects(() => buckets.getBucketRegion("internal-derived"), { name: "NotFoundError" });
  await assert.rejects(() => buckets.getListObjects({ Bucket: "internal-derived" }), { name: "NotFoundError" });
});
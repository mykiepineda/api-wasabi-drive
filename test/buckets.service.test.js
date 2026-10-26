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
const testConfig = {
  wasabi: { internalBucketSet: new Set(), internalBuckets: [] },
  thumbnailApi: { enabled: false },
};
let thumbnailSignerFactory = () => {
  throw new Error("thumbnail signer was not configured in this test");
};
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
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: testConfig,
};
require.cache[thumbnailSignerPath] = {
  id: thumbnailSignerPath,
  filename: thumbnailSignerPath,
  loaded: true,
  exports: {
    createThumbnailApiWasabiStorage: (...args) => thumbnailSignerFactory(...args),
  },
};
const buckets = require(servicePath);

const installConfig = (config) => {
  Object.assign(testConfig, config);
};

const installThumbnailSigner = (impl) => {
  thumbnailSignerFactory = impl.createThumbnailApiWasabiStorage;
};

const configureThumbnail = ({
  sourceBucket = "source-bucket",
  sourceRegion = "ap-northeast-1",
  sourcePrefix = "photos/",
  derivedBucket = "derived-bucket",
  derivedRegion = "ap-southeast-1",
  allowedKeys = new Set(),
} = {}) => {
  installConfig({
    wasabi: { internalBucketSet: new Set(["internal-derived"]), internalBuckets: ["internal-derived"] },
    thumbnailApi: {
      enabled: true,
      sourceBucket,
      sourceRegion,
      sourcePrefix,
      derivedBucket,
      derivedRegion,
      allowedKeys,
      readAccessKeyId: "synthetic-read-access",
      readSecretAccessKey: "synthetic-read-secret",
      urlTtlSeconds: 3600,
    },
  });
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
  let regionCallCount = 0;
  storage.getBucketRegion = async () => {
    regionCallCount += 1;
    return { region: "ap-northeast-1" };
  };
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
  assert.equal(regionCallCount, 0);
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

  configureThumbnail({ allowedKeys: new Set([allowedKey]) });
  let signerOptions;
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: (options) => {
      signerOptions = options;
      return {
        getObjectAccessUrl: ({ Key }) => Promise.resolve(`https://thumb.example/derived-bucket/${Key}`),
      };
    },
  });

  delete require.cache[servicePath];
  const testBuckets = require(servicePath);

  storage.getListBuckets = () => Promise.resolve({
    Owner: { ID: "synthetic-owner" },
    Buckets: [{ Name: "source-bucket" }, { Name: "internal-derived" }, { Name: "other-bucket" }],
  });
  storage.getBucketRegion = async (bucket) => ({ region: bucket === "source-bucket" ? "ap-northeast-1" : "us-east-1" });
  storage.getListObjects = () => Promise.resolve({
    Contents: [{ Key: sourceKey, Size: 123, ETag: sourceEtag }],
  });
  storage.getObjectAccessUrl = ({ Key }) => Promise.resolve(`https://source.example/${Key}`);

  assert.deepEqual(await testBuckets.getListBuckets(), {
    Owner: { ID: "synthetic-owner" },
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
  assert.deepEqual(signerOptions, {
    bucket: "derived-bucket",
    region: "ap-southeast-1",
    accessKeyId: "synthetic-read-access",
    secretAccessKey: "synthetic-read-secret",
    urlTtlSeconds: 3600,
  });
});

test("internal bucket names are rejected before listing or region lookup", async () => {
  installConfig({
    wasabi: { internalBucketSet: new Set(["internal-derived"]), internalBuckets: ["internal-derived"] },
    thumbnailApi: { enabled: false },
  });
  let storageCalls = 0;
  storage.getBucketRegion = async () => {
    storageCalls += 1;
    return { region: "ap-southeast-1" };
  };
  storage.getListObjects = async () => {
    storageCalls += 1;
    return { Contents: [] };
  };

  await assert.rejects(() => buckets.getBucketRegion("internal-derived"), { name: "NotFoundError" });
  await assert.rejects(() => buckets.getListObjects({ Bucket: "internal-derived" }), { name: "NotFoundError" });
  assert.equal(storageCalls, 0);
});

test("unquoted and quoted ETags produce the same exact allowlisted candidate", async () => {
  const sourceKey = "photos/synthetic.jpg";
  const allowedKey = createThumbnailKey({
    sourceRegion: "ap-northeast-1",
    sourceBucket: "source-bucket",
    sourceKey,
    etag: "synthetic-etag",
  });
  configureThumbnail({ allowedKeys: new Set([allowedKey]) });
  let signedKeys = [];
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => ({
      getObjectAccessUrl: ({ Key }) => {
        signedKeys.push(Key);
        return Promise.resolve("https://thumb.example/signed");
      },
    }),
  });
  storage.getBucketRegion = async () => ({ region: "ap-northeast-1" });
  storage.getListObjects = async () => ({
    Contents: [{ Key: sourceKey, Size: 99, ETag: '"synthetic-etag"' }],
    CommonPrefixes: [{ Prefix: "photos/nested/" }],
    IsTruncated: true,
    NextContinuationToken: "synthetic-next",
  });
  storage.getObjectAccessUrl = async () => "https://source.example/original";

  const result = await buckets.getListObjects({ Bucket: "source-bucket", Prefix: "photos/" });

  assert.deepEqual(signedKeys, [allowedKey]);
  assert.equal(result.Contents[0].ThumbnailAccessUrl, "https://thumb.example/signed");
  assert.equal(result.Contents[0].AccessUrl, "https://source.example/original");
  assert.deepEqual(result.CommonPrefixes, [{ Prefix: "photos/nested/" }]);
  assert.equal(result.IsTruncated, true);
  assert.equal(result.NextContinuationToken, "synthetic-next");
});

test("missing, changed, invalid, unsupported and out-of-prefix objects are not signed", async () => {
  const key = "photos/synthetic.jpg";
  const etag = "synthetic-etag";
  const allowedKey = createThumbnailKey({
    sourceRegion: "ap-northeast-1",
    sourceBucket: "source-bucket",
    sourceKey: key,
    etag,
  });
  configureThumbnail({ allowedKeys: new Set([allowedKey]) });
  let signerCalls = 0;
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => ({
      getObjectAccessUrl: async () => {
        signerCalls += 1;
        return "https://thumb.example/signed";
      },
    }),
  });
  storage.getBucketRegion = async () => ({ region: "ap-northeast-1" });
  storage.getListObjects = async () => ({
    Contents: [
      { Key: key, Size: 99 },
      { Key: key, Size: 99, ETag: "changed-etag" },
      { Key: key, Size: 99, ETag: '"broken-etag' },
      { Key: "photos/readme.txt", Size: 99, ETag: etag },
      { Key: "photos-other/synthetic.jpg", Size: 99, ETag: etag },
      { Key: "photos/folder/", Size: 0, ETag: etag },
    ],
  });
  storage.getObjectAccessUrl = async ({ Key }) => `https://source.example/${Key}`;

  const result = await buckets.getListObjects({ Bucket: "source-bucket", Prefix: "photos/" });

  assert.equal(signerCalls, 0);
  assert.equal(result.Contents.every((object) => !Object.hasOwn(object, "ThumbnailAccessUrl")), true);
});

test("different source bucket or resolved region never signs same-named objects", async () => {
  configureThumbnail({
    allowedKeys: new Set([createThumbnailKey({
      sourceRegion: "ap-northeast-1",
      sourceBucket: "source-bucket",
      sourceKey: "photos/same.jpg",
      etag: "synthetic-etag",
    })]),
  });
  let signerCalls = 0;
  let regionCalls = 0;
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => ({
      getObjectAccessUrl: async () => {
        signerCalls += 1;
        return "https://thumb.example/signed";
      },
    }),
  });
  storage.getBucketRegion = async () => {
    regionCalls += 1;
    return { region: "ap-northeast-2" };
  };
  storage.getListObjects = async () => ({
    Contents: [{ Key: "photos/same.jpg", Size: 10, ETag: "synthetic-etag" }],
  });
  storage.getObjectAccessUrl = async () => "https://source.example/original";

  const otherBucket = await buckets.getListObjects({ Bucket: "another-source", Prefix: "photos/" });
  assert.equal(Object.hasOwn(otherBucket.Contents[0], "ThumbnailAccessUrl"), false);
  assert.equal(regionCalls, 0);

  const changedRegion = await buckets.getListObjects({ Bucket: "source-bucket", Prefix: "photos/" });
  assert.equal(Object.hasOwn(changedRegion.Contents[0], "ThumbnailAccessUrl"), false);
  assert.equal(regionCalls, 1);
  assert.equal(signerCalls, 0);
});

test("one region resolution is reused for all candidates and signer failure is safely aggregated", async () => {
  const candidates = [
    { Key: "photos/one.jpg", Size: 12, ETag: "etag-one" },
    { Key: "photos/two.jpg", Size: 13, ETag: "etag-two" },
  ];
  const allowlist = new Set(candidates.map((object) => createThumbnailKey({
    sourceRegion: "ap-northeast-1",
    sourceBucket: "source-bucket",
    sourceKey: object.Key,
    etag: object.ETag,
  })));
  configureThumbnail({ allowedKeys: allowlist });
  let regionCalls = 0;
  let signerCalls = 0;
  let originalCalls = 0;
  const logRecords = [];
  const originalWarn = console.warn;
  console.warn = (record) => logRecords.push(String(record));
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => ({
      getObjectAccessUrl: async () => {
        signerCalls += 1;
        throw new Error("synthetic-secret https://example.test/?signature=private");
      },
    }),
  });
  storage.getBucketRegion = async () => {
    regionCalls += 1;
    return { region: "ap-northeast-1" };
  };
  storage.getListObjects = async () => ({ Contents: candidates });
  storage.getObjectAccessUrl = async ({ Key }) => {
    originalCalls += 1;
    return `https://source.example/${Key}`;
  };

  try {
    const result = await buckets.getListObjects({ Bucket: "source-bucket", Prefix: "photos/" });

    assert.equal(regionCalls, 1);
    assert.equal(signerCalls, 2);
    assert.equal(originalCalls, 2);
    assert.equal(result.Contents.every((object) => object.AccessUrl.startsWith("https://source.example/")), true);
    assert.equal(result.Contents.every((object) => !Object.hasOwn(object, "ThumbnailAccessUrl")), true);
    assert.equal(logRecords.length, 1);
    assert.deepEqual(JSON.parse(logRecords[0]), {
      level: "warn",
      operation: "thumbnailSigning",
      errorCategory: "signing",
      count: 2,
    });
    assert.equal(logRecords.join("").includes("synthetic-secret"), false);
    assert.equal(logRecords.join("").includes("signature=private"), false);
    assert.equal(logRecords.join("").includes("photos/"), false);
    assert.equal(logRecords.join("").includes("etag-one"), false);
  } finally {
    console.warn = originalWarn;
  }
});

test("empty pages do not resolve source regions or initialize the signer", async () => {
  configureThumbnail({ allowedKeys: new Set() });
  let regionCalls = 0;
  let signerCalls = 0;
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => {
      signerCalls += 1;
      return { getObjectAccessUrl: async () => "https://thumb.example/signed" };
    },
  });
  storage.getBucketRegion = async () => {
    regionCalls += 1;
    return { region: "ap-northeast-1" };
  };
  storage.getListObjects = async () => ({ Contents: [], KeyCount: 0 });

  assert.deepEqual(await buckets.getListObjects({ Bucket: "source-bucket" }), {
    Contents: [],
    KeyCount: 0,
  });
  assert.equal(regionCalls, 0);
  assert.equal(signerCalls, 0);
});
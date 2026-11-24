const test = require("node:test");
const assert = require("node:assert/strict");

const storagePath = require.resolve("../src/storage/wasabi");
const configPath = require.resolve("../src/config");
const thumbnailSignerPath = require.resolve("../src/storage/thumbnail-api-wasabi");
const servicePath = require.resolve("../src/service/buckets");
const { createThumbnailKey } = require("../src/thumbnail/key");
const { MAX_SOURCE_BYTES } = require("../src/thumbnail/policy");
const { validateSourceEnrollment } = require("../src/thumbnail/source-enrollment");
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

const configureV2Thumbnail = ({
  enabled = true,
  sourceBucket = "sydney-source",
  sourceRegion = "ap-southeast-2",
  sourcePrefix = "photos/",
  sourceEnrollments,
} = {}) => {
  installConfig({
    wasabi: { internalBucketSet: new Set(["internal-derived"]), internalBuckets: ["internal-derived"] },
    thumbnailApi: {
      enabled: false,
      allowedKeys: new Set(),
      derivedBucket: "derived-bucket",
      derivedRegion: "ap-southeast-1",
      readAccessKeyId: "synthetic-read-access",
      readSecretAccessKey: "synthetic-read-secret",
      urlTtlSeconds: 3600,
      v2: {
        enabled,
        sourceBucket,
        sourceRegion,
        sourcePrefix,
        sourceEnrollments,
      },
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

test("v2 signs eligible scoped objects from the current normalized listing ETag and preserves page data", async () => {
  configureV2Thumbnail();
  const contents = [
    { Key: "photos/one.jpg", Size: 100, ETag: '"etag-one"' },
    { Key: "photos/two.png", Size: 200, ETag: "etag-two" },
    { Key: "photos/three.webp", Size: 300, ETag: "etag-three" },
    { Key: "photos/one.jpg", Size: 100, ETag: "changed-etag" },
    { Key: "photos/boundary.jpg", Size: MAX_SOURCE_BYTES, ETag: "etag-boundary" },
    { Key: "photos/zero.jpg", Size: 0, ETag: "etag-zero" },
    { Key: "photos/folder/", Size: 0, ETag: "etag-folder" },
    { Key: "photos/missing-etag.jpg", Size: 100 },
    { Key: "photos/invalid-etag.jpg", Size: 100, ETag: '"malformed' },
    { Key: "photos/large.jpg", Size: MAX_SOURCE_BYTES + 1, ETag: "etag-large" },
    { Key: "photos/readme.txt", Size: 100, ETag: "etag-text" },
    { Key: "photos/raw.CR2", Size: 100, ETag: '"etag-cr2"' },
    { Key: "photos/raw.nef", Size: 100, ETag: "etag-nef" },
    { Key: "photos-other/outside.jpg", Size: 100, ETag: "etag-outside" },
  ];
  const expectedKeys = [
    createThumbnailKey({
      formatVersion: "v2",
      sourceRegion: "ap-southeast-2",
      sourceBucket: "sydney-source",
      completeSourceKey: "photos/one.jpg",
      normalizedETag: "etag-one",
    }),
    createThumbnailKey({
      formatVersion: "v2",
      sourceRegion: "ap-southeast-2",
      sourceBucket: "sydney-source",
      completeSourceKey: "photos/two.png",
      normalizedETag: "etag-two",
    }),
    createThumbnailKey({
      formatVersion: "v2",
      sourceRegion: "ap-southeast-2",
      sourceBucket: "sydney-source",
      completeSourceKey: "photos/three.webp",
      normalizedETag: "etag-three",
    }),
    createThumbnailKey({
      formatVersion: "v2",
      sourceRegion: "ap-southeast-2",
      sourceBucket: "sydney-source",
      completeSourceKey: "photos/one.jpg",
      normalizedETag: "changed-etag",
    }),
    createThumbnailKey({
      formatVersion: "v2",
      sourceRegion: "ap-southeast-2",
      sourceBucket: "sydney-source",
      completeSourceKey: "photos/boundary.jpg",
      normalizedETag: "etag-boundary",
    }),
    createThumbnailKey({
      formatVersion: "v2",
      sourceRegion: "ap-southeast-2",
      sourceBucket: "sydney-source",
      completeSourceKey: "photos/raw.CR2",
      normalizedETag: "etag-cr2",
    }),
  ];
  const signedKeys = [];
  let regionCalls = 0;
  storage.getBucketRegion = async () => {
    regionCalls += 1;
    return { region: "ap-southeast-2" };
  };
  storage.getListObjects = async () => ({
    Contents: contents,
    CommonPrefixes: [{ Prefix: "photos/nested/" }],
    IsTruncated: true,
    NextContinuationToken: "next-page",
  });
  storage.getObjectAccessUrl = async ({ Bucket, Key }) => `https://source.example/${Bucket}/${Key}`;
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: (options) => {
      assert.equal(options.bucket, "derived-bucket");
      assert.equal(options.region, "ap-southeast-1");
      assert.equal(options.accessKeyId, "synthetic-read-access");
      assert.equal(options.secretAccessKey, "synthetic-read-secret");
      return {
        getObjectAccessUrl: async ({ Key }) => {
          signedKeys.push(Key);
          return `https://thumbnail.example/${Key}`;
        },
      };
    },
  });

  const result = await buckets.getListObjects({ Bucket: "sydney-source", Prefix: "photos/" });

  assert.equal(regionCalls, 1);
  assert.deepEqual(signedKeys, expectedKeys);
  assert.notEqual(expectedKeys[0], expectedKeys[3]);
  assert.equal(result.Contents[0].ThumbnailAccessUrl, `https://thumbnail.example/${expectedKeys[0]}`);
  assert.equal(result.Contents[1].ThumbnailAccessUrl, `https://thumbnail.example/${expectedKeys[1]}`);
  assert.equal(result.Contents[2].ThumbnailAccessUrl, `https://thumbnail.example/${expectedKeys[2]}`);
  assert.equal(result.Contents[3].ThumbnailAccessUrl, `https://thumbnail.example/${expectedKeys[3]}`);
  assert.equal(result.Contents[4].ThumbnailAccessUrl, `https://thumbnail.example/${expectedKeys[4]}`);
  assert.equal(result.Contents[11].ThumbnailAccessUrl, `https://thumbnail.example/${expectedKeys[5]}`);
  assert.equal(result.Contents.every((object) => object.AccessUrl.startsWith("https://source.example/")), true);
  assert.equal(result.Contents.slice(5, 11).every((object) => !Object.hasOwn(object, "ThumbnailAccessUrl")), true);
  assert.equal(Object.hasOwn(result.Contents[12], "ThumbnailAccessUrl"), false);
  assert.equal(Object.hasOwn(result.Contents[13], "ThumbnailAccessUrl"), false);
  assert.deepEqual(result.CommonPrefixes, [{ Prefix: "photos/nested/" }]);
  assert.equal(result.IsTruncated, true);
  assert.equal(result.NextContinuationToken, "next-page");
});

test("v2 requires the configured source bucket and resolved region; disabled v2 does not look up or sign", async () => {
  const candidate = { Key: "photos/synthetic.jpg", Size: 123, ETag: "synthetic-etag" };
  let regionCalls = 0;
  let signerCalls = 0;
  storage.getBucketRegion = async () => {
    regionCalls += 1;
    return { region: "ap-southeast-1" };
  };
  storage.getListObjects = async () => ({ Contents: [candidate] });
  storage.getObjectAccessUrl = async () => "https://source.example/original";
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => {
      signerCalls += 1;
      return { getObjectAccessUrl: async () => "https://thumbnail.example/signed" };
    },
  });

  configureV2Thumbnail();
  const wrongBucket = await buckets.getListObjects({ Bucket: "other-source" });
  assert.equal(Object.hasOwn(wrongBucket.Contents[0], "ThumbnailAccessUrl"), false);
  assert.equal(regionCalls, 0);

  const wrongRegion = await buckets.getListObjects({ Bucket: "sydney-source" });
  assert.equal(Object.hasOwn(wrongRegion.Contents[0], "ThumbnailAccessUrl"), false);
  assert.equal(regionCalls, 1);

  configureV2Thumbnail({ enabled: false });
  const disabled = await buckets.getListObjects({ Bucket: "sydney-source" });
  assert.equal(Object.hasOwn(disabled.Contents[0], "ThumbnailAccessUrl"), false);
  assert.equal(regionCalls, 1);
  assert.equal(signerCalls, 0);
});

test("v2 signing failures preserve original URLs and emit only sanitized aggregate logs", async () => {
  configureV2Thumbnail();
  const originalWarn = console.warn;
  const records = [];
  console.warn = (record) => records.push(String(record));
  storage.getBucketRegion = async () => ({ region: "ap-southeast-2" });
  storage.getListObjects = async () => ({
    Contents: [{ Key: "photos/private.jpg", Size: 100, ETag: "private-etag" }],
  });
  storage.getObjectAccessUrl = async () => "https://source.example/original";
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => ({
      getObjectAccessUrl: async () => {
        throw new Error("private-etag https://signed.example/private-signature");
      },
    }),
  });

  try {
    const result = await buckets.getListObjects({ Bucket: "sydney-source" });

    assert.equal(result.Contents[0].AccessUrl, "https://source.example/original");
    assert.equal(Object.hasOwn(result.Contents[0], "ThumbnailAccessUrl"), false);
    assert.equal(records.length, 1);
    assert.deepEqual(JSON.parse(records[0]), {
      level: "warn",
      operation: "thumbnailSigning",
      errorCategory: "signing",
      count: 1,
    });
    assert.equal(records.join("").includes("private-etag"), false);
    assert.equal(records.join("").includes("private-signature"), false);
  } finally {
    console.warn = originalWarn;
  }
});

test("v2 signer initialization failure preserves original URLs and emits a sanitized category", async () => {
  configureV2Thumbnail();
  const originalWarn = console.warn;
  const records = [];
  console.warn = (record) => records.push(String(record));
  storage.getBucketRegion = async () => ({ region: "ap-southeast-2" });
  storage.getListObjects = async () => ({
    Contents: [{ Key: "photos/private.jpg", Size: 100, ETag: "private-etag" }],
  });
  storage.getObjectAccessUrl = async () => "https://source.example/original";
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => {
      throw new Error("private secret and private-etag");
    },
  });

  try {
    const result = await buckets.getListObjects({ Bucket: "sydney-source" });

    assert.equal(result.Contents[0].AccessUrl, "https://source.example/original");
    assert.equal(Object.hasOwn(result.Contents[0], "ThumbnailAccessUrl"), false);
    assert.equal(records.length, 1);
    assert.deepEqual(JSON.parse(records[0]), {
      level: "warn",
      operation: "thumbnailSigning",
      errorCategory: "signer_initialization",
      count: 1,
    });
    assert.equal(records.join("").includes("private"), false);
  } finally {
    console.warn = originalWarn;
  }
});

test("v2 region-resolution failure preserves original URLs and emits a sanitized aggregate log", async () => {
  configureV2Thumbnail();
  const originalWarn = console.warn;
  const records = [];
  let signerCalls = 0;
  console.warn = (record) => records.push(String(record));
  storage.getBucketRegion = async () => {
    throw new Error("private-etag https://provider.example/private-error");
  };
  storage.getListObjects = async () => ({
    Contents: [{ Key: "photos/private.jpg", Size: 100, ETag: "private-etag" }],
  });
  storage.getObjectAccessUrl = async () => "https://source.example/original";
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => {
      signerCalls += 1;
      return { getObjectAccessUrl: async () => "https://thumbnail.example/signed" };
    },
  });

  try {
    const result = await buckets.getListObjects({ Bucket: "sydney-source" });

    assert.equal(result.Contents[0].AccessUrl, "https://source.example/original");
    assert.equal(Object.hasOwn(result.Contents[0], "ThumbnailAccessUrl"), false);
    assert.equal(signerCalls, 0);
    assert.equal(records.length, 1);
    assert.deepEqual(JSON.parse(records[0]), {
      level: "warn",
      operation: "thumbnailSigning",
      errorCategory: "region_resolution",
      count: 1,
    });
    assert.equal(records.join("").includes("private-etag"), false);
    assert.equal(records.join("").includes("private-error"), false);
  } finally {
    console.warn = originalWarn;
  }
});

test("empty v2 listings do not resolve a region or initialize the thumbnail signer", async () => {
  configureV2Thumbnail();
  let regionCalls = 0;
  let signerCalls = 0;
  storage.getBucketRegion = async () => {
    regionCalls += 1;
    return { region: "ap-southeast-2" };
  };
  storage.getListObjects = async () => ({
    Contents: [],
    IsTruncated: false,
    KeyCount: 0,
  });
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => {
      signerCalls += 1;
      return { getObjectAccessUrl: async () => "https://thumbnail.example/signed" };
    },
  });

  assert.deepEqual(await buckets.getListObjects({ Bucket: "sydney-source" }), {
    Contents: [],
    IsTruncated: false,
    KeyCount: 0,
  });
  assert.equal(regionCalls, 0);
  assert.equal(signerCalls, 0);
});

test("bucket opt-in covers root and nested keys across enrolled buckets and no other bucket", async () => {
  const enrollment = validateSourceEnrollment([
    { bucket: "multi-source", region: "ap-southeast-2" },
    { bucket: "second-source", region: "us-east-1" },
  ], {
    stage: "test",
    derivedBucket: "derived-bucket",
    derivedRegion: "ap-southeast-1",
    internalBuckets: ["internal-derived"],
  });
  configureV2Thumbnail({
    sourceEnrollments: enrollment,
  });
  const contents = [
    { Key: "root.jpg", Size: 100, ETag: "root-etag" },
    { Key: "deep/photos/nested.png", Size: 200, ETag: "nested-etag" },
  ];
  const signedKeys = [];
  let regionCalls = 0;
  storage.getBucketRegion = async () => {
    regionCalls += 1;
    return { region: "ap-southeast-2" };
  };
  storage.getListObjects = async () => ({ Contents: contents });
  storage.getObjectAccessUrl = async ({ Key }) => `https://source.example/${Key}`;
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => ({
      getObjectAccessUrl: async ({ Key }) => {
        signedKeys.push(Key);
        return `https://thumbnail.example/${Key}`;
      },
    }),
  });

  const result = await buckets.getListObjects({ Bucket: "multi-source", Prefix: "ignored/" });
  assert.equal(regionCalls, 1);
  assert.equal(signedKeys.length, 2);
  assert.equal(result.Contents[0].AccessUrl, "https://source.example/root.jpg");
  assert.equal(Object.hasOwn(result.Contents[0], "ThumbnailAccessUrl"), true);
  assert.equal(Object.hasOwn(result.Contents[1], "ThumbnailAccessUrl"), true);

  const wrong = await buckets.getListObjects({ Bucket: "not-enrolled" });
  assert.equal(Object.hasOwn(wrong.Contents[0], "ThumbnailAccessUrl"), false);
  assert.equal(regionCalls, 1);
});

test("v1 exact candidate retains precedence and v2 signs other eligible objects in an overlapping bucket", async () => {
  const sourceKey = "photos/pilot.jpg";
  const sourceRegion = "ap-southeast-2";
  const v1Key = createThumbnailKey({
    sourceRegion,
    sourceBucket: "multi-source",
    sourceKey,
    etag: "pilot-etag",
  });
  const enrollment = validateSourceEnrollment([
    { bucket: "multi-source", region: sourceRegion },
  ], {
    stage: "test",
    derivedBucket: "derived-bucket",
    derivedRegion: "ap-southeast-1",
    internalBuckets: ["internal-derived"],
  });
  installConfig({
    wasabi: { internalBucketSet: new Set(["internal-derived"]), internalBuckets: ["internal-derived"] },
    thumbnailApi: {
      enabled: true,
      sourceBucket: "multi-source",
      sourceRegion,
      sourcePrefix: "photos/",
      allowedKeys: new Set([v1Key]),
      derivedBucket: "derived-bucket",
      derivedRegion: "ap-southeast-1",
      readAccessKeyId: "synthetic-read-access",
      readSecretAccessKey: "synthetic-read-secret",
      urlTtlSeconds: 3600,
      v2: {
        enabled: true,
        sourceEnrollments: enrollment,
      },
    },
  });
  const signedKeys = [];
  storage.getBucketRegion = async () => ({ region: sourceRegion });
  storage.getListObjects = async () => ({
    Contents: [
      { Key: sourceKey, Size: 100, ETag: "pilot-etag" },
      { Key: "other/deep.jpg", Size: 100, ETag: "other-etag" },
    ],
  });
  storage.getObjectAccessUrl = async ({ Key }) => `https://source.example/${Key}`;
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => ({
      getObjectAccessUrl: async ({ Key }) => {
        signedKeys.push(Key);
        return `https://thumbnail.example/${Key}`;
      },
    }),
  });

  const result = await buckets.getListObjects({ Bucket: "multi-source", Prefix: "photos/" });
  assert.equal(signedKeys[0], v1Key);
  assert.equal(signedKeys.length, 2);
  assert.equal(signedKeys[1].startsWith("v2/"), true);
  assert.equal(result.Contents[0].AccessUrl, `https://source.example/${sourceKey}`);
  assert.equal(result.Contents[1].AccessUrl, "https://source.example/other/deep.jpg");
});

test("JSON opt-in rejects wrong resolved regions and signs second-region and same-region distinct-bucket sources", async () => {
  const enrollment = validateSourceEnrollment([
    { bucket: "multi-source", region: "ap-southeast-2" },
    { bucket: "second-source", region: "us-east-1" },
    { bucket: "same-region-source", region: "ap-southeast-1" },
  ], {
    stage: "test",
    derivedBucket: "derived-bucket",
    derivedRegion: "ap-southeast-1",
    internalBuckets: ["internal-derived"],
  });
  configureV2Thumbnail({ sourceEnrollments: enrollment });

  let regionCalls = 0;
  const signedKeys = [];
  storage.getBucketRegion = async () => {
    regionCalls += 1;
    return { region: "us-east-1" };
  };
  storage.getListObjects = async () => ({
    Contents: [{ Key: "deep/photo.jpg", Size: 100, ETag: "listed-etag" }],
  });
  storage.getObjectAccessUrl = async ({ Key }) => `https://source.example/${Key}`;
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => ({
      getObjectAccessUrl: async ({ Key }) => {
        signedKeys.push(Key);
        return `https://thumbnail.example/${Key}`;
      },
    }),
  });

  const wrongRegion = await buckets.getListObjects({ Bucket: "multi-source" });
  assert.equal(Object.hasOwn(wrongRegion.Contents[0], "ThumbnailAccessUrl"), false);
  assert.equal(wrongRegion.Contents[0].AccessUrl, "https://source.example/deep/photo.jpg");
  assert.equal(regionCalls, 1);
  assert.equal(signedKeys.length, 0);

  const secondRegion = await buckets.getListObjects({ Bucket: "second-source" });
  assert.equal(Object.hasOwn(secondRegion.Contents[0], "ThumbnailAccessUrl"), true);
  assert.equal(secondRegion.Contents[0].AccessUrl, "https://source.example/deep/photo.jpg");
  assert.equal(regionCalls, 2);
  assert.equal(signedKeys.length, 1);

  storage.getBucketRegion = async () => {
    regionCalls += 1;
    return { region: "ap-southeast-1" };
  };
  const sameRegionDistinctBucket = await buckets.getListObjects({ Bucket: "same-region-source" });
  assert.equal(Object.hasOwn(sameRegionDistinctBucket.Contents[0], "ThumbnailAccessUrl"), true);
  assert.equal(sameRegionDistinctBucket.Contents[0].AccessUrl, "https://source.example/deep/photo.jpg");
  assert.equal(regionCalls, 3);
});

test("Tokyo PRD v1 pilot keys win over v2 and other eligible keys may get v2 URLs", async () => {
  const sourceRegion = "ap-northeast-1";
  const pilotKey = "photos/prd-pilot.jpg";
  const v1Key = createThumbnailKey({
    sourceRegion,
    sourceBucket: "prd-source",
    sourceKey: pilotKey,
    etag: "pilot-etag",
  });
  const enrollment = validateSourceEnrollment([
    { bucket: "prd-source", region: sourceRegion },
  ], {
    stage: "prd",
    derivedBucket: "derived-bucket",
    derivedRegion: "ap-southeast-1",
    internalBuckets: ["internal-derived"],
  });
  installConfig({
    wasabi: { internalBucketSet: new Set(["internal-derived"]), internalBuckets: ["internal-derived"] },
    thumbnailApi: {
      enabled: true,
      sourceBucket: "prd-source",
      sourceRegion,
      sourcePrefix: "photos/",
      allowedKeys: new Set([v1Key]),
      derivedBucket: "derived-bucket",
      derivedRegion: "ap-southeast-1",
      readAccessKeyId: "synthetic-read-access",
      readSecretAccessKey: "synthetic-read-secret",
      urlTtlSeconds: 3600,
      v2: { enabled: true, sourceEnrollments: enrollment },
    },
  });
  const signedKeys = [];
  let regionCalls = 0;
  storage.getBucketRegion = async () => {
    regionCalls += 1;
    return { region: sourceRegion };
  };
  storage.getListObjects = async () => ({
    Contents: [
      { Key: pilotKey, Size: 100, ETag: "pilot-etag" },
      { Key: "deep/non-pilot.jpg", Size: 100, ETag: "non-pilot-etag" },
    ],
  });
  storage.getObjectAccessUrl = async ({ Key }) => `https://source.example/${Key}`;
  installThumbnailSigner({
    createThumbnailApiWasabiStorage: () => ({
      getObjectAccessUrl: async ({ Key }) => {
        signedKeys.push(Key);
        return `https://thumbnail.example/${Key}`;
      },
    }),
  });

  const result = await buckets.getListObjects({ Bucket: "prd-source", Prefix: "photos/" });
  assert.equal(regionCalls, 1);
  assert.equal(signedKeys[0], v1Key);
  assert.equal(signedKeys.length, 2);
  assert.equal(signedKeys[1].startsWith("v2/"), true);
  assert.equal(result.Contents[0].AccessUrl, `https://source.example/${pilotKey}`);
  assert.equal(result.Contents[1].AccessUrl, "https://source.example/deep/non-pilot.jpg");
});
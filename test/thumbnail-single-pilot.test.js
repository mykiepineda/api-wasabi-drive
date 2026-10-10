const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  generateThumbnailForObject,
} = require("../src/thumbnail/generate");
const {
  ThumbnailStorageError,
} = require("../src/storage/thumbnail-wasabi");
const { createThumbnailKey } = require("../src/thumbnail/key");
const {
  loadTestConfig,
  main,
  parseArguments,
} = require("../scripts/thumbnail-single-pilot");

const source = {
  sourceBucket: "wasabi-test-source",
  sourceKey: "photos/sample.jpg",
  sourceRegion: "ap-southeast-2",
  destinationBucket: "wasabi-test-derived",
  destinationRegion: "eu-west-1",
};

const makeStorage = (overrides = {}) => {
  const calls = [];
  const defaults = {
    headSource: async () => ({ etag: '"source-etag"', size: 4 }),
    headDerived: async () => false,
    getSourceBuffer: async () => Buffer.from("data"),
    putDerived: async () => {},
  };
  const operations = {
    headSource: "head-source",
    headDerived: "head-derived",
    getSourceBuffer: "get-source",
    putDerived: "put-derived",
  };
  const storage = Object.fromEntries(Object.entries(defaults).map(([method, implementation]) => [
    method,
    async (params) => {
      calls.push({ operation: operations[method], params });
      return (overrides[method] || implementation)(params);
    },
  ]));
  return { storage, calls };
};

const testEnvironment = (overrides = {}) => ({
  THUMBNAIL_PILOT_STAGE: "test",
  THUMBNAIL_TEST_SOURCE_BUCKET: source.sourceBucket,
  THUMBNAIL_TEST_DERIVED_BUCKET: source.destinationBucket,
  THUMBNAIL_TEST_DERIVED_REGION: source.destinationRegion,
  THUMBNAIL_TEST_WASABI_ACCESS_KEY_ID: "test-access-key",
  THUMBNAIL_TEST_WASABI_SECRET_ACCESS_KEY: "test-secret-key",
  ...overrides,
});

const args = (extra = []) => [
  "--source-bucket", source.sourceBucket,
  "--source-key", source.sourceKey,
  "--source-region", source.sourceRegion,
  ...extra,
];

test("CLI requires one explicit source and both live-write confirmations", () => {
  assert.throws(() => parseArguments([]), /invalid-arguments/);
  assert.throws(() => parseArguments(args(["--execute"])), /invalid-arguments/);
  assert.throws(() => parseArguments(args(["--confirm-test-write"])), /invalid-arguments/);
  assert.throws(() => parseArguments(args(["--stage", "prd"])), /invalid-arguments/);
  assert.deepEqual(parseArguments(args(["--execute", "--confirm-test-write"])), {
    sourceBucket: source.sourceBucket,
    sourceKey: source.sourceKey,
    sourceRegion: source.sourceRegion,
    execute: true,
  });
});

test("TEST config rejects production mode, production buckets, invalid regions, and source/destination equality", () => {
  assert.throws(() => loadTestConfig(testEnvironment({ THUMBNAIL_PILOT_STAGE: "prd" })));
  assert.throws(() => loadTestConfig(testEnvironment({ DEPLOYMENT_STAGE: "prd" })));
  assert.throws(() => loadTestConfig(testEnvironment({ NODE_ENV: "production" })));
  assert.throws(() => loadTestConfig(testEnvironment({
    THUMBNAIL_TEST_DERIVED_BUCKET: "wasabi-prd-derived",
  })));
  assert.throws(() => loadTestConfig(testEnvironment({
    THUMBNAIL_TEST_DERIVED_REGION: "prd",
  })));
  assert.throws(() => loadTestConfig(testEnvironment({
    THUMBNAIL_TEST_DERIVED_BUCKET: source.sourceBucket,
  })));
});

test("default dry-run performs metadata and destination HEAD only, with a hashed deterministic identity", async () => {
  const { storage, calls } = makeStorage();

  const first = await generateThumbnailForObject({ ...source, storage });
  const second = await generateThumbnailForObject({ ...source, storage });

  assert.equal(first.category, "dry-run");
  assert.equal(first.derivedKey, second.derivedKey);
  assert.match(first.derivedKey, /^v1\/[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/);
  assert.deepEqual(calls.map(({ operation }) => operation), [
    "head-source", "head-derived",
    "head-source", "head-derived",
  ]);
  assert.equal(calls.some(({ operation }) => ["get-source", "put-derived"].includes(operation)), false);
  assert.deepEqual(calls[1].params, {
    bucket: source.destinationBucket,
    key: first.derivedKey,
    region: source.destinationRegion,
  });
});

test("known derived objects skip before source body reads; unsupported metadata also avoids reads", async () => {
  const present = makeStorage({
    async headDerived() {
      return true;
    },
  });
  const skipped = await generateThumbnailForObject({ ...source, storage: present.storage, dryRun: false });
  assert.equal(skipped.category, "already-present");
  assert.deepEqual(present.calls.map(({ operation }) => operation), ["head-source", "head-derived"]);

  for (const { metadata, key } of [
    { metadata: { etag: "", size: 4 }, key: "photos/sample.jpg" },
    { metadata: { etag: '"malformed"etag"', size: 4 }, key: "photos/sample.jpg" },
    { metadata: { etag: '"source-etag"', size: undefined }, key: "photos/sample.jpg" },
    { metadata: { etag: '"source-etag"', size: 0 }, key: "photos/sample.jpg" },
    { metadata: { etag: '"source-etag"', size: 4 }, key: "photos/sample.nef" },
  ]) {
    const unsupported = makeStorage({
      async headSource() {
        return metadata;
      },
    });
    const result = await generateThumbnailForObject({
      ...source,
      sourceKey: key,
      storage: unsupported.storage,
      dryRun: false,
    });
    assert.equal(result.category, "unsupported");
    assert.deepEqual(unsupported.calls.map(({ operation }) => operation), ["head-source"]);
  }
});

test("source and destination must differ and oversized source metadata is rejected before destination checks", async () => {
  const { storage, calls } = makeStorage({
    async headSource() {
      return { etag: '"source-etag"', size: 26 * 1024 * 1024 };
    },
  });
  const sameBucket = await generateThumbnailForObject({
    ...source,
    destinationBucket: source.sourceBucket,
    storage,
  });
  assert.equal(sameBucket.category, "failed");
  assert.equal(calls.length, 0);

  const tooLarge = await generateThumbnailForObject({ ...source, storage, dryRun: false });
  assert.equal(tooLarge.category, "failed");
  assert.equal(tooLarge.reason, "source-too-large");
  assert.deepEqual(calls.map(({ operation }) => operation), ["head-source"]);
});

test("ETag and unsupported conditional request failures do not write derived bytes", async () => {
  for (const [code, expected] of [
    ["etag-mismatch", "etag-mismatch"],
    ["precondition-unsupported", "precondition-unsupported"],
  ]) {
    const { storage, calls } = makeStorage({
      async getSourceBuffer() {
        throw new ThumbnailStorageError(code);
      },
    });
    const result = await generateThumbnailForObject({ ...source, storage, dryRun: false });
    assert.equal(result.category, expected);
    assert.equal(calls.some(({ operation }) => operation === "put-derived"), false);
  }
});

test("conditional create race is benign only after destination HEAD confirms the object exists", async () => {
  let derivedHeadCount = 0;
  let existsAfterPut = true;
  const { storage, calls } = makeStorage({
    async headDerived() {
      derivedHeadCount += 1;
      return derivedHeadCount > 1 && existsAfterPut;
    },
    async putDerived() {
      throw new ThumbnailStorageError("already-exists");
    },
  });
  const applyPolicy = async ({ sourceBytes, region, bucket, sourceKey, etag }) => ({
    eligible: true,
    derivedKey: createThumbnailKey({ region, bucket, sourceKey, etag }),
    webpBuffer: sourceBytes,
    contentType: "image/webp",
    dimensions: { width: 1, height: 1 },
  });
  const result = await generateThumbnailForObject({
    ...source,
    storage,
    dryRun: false,
    applyPolicy,
  });
  assert.equal(result.category, "already-present");
  assert.equal(calls.filter(({ operation }) => operation === "head-derived").length, 2);

  derivedHeadCount = 0;
  existsAfterPut = false;
  const failed = await generateThumbnailForObject({
    ...source,
    storage,
    dryRun: false,
    applyPolicy,
  });
  assert.equal(failed.category, "failed");
});

test("standard image is transformed by the existing in-memory service and conditionally written", async () => {
  const image = await sharp({
    create: { width: 8, height: 4, channels: 3, background: "#2288cc" },
  }).jpeg().toBuffer();
  const { storage, calls } = makeStorage({
    async headSource() {
      return { etag: '"source-etag"', size: image.length };
    },
    async getSourceBuffer() {
      return image;
    },
  });

  const result = await generateThumbnailForObject({
    ...source,
    storage,
    dryRun: false,
  });

  assert.equal(result.category, "generated");
  assert.equal(result.contentType, "image/webp");
  assert.deepEqual(result.dimensions, { width: 8, height: 4 });
  assert.equal(result.bytes, calls.find(({ operation }) => operation === "put-derived").params.body.length);
  const put = calls.find(({ operation }) => operation === "put-derived").params;
  assert.equal(put.key, result.derivedKey);
  assert.equal(put.bucket, source.destinationBucket);
  assert.deepEqual(calls.find(({ operation }) => operation === "get-source").params, {
    bucket: source.sourceBucket,
    key: source.sourceKey,
    region: source.sourceRegion,
    etag: '"source-etag"',
    size: image.length,
  });
});

test("CR2 follows the existing thumbnail service and extracted preview path", async () => {
  const cr2 = require("../src/thumbnail/cr2");
  const originalExtractor = cr2.extractCR2EmbeddedPreview;
  const previewImage = await sharp({
    create: { width: 6, height: 3, channels: 3, background: "#aa5522" },
  }).jpeg().toBuffer();
  const cr2Bytes = Buffer.from("synthetic CR2 source");
  const originalCopy = Buffer.from(cr2Bytes);
  let extractorInput;
  cr2.extractCR2EmbeddedPreview = async ({ input }) => {
    extractorInput = input;
    return {
      eligible: true,
      buffer: previewImage,
      fallbackOrientation: undefined,
    };
  };
  const cr2Source = { ...source, sourceKey: "photos/sample.CR2" };
  const { storage, calls } = makeStorage({
    async headSource() {
      return { etag: '"source-etag"', size: cr2Bytes.length };
    },
    async getSourceBuffer() {
      return cr2Bytes;
    },
  });

  try {
    const result = await generateThumbnailForObject({
      ...cr2Source,
      storage,
      dryRun: false,
    });
    assert.equal(result.category, "generated");
    assert.equal(result.contentType, "image/webp");
    assert.equal(extractorInput, cr2Bytes);
    assert.deepEqual(cr2Bytes, originalCopy);
    assert.equal(calls.some(({ operation }) => operation === "put-derived"), true);
  } finally {
    cr2.extractCR2EmbeddedPreview = originalExtractor;
  }
});

test("CLI pins the source allowlist, defaults to dry-run, and prints no private identifiers", async () => {
  const env = testEnvironment();
  let generatedOptions;
  let output;
  const status = await main(args(), {
    env,
    createStorage: (credentials) => {
      assert.deepEqual(credentials, {
        accessKeyId: env.THUMBNAIL_TEST_WASABI_ACCESS_KEY_ID,
        secretAccessKey: env.THUMBNAIL_TEST_WASABI_SECRET_ACCESS_KEY,
      });
      return {};
    },
    generate: async (options) => {
      generatedOptions = options;
      return {
        category: "generated",
        count: 1,
        derivedKey: "private-derived-key",
        dimensions: { width: 1, height: 2 },
        bytes: 10,
        contentType: "image/webp",
        etag: "private-etag",
        sourceKey: "private-source-key",
        bucket: "private-bucket",
      };
    },
    write: (message) => { output = message; },
  });
  assert.equal(status, 0);
  assert.equal(generatedOptions.dryRun, true);
  assert.equal(generatedOptions.destinationBucket, source.destinationBucket);
  assert.deepEqual(JSON.parse(output), {
    category: "generated",
    count: 1,
    dimensions: { width: 1, height: 2 },
    bytes: 10,
    contentType: "image/webp",
  });
  assert.equal(output.includes("private"), false);
});

test("CLI production or unapproved source selection fails closed before storage creation", async () => {
  let storageCreated = false;
  let output;
  const status = await main(args(["--execute", "--confirm-test-write"]), {
    env: testEnvironment({ DEPLOYMENT_STAGE: "prd" }),
    createStorage: () => {
      storageCreated = true;
      return {};
    },
    write: (message) => { output = message; },
  });
  assert.equal(status, 1);
  assert.equal(storageCreated, false);
  assert.deepEqual(JSON.parse(output), { category: "failed", count: 1 });

  const invalidRegion = await main([
    "--source-bucket", source.sourceBucket,
    "--source-key", source.sourceKey,
    "--source-region", "prd",
  ], {
    env: testEnvironment(),
    createStorage: () => {
      storageCreated = true;
      return {};
    },
    write: (message) => { output = message; },
  });
  assert.equal(invalidRegion, 1);
  assert.equal(storageCreated, false);
  assert.deepEqual(JSON.parse(output), { category: "failed", count: 1 });

  const unapproved = await main([
    "--source-bucket", "some-other-test-bucket",
    "--source-key", "photo.jpg",
    "--source-region", source.sourceRegion,
  ], {
    env: testEnvironment(),
    createStorage: () => {
      storageCreated = true;
      return {};
    },
    write: (message) => { output = message; },
  });
  assert.equal(unapproved, 1);
  assert.equal(storageCreated, false);
  assert.deepEqual(JSON.parse(output), { category: "failed", count: 1 });
});

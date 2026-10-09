const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectInventory,
  getObjectExtension,
  nearestRankPercentile,
} = require("../src/thumbnail/inventory");

test("normalizes extensions and identifies keys without a file extension", () => {
  assert.equal(getObjectExtension("nested/Photo.JpG"), "jpg");
  assert.equal(getObjectExtension("README"), undefined);
  assert.equal(getObjectExtension("nested/folder/"), undefined);
  assert.equal(getObjectExtension("nested/.hidden"), undefined);
});

test("aggregates object, extension, candidate-image, zero-byte, and missing ETag counts", async () => {
  const summary = await collectInventory({
    buckets: ["source-a"],
    listPage: async () => ({
      IsTruncated: false,
      Contents: [
        { Key: "images/Photo.JPG", Size: 100, ETag: "etag-1" },
        { Key: "images/second.heic", Size: 200 },
        { Key: "assets/icon.PNG", Size: 50, ETag: "   " },
        { Key: "folder/", Size: 0, ETag: "etag-4" },
        { Key: "README", Size: 10 },
      ],
    }),
  });

  assert.equal(summary.bucketCount, 1);
  assert.equal(summary.totalObjects, 5);
  assert.equal(summary.totalBytes, 360);
  assert.equal(summary.zeroByteObjects, 1);
  assert.equal(summary.folderMarkers, 1);
  assert.deepEqual(summary.extensions, {
    heic: { count: 1, bytes: 200 },
    jpg: { count: 1, bytes: 100 },
    png: { count: 1, bytes: 50 },
  });
  assert.equal(summary.unknownExtensionObjects, 2);
  assert.equal(summary.unknownExtensionBytes, 10);
  assert.deepEqual(summary.candidateImages, {
    count: 3,
    bytes: 350,
    p50Bytes: 100,
    p90Bytes: 200,
    maxBytes: 200,
  });
  assert.equal(summary.missingETags, 3);
});

test("uses nearest-rank percentiles deterministically and handles empty samples", () => {
  const values = [200, 50, 100, 400, 300];
  assert.equal(nearestRankPercentile(values, 0.5), 200);
  assert.equal(nearestRankPercentile(values, 0.9), 400);
  assert.equal(nearestRankPercentile([], 0.5), null);
  assert.deepEqual(values, [200, 50, 100, 400, 300]);
});

test("paginates through empty pages and passes bucket, prefix, and continuation token", async () => {
  const calls = [];
  const pages = [
    { IsTruncated: true, NextContinuationToken: "page-2", Contents: [] },
    { IsTruncated: true, NextContinuationToken: "page-3", Contents: [] },
    {
      IsTruncated: false,
      Contents: [{ Key: "nested/image.webp", Size: 42, ETag: "etag" }],
    },
  ];

  const summary = await collectInventory({
    buckets: ["source-a"],
    prefix: "nested/",
    listPage: async (params) => {
      calls.push(params);
      return pages.shift();
    },
  });

  assert.deepEqual(calls, [
    { Bucket: "source-a", Prefix: "nested/" },
    { Bucket: "source-a", Prefix: "nested/", ContinuationToken: "page-2" },
    { Bucket: "source-a", Prefix: "nested/", ContinuationToken: "page-3" },
  ]);
  assert.equal(summary.totalObjects, 1);
  assert.equal(summary.totalBytes, 42);
  assert.equal(summary.candidateImages.p50Bytes, 42);
});

test("rejects truncated pages without a non-empty continuation token", async (t) => {
  for (const token of [undefined, "", "   "]) {
    await t.test(`rejects token ${JSON.stringify(token)}`, async () => {
      await assert.rejects(
        collectInventory({
          buckets: ["source-a"],
          listPage: async () => ({ IsTruncated: true, NextContinuationToken: token }),
        }),
        { message: "Storage pagination is truncated without a continuation token." },
      );
    });
  }
});

test("continues to the next bucket after an empty bucket page", async () => {
  const calls = [];
  const summary = await collectInventory({
    buckets: ["empty-source", "source-with-image"],
    listPage: async ({ Bucket }) => {
      calls.push(Bucket);
      return Bucket === "empty-source"
        ? { IsTruncated: false, Contents: [] }
        : { IsTruncated: false, Contents: [{ Key: "image.avif", Size: 8 }] };
    },
  });

  assert.deepEqual(calls, ["empty-source", "source-with-image"]);
  assert.equal(summary.bucketCount, 2);
  assert.equal(summary.totalObjects, 1);
});
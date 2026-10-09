const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArguments } = require("../scripts/locate-images");
const {
  DIAGNOSTIC_IMAGE_EXTENSIONS,
  locateByExtensions,
  locateLargestImages,
} = require("../src/thumbnail/locate");

const object = (Key, Size) => ({ Key, Size });

test("locates normalized extensions across selected buckets and nested keys in size order", async () => {
  const calls = [];
  const pages = {
    "source-a": [
      { IsTruncated: true, NextContinuationToken: "next", Contents: [object("2024/raw/first.NEF", 50)] },
      { IsTruncated: false, Contents: [object("2024/raw/small.nef", 10)] },
    ],
    "source-b": [
      { IsTruncated: false, Contents: [object("archive/second.CR2", 80), object("other.jpg", 1000)] },
    ],
  };

  const result = await locateByExtensions({
    buckets: ["source-a", "source-b"],
    extensions: [".NEF", "cr2"],
    limit: 2,
    listPage: async (params) => {
      calls.push(params);
      return pages[params.Bucket].shift();
    },
  });

  assert.deepEqual(calls, [
    { Bucket: "source-a" },
    { Bucket: "source-a", ContinuationToken: "next" },
    { Bucket: "source-b" },
  ]);
  assert.equal(result.matchCount, 3);
  assert.equal(result.returnedCount, 2);
  assert.deepEqual(result.objects.map(({ bucket, key, extension, sizeBytes }) => ({
    bucket, key, extension, sizeBytes,
  })), [
    { bucket: "source-b", key: "archive/second.CR2", extension: "cr2", sizeBytes: 80 },
    { bucket: "source-a", key: "2024/raw/first.NEF", extension: "nef", sizeBytes: 50 },
  ]);
});

test("largest-image mode includes RAW extensions and excludes unrelated extensions", async () => {
  const result = await locateLargestImages({
    buckets: ["source"],
    limit: 10,
    listPage: async () => ({
      IsTruncated: false,
      Contents: [
        object("photos/raw.NEF", 100),
        object("photos/camera.CR2", 200),
        object("photos/web.JPEG", 300),
        object("documents/report.pdf", 900),
      ],
    }),
  });

  assert.equal(result.matchCount, 3);
  assert.deepEqual(result.objects.map(({ key }) => key), [
    "photos/web.JPEG",
    "photos/camera.CR2",
    "photos/raw.NEF",
  ]);
  assert.ok(DIAGNOSTIC_IMAGE_EXTENSIONS.has("nef"));
  assert.ok(DIAGNOSTIC_IMAGE_EXTENSIONS.has("cr2"));
});

test("handles empty results and applies extension limit after ordering", async () => {
  const noMatches = await locateByExtensions({
    buckets: ["source"],
    extensions: ["nef"],
    limit: 20,
    listPage: async () => ({ IsTruncated: false, Contents: [object("empty.jpg", 10)] }),
  });
  assert.equal(noMatches.matchCount, 0);
  assert.deepEqual(noMatches.objects, []);

  const limited = await locateByExtensions({
    buckets: ["source"],
    extensions: ["jpg"],
    limit: 1,
    listPage: async () => ({
      IsTruncated: false,
      Contents: [object("small.jpg", 1), object("large.jpg", 10)],
    }),
  });
  assert.equal(limited.objects[0].key, "large.jpg");
});

test("rejects malformed pagination rather than returning partial matches", async (t) => {
  await t.test("missing continuation token", async () => {
    await assert.rejects(
      locateByExtensions({
        buckets: ["source"],
        extensions: ["nef"],
        limit: 1,
        listPage: async () => ({ IsTruncated: true, Contents: [] }),
      }),
      { message: "Storage pagination is truncated without a continuation token." },
    );
  });
  await t.test("repeated continuation token", async () => {
    await assert.rejects(
      locateByExtensions({
        buckets: ["source"],
        extensions: ["nef"],
        limit: 1,
        listPage: async () => ({ IsTruncated: true, NextContinuationToken: "same", Contents: [] }),
      }),
      { message: "Storage pagination returned a repeated continuation token." },
    );
  });
});

test("parses modes, repeated buckets/extensions and validates positive limits", () => {
  assert.deepEqual(parseArguments([
    "--bucket", "one", "--bucket", "two", "--extension", ".nef", "--extension", "cr2",
  ]), {
    mode: "extension",
    buckets: ["one", "two"],
    prefix: undefined,
    extensions: [".nef", "cr2"],
    limit: 20,
  });
  assert.equal(parseArguments(["--bucket", "one", "--largest", "4"]).limit, 4);
  for (const value of ["0", "-1", "1.5", "nope"]) {
    assert.throws(() => parseArguments([
      "--bucket", "one", "--extension", "nef", "--limit", value,
    ]), /--limit must be a positive integer/);
    assert.throws(() => parseArguments(["--bucket", "one", "--largest", value]), /--largest must be a positive integer/);
  }
  assert.throws(() => parseArguments([
    "--bucket", "one", "--extension", "nef", "--largest", "2",
  ]), /Use either --largest or --extension/);
});
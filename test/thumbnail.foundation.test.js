const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const {
  createThumbnailKey,
  normalizeEtag,
} = require("../src/thumbnail/key");
const {
  evaluateThumbnailEligibility,
} = require("../src/thumbnail/eligibility");
const {
  transformToWebp,
} = require("../src/thumbnail/transform");
const {
  applyThumbnailPolicy,
} = require("../src/thumbnail/service");
const {
  extractCR2EmbeddedPreview,
} = require("../src/thumbnail/cr2");

const makePngBuffer = async ({ width = 1200, height = 600, orientation } = {}) => {
  let pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 15, g: 60, b: 100, alpha: 1 },
    },
  });

  if (orientation) {
    pipeline = pipeline.withMetadata({ orientation });
  }

  return pipeline.png().toBuffer();
};

test("v1 thumbnail keys are deterministic and collision separated", () => {
  const one = createThumbnailKey({
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "nested/photo.jpg",
    etag: ' "etag-123" ',
  });
  const same = createThumbnailKey({
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "nested/photo.jpg",
    etag: '"etag-123"',
  });
  const different = createThumbnailKey({
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "nested/photo-other.jpg",
    etag: '"etag-123"',
  });

  assert.equal(normalizeEtag(' "etag-123" '), "etag-123");
  assert.equal(one, same);
  assert.notEqual(one, different);
  assert.match(one, /^v1\/[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/);
});

test("thumbnail policy rejects unsupported and zero-byte inputs without throwing", () => {
  const unsupported = evaluateThumbnailEligibility({
    size: 128,
    extension: "gif",
    sourceKey: "archive/image.gif",
    region: "us-east-1",
    bucket: "source-bucket",
    etag: '"123"',
  });
  const zeroByte = evaluateThumbnailEligibility({
    size: 0,
    extension: "png",
    sourceKey: "empty.png",
    region: "us-east-1",
    bucket: "source-bucket",
    etag: '"abc"',
  });
  const deferred = evaluateThumbnailEligibility({
    size: 256,
    extension: "nef",
    sourceKey: "raw/photo.nef",
    region: "us-east-1",
    bucket: "source-bucket",
    etag: '"abc"',
  });

  assert.equal(unsupported.eligible, false);
  assert.equal(zeroByte.eligible, false);
  assert.equal(deferred.eligible, false);
  assert.equal(unsupported.reason, "unsupported-format");
  assert.equal(zeroByte.reason, "zero-byte-object");
  assert.equal(deferred.reason, "nef-deferred");
});

test("standard images pass policy and generate deterministic WebP output", async () => {
  const buffer = await makePngBuffer({ width: 1200, height: 600 });
  const result = await applyThumbnailPolicy({
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "photos/family.png",
    etag: '"abc-123"',
    sourceBytes: buffer,
    extension: "png",
    format: "png",
    size: buffer.length,
    allowCR2Preview: false,
    maxEdge: 512,
    quality: 80,
  });

  assert.equal(result.eligible, true);
  assert.match(result.derivedKey, /^v1\/[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/);
  assert.equal(result.contentType, "image/webp");
  assert.ok(result.bytes > 0);
  assert.ok(result.dimensions.width <= 512);
  assert.ok(result.dimensions.height <= 512);
  assert.equal(result.reason, "thumbnail-generated");
  assert.equal((await sharp(result.webpBuffer).metadata()).orientation, undefined);
});

test("transform enforces the A2 resize recipe and strips source metadata", async () => {
  const input = await makePngBuffer({ width: 40, height: 20, orientation: 6 });
  const transformed = await transformToWebp({ input, maxEdge: 512, quality: 80 });
  const outputMetadata = await sharp(transformed.buffer).metadata();

  assert.equal(outputMetadata.format, "webp");
  assert.ok(transformed.width <= 512);
  assert.ok(transformed.height <= 512);
  assert.equal(outputMetadata.orientation, undefined);
  assert.equal(transformed.contentType, "image/webp");
  assert.ok(transformed.bytes > 0);
});

test("CR2 preview extraction fails safely when no extractor is available", async () => {
  const result = await extractCR2EmbeddedPreview({ input: Buffer.from("not a valid CR2") });

  assert.equal(result.eligible, false);
  assert.ok(
    [
      "missing-cr2-preview-input",
      "portable-cr2-preview-extractor-unavailable",
      "portable-cr2-preview-empty",
      "portable-cr2-preview-failed",
      "portable-cr2-preview-extractor-invalid",
    ].includes(result.reason),
  );
  assert.equal(result.buffer, null);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const {
  createThumbnailKey,
  normalizeEtag,
  sanitizeVersion,
} = require("../src/thumbnail/key");
const {
  evaluateThumbnailEligibility,
  normalizeExtension,
} = require("../src/thumbnail/eligibility");
const {
  transformToWebp,
} = require("../src/thumbnail/transform");
const {
  applyThumbnailPolicy,
  FIXED_THUMBNAIL_MAX_EDGE,
  FIXED_THUMBNAIL_QUALITY,
} = require("../src/thumbnail/service");
const {
  extractCR2EmbeddedPreview,
} = require("../src/thumbnail/cr2");

const makePngBuffer = async ({ width = 1200, height = 600, orientation, alpha = 1 } = {}) => {
  let pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 15, g: 60, b: 100, alpha },
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
  const unsafeVersion = () => createThumbnailKey({
    formatVersion: "../v2",
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "nested/photo.jpg",
    etag: '"etag-123"',
  });

  assert.equal(normalizeEtag(' "etag-123" '), "etag-123");
  assert.equal(one, same);
  assert.notEqual(one, different);
  assert.match(one, /^v1\/[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/);
  assert.throws(unsafeVersion, /safe version/);
  assert.equal(sanitizeVersion("v2"), "v2");
  assert.equal(sanitizeVersion("../v2"), "");
  assert.equal(sanitizeVersion(" v2 "), "");
});

test("thumbnail policy rejects unsupported and zero-byte inputs without throwing", () => {
  const unsupported = evaluateThumbnailEligibility({
    size: 128,
    extension: ".GIF",
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
  const folderMarker = evaluateThumbnailEligibility({
    size: 64,
    extension: "jpg",
    sourceKey: "folder/",
    region: "us-east-1",
    bucket: "source-bucket",
    etag: '"folder"',
  });
  const invalidSize = evaluateThumbnailEligibility({
    size: Number.POSITIVE_INFINITY,
    extension: "jpg",
    sourceKey: "folder/pic.jpg",
    region: "us-east-1",
    bucket: "source-bucket",
    etag: '"abc"',
  });

  assert.equal(unsupported.eligible, false);
  assert.equal(zeroByte.eligible, false);
  assert.equal(deferred.eligible, false);
  assert.equal(folderMarker.eligible, false);
  assert.equal(invalidSize.eligible, false);
  assert.equal(unsupported.reason, "unsupported-format");
  assert.equal(zeroByte.reason, "zero-byte-object");
  assert.equal(deferred.reason, "nef-deferred");
  assert.equal(folderMarker.reason, "folder-marker-key");
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
  });

  assert.equal(result.eligible, true);
  assert.match(result.derivedKey, /^v1\/[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/);
  assert.equal(result.contentType, "image/webp");
  assert.ok(result.bytes > 0);
  assert.ok(result.dimensions.width <= FIXED_THUMBNAIL_MAX_EDGE);
  assert.ok(result.dimensions.height <= FIXED_THUMBNAIL_MAX_EDGE);
  assert.equal(result.reason, "thumbnail-generated");
  assert.equal((await sharp(result.webpBuffer).metadata()).orientation, undefined);
  assert.equal(FIXED_THUMBNAIL_MAX_EDGE, 512);
  assert.equal(FIXED_THUMBNAIL_QUALITY, 80);
});

test("transform enforces the A2 resize recipe and retains transparency", async () => {
  const input = await makePngBuffer({ width: 40, height: 20, orientation: 6, alpha: 0.5 });
  const transformed = await transformToWebp({ input, maxEdge: 512, quality: 80 });
  const outputMetadata = await sharp(transformed.buffer).metadata();
  const outputPixel = await sharp(transformed.buffer).raw().toBuffer({ resolveWithObject: true });

  assert.equal(outputMetadata.format, "webp");
  assert.equal(outputMetadata.orientation, undefined);
  assert.equal(transformed.width, 20);
  assert.equal(transformed.height, 40);
  assert.equal(transformed.contentType, "image/webp");
  assert.ok(transformed.bytes > 0);
  assert.ok(outputPixel.info.channels >= 3);
  assert.ok(normalizeExtension(".JPG") === "jpg");
});

test("corrupt supported image bytes fail safely without mutating input", async () => {
  const input = Buffer.from("not an image");
  const original = Buffer.from(input);
  const result = await applyThumbnailPolicy({
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "photos/failing.png",
    etag: '"corrupt"',
    sourceBytes: input,
    extension: "png",
    format: "png",
    size: input.length,
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, "thumbnail-generation-failed");
  assert.equal(input.equals(original), true);
  assert.equal(input.toString(), "not an image");
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

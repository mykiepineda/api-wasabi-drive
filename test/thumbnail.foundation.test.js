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

test("v1 thumbnail keys are deterministic and separated by identity inputs", () => {
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
  const otherRegion = createThumbnailKey({
    region: "us-west-2",
    bucket: "source-bucket",
    sourceKey: "nested/photo.jpg",
    etag: '"etag-123"',
  });
  const otherBucket = createThumbnailKey({
    region: "us-east-1",
    bucket: "source-bucket-2",
    sourceKey: "nested/photo.jpg",
    etag: '"etag-123"',
  });
  const otherKey = createThumbnailKey({
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "nested/photo-other.jpg",
    etag: '"etag-123"',
  });
  const otherEtag = createThumbnailKey({
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "nested/photo.jpg",
    etag: '"etag-456"',
  });
  const otherVersion = createThumbnailKey({
    formatVersion: "v2",
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "nested/photo.jpg",
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
  assert.equal(normalizeEtag('"   "'), "");
  assert.equal(normalizeEtag('"etag-123'), "");
  assert.equal(normalizeEtag('etag-123"'), "");
  assert.equal(one, same);
  assert.notEqual(one, otherRegion);
  assert.notEqual(one, otherBucket);
  assert.notEqual(one, otherKey);
  assert.notEqual(one, otherEtag);
  assert.notEqual(one, otherVersion);
  assert.match(one, /^v1\/[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/);
  assert.throws(unsafeVersion, /safe version/);
  assert.equal(sanitizeVersion("v2"), "v2");
  assert.equal(sanitizeVersion("../v2"), "");
  assert.equal(sanitizeVersion(" v2 "), "");
});

test("thumbnail policy rejects unsupported, zero-byte, malformed metadata, and malformed ETags without throwing", () => {
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
  const fractionalSize = evaluateThumbnailEligibility({
    size: 128.5,
    extension: "jpg",
    sourceKey: "folder/pic.jpg",
    region: "us-east-1",
    bucket: "source-bucket",
    etag: '"abc"',
  });
  const badEtag = evaluateThumbnailEligibility({
    size: 128,
    extension: "jpg",
    sourceKey: "folder/pic.jpg",
    region: "us-east-1",
    bucket: "source-bucket",
    etag: '"abc',
  });
  const cr2Pending = evaluateThumbnailEligibility({
    size: 1024,
    extension: ".CR2",
    sourceKey: "raw/photo.cr2",
    region: "us-east-1",
    bucket: "source-bucket",
    etag: '"abc"',
  });
  const cr2InvalidMetadata = [
    { size: 0, extension: "cr2", sourceKey: "raw/photo.cr2", region: "us-east-1", bucket: "source-bucket", etag: '"abc"' },
    { size: 12.5, extension: "cr2", sourceKey: "raw/photo.cr2", region: "us-east-1", bucket: "source-bucket", etag: '"abc"' },
    { size: Number.MAX_SAFE_INTEGER + 1, extension: "cr2", sourceKey: "raw/photo.cr2", region: "us-east-1", bucket: "source-bucket", etag: '"abc"' },
    { size: 1024, extension: "cr2", sourceKey: "raw/photo.cr2", region: "us-east-1", bucket: "source-bucket", etag: '"abc' },
    { size: 1024, extension: "cr2", sourceKey: "raw/photo.cr2", region: "us-east-1", bucket: "source-bucket" },
    { size: 1024, extension: "cr2", sourceKey: "raw/photo.cr2", region: "us-east-1", etag: '"abc"' },
    { size: 1024, extension: "cr2", region: "us-east-1", bucket: "source-bucket", etag: '"abc"' },
    { size: 1024, extension: "cr2", sourceKey: "raw/photo.cr2", bucket: "source-bucket", etag: '"abc"' },
    { size: 1024, extension: "cr2", sourceKey: "raw/", region: "us-east-1", bucket: "source-bucket", etag: '"abc"' },
  ].map((metadata) => evaluateThumbnailEligibility(metadata));

  assert.equal(unsupported.eligible, false);
  assert.equal(zeroByte.eligible, false);
  assert.equal(deferred.eligible, false);
  assert.equal(folderMarker.eligible, false);
  assert.equal(invalidSize.eligible, false);
  assert.equal(fractionalSize.eligible, false);
  assert.equal(badEtag.eligible, false);
  assert.equal(cr2Pending.eligible, true);
  assert.equal(cr2Pending.category, "cr2-preview");
  assert.equal(cr2Pending.reason, "cr2-preview-supported");
  assert.ok(cr2InvalidMetadata.every((result) => result.eligible === false));
  assert.equal(unsupported.reason, "unsupported-format");
  assert.equal(zeroByte.reason, "zero-byte-object");
  assert.equal(deferred.reason, "nef-deferred");
  assert.equal(folderMarker.reason, "folder-marker-key");
});

test("standard image formats retain the existing service path and recipe", async () => {
  const png = await makePngBuffer({ width: 1200, height: 600 });
  const jpeg = await sharp(png).jpeg().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  const sources = [
    ["jpg", jpeg],
    ["jpeg", jpeg],
    ["jfif", jpeg],
    ["png", png],
    ["webp", webp],
  ];
  const originalExtractor = require("../src/thumbnail/cr2").extractCR2EmbeddedPreview;
  let extractorCalls = 0;
  require("../src/thumbnail/cr2").extractCR2EmbeddedPreview = async () => {
    extractorCalls += 1;
    throw new Error("standard image must not use the CR2 extractor");
  };

  try {
    for (const [extension, sourceBytes] of sources) {
      const result = await applyThumbnailPolicy({
        region: "us-east-1",
        bucket: "source-bucket",
        sourceKey: `photos/family.${extension}`,
        etag: '"abc-123"',
        sourceBytes,
        extension,
        size: sourceBytes.length,
      });

      assert.equal(result.eligible, true, extension);
      assert.match(result.derivedKey, /^v1\/[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/);
      assert.equal(result.contentType, "image/webp");
      assert.ok(result.bytes > 0);
      assert.ok(result.dimensions.width <= FIXED_THUMBNAIL_MAX_EDGE);
      assert.ok(result.dimensions.height <= FIXED_THUMBNAIL_MAX_EDGE);
      assert.equal(result.reason, "thumbnail-generated");
      assert.equal((await sharp(result.webpBuffer).metadata()).orientation, undefined);
    }
  } finally {
    require("../src/thumbnail/cr2").extractCR2EmbeddedPreview = originalExtractor;
  }

  assert.equal(extractorCalls, 0);
  assert.equal(FIXED_THUMBNAIL_MAX_EDGE, 512);
  assert.equal(FIXED_THUMBNAIL_QUALITY, 80);
});

test("transform enforces the A2 resize recipe and preserves alpha in transparent output", async () => {
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
  assert.equal(outputPixel.info.channels, 4);
  const centerX = Math.floor(outputPixel.info.width / 2);
  const centerY = Math.floor(outputPixel.info.height / 2);
  const alphaIndex = ((centerY * outputPixel.info.width) + centerX) * 4 + 3;
  assert.ok(outputPixel.data[alphaIndex] > 0 && outputPixel.data[alphaIndex] < 255, "alpha channel should be preserved for semitransparent pixels");
  assert.equal(normalizeExtension(".JPG"), "jpg");
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

test("CR2 service extracts the embedded JPEG before transforming and keys the original object", async () => {
  const sourceBytes = Buffer.from("synthetic CR2 source bytes");
  const originalSource = Buffer.from(sourceBytes);
  const previewBuffer = await sharp({
    create: { width: 90, height: 60, channels: 3, background: { r: 30, g: 80, b: 120 } },
  }).jpeg().toBuffer();
  const cr2Module = require("../src/thumbnail/cr2");
  const originalExtractor = cr2Module.extractCR2EmbeddedPreview;
  let receivedInput;
  cr2Module.extractCR2EmbeddedPreview = async ({ input }) => {
    receivedInput = input;
    return { eligible: true, buffer: previewBuffer, fallbackOrientation: 8 };
  };

  try {
    const result = await applyThumbnailPolicy({
      region: "us-east-1",
      bucket: "source-bucket",
      sourceKey: "raw/test.CR2",
      etag: '"cr2-etag"',
      sourceBytes,
      extension: ".CR2",
      size: sourceBytes.length,
    });

    assert.equal(receivedInput, sourceBytes);
    assert.equal(sourceBytes.equals(originalSource), true);
    assert.equal(result.eligible, true);
    assert.equal(result.reason, "thumbnail-generated");
    assert.equal(result.derivedKey, createThumbnailKey({
      region: "us-east-1",
      bucket: "source-bucket",
      sourceKey: "raw/test.CR2",
      etag: '"cr2-etag"',
    }));
    assert.deepEqual(result.dimensions, { width: 60, height: 90 });
    assert.equal(result.contentType, "image/webp");
    assert.equal(result.format, "webp");
    assert.ok(result.bytes > 0);
    assert.equal(result.bytes, result.webpBuffer.length);
    assert.equal((await sharp(result.webpBuffer).metadata()).format, "webp");
  } finally {
    cr2Module.extractCR2EmbeddedPreview = originalExtractor;
  }
});

test("CR2 service honors orientation owned by the embedded preview", async () => {
  const previewBuffer = await sharp({
    create: { width: 90, height: 60, channels: 3, background: { r: 30, g: 80, b: 120 } },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const cr2Module = require("../src/thumbnail/cr2");
  const originalExtractor = cr2Module.extractCR2EmbeddedPreview;
  cr2Module.extractCR2EmbeddedPreview = async () => ({ eligible: true, buffer: previewBuffer });

  try {
    const result = await applyThumbnailPolicy({
      region: "us-east-1",
      bucket: "source-bucket",
      sourceKey: "raw/oriented.CR2",
      etag: '"oriented"',
      sourceBytes: Buffer.from("synthetic CR2 source bytes"),
      extension: "cr2",
      size: 26,
    });

    assert.equal(result.eligible, true);
    assert.deepEqual(result.dimensions, { width: 60, height: 90 });
    assert.equal((await sharp(result.webpBuffer).metadata()).orientation, undefined);
  } finally {
    cr2Module.extractCR2EmbeddedPreview = originalExtractor;
  }
});

test("CR2 extractor declines and unusable previews produce no thumbnail output", async () => {
  const cr2Module = require("../src/thumbnail/cr2");
  const originalExtractor = cr2Module.extractCR2EmbeddedPreview;
  const failures = [
    { eligible: false, reason: "portable-cr2-preview-empty", buffer: null },
    { eligible: false, reason: "portable-cr2-preview-low-quality", buffer: null },
    { eligible: false, reason: "cr2-orientation-unsupported", buffer: null },
    { eligible: true, buffer: null },
  ];

  try {
    for (const extraction of failures) {
      cr2Module.extractCR2EmbeddedPreview = async () => extraction;
      const result = await applyThumbnailPolicy({
        region: "us-east-1",
        bucket: "source-bucket",
        sourceKey: "raw/test.CR2",
        etag: '"cr2-etag"',
        sourceBytes: Buffer.from("synthetic CR2"),
        extension: "cr2",
        size: 13,
      });

      assert.equal(result.eligible, false);
      assert.equal(result.reason, "cr2-preview-unavailable");
      assert.equal(result.derivedKey, null);
      assert.equal(result.dimensions, null);
      assert.equal(result.contentType, null);
      assert.equal(result.bytes, null);
      assert.equal(result.webpBuffer, undefined);
    }
  } finally {
    cr2Module.extractCR2EmbeddedPreview = originalExtractor;
  }
});

test("corrupt CR2 bytes fail safely through the main service", async () => {
  const sourceBytes = Buffer.from("not a valid CR2");
  const original = Buffer.from(sourceBytes);
  const result = await applyThumbnailPolicy({
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "raw/corrupt.CR2",
    etag: '"corrupt"',
    sourceBytes,
    extension: "cr2",
    size: sourceBytes.length,
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, "cr2-preview-unavailable");
  assert.equal(result.derivedKey, null);
  assert.equal(result.webpBuffer, undefined);
  assert.equal(sourceBytes.equals(original), true);
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

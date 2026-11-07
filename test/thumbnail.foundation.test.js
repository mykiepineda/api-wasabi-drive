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

const pixelAt = (image, x, y) => {
  const index = ((y * image.info.width) + x) * image.info.channels;
  return [...image.data.subarray(index, index + 3)];
};

const assertColorNear = (actual, expected) => {
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(Math.abs(actual[channel] - expected[channel]) < 45, `expected ${actual} near ${expected}`);
  }
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
      assert.equal(result.derivedKey, createThumbnailKey({
        region: "us-east-1",
        bucket: "source-bucket",
        sourceKey: `photos/family.${extension}`,
        etag: '"abc-123"',
        formatVersion: "v1",
      }));
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
  const transformed = await transformToWebp({ input });
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

test("v2 uses a centred 200x190 cover crop for landscape and portrait images", async () => {
  const makeBands = async ({ width, height, vertical }) => {
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const position = vertical ? y : x;
        const span = vertical ? height : width;
        const color = position < span / 4
          ? [255, 0, 0]
          : position >= (span * 3) / 4
            ? [0, 0, 255]
            : [0, 200, 0];
        const index = ((y * width) + x) * 3;
        pixels[index] = color[0];
        pixels[index + 1] = color[1];
        pixels[index + 2] = color[2];
      }
    }
    return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  };
  const cases = [
    { width: 400, height: 190, vertical: false },
    { width: 200, height: 380, vertical: true },
  ];

  for (const dimensions of cases) {
    const input = await makeBands(dimensions);
    const originalInput = Buffer.from(input);
    const transformed = await transformToWebp({ input, recipeId: "v2" });
    const output = await sharp(transformed.buffer).raw().toBuffer({ resolveWithObject: true });

    assert.deepEqual({ width: transformed.width, height: transformed.height }, { width: 200, height: 190 });
    assert.equal(input.equals(originalInput), true);
    if (dimensions.vertical) {
      assertColorNear(pixelAt(output, 100, 5), [0, 200, 0]);
      assertColorNear(pixelAt(output, 100, 185), [0, 200, 0]);
    } else {
      assertColorNear(pixelAt(output, 5, 95), [0, 200, 0]);
      assertColorNear(pixelAt(output, 195, 95), [0, 200, 0]);
    }
    assert.equal((await sharp(transformed.buffer).metadata()).format, "webp");
    if (!dimensions.vertical) {
      const expected = await sharp(input)
        .rotate()
        .resize(200, 190, { fit: "cover", position: "centre", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      assert.deepEqual(transformed.buffer, expected);
    }
  }
});

test("v2 auto-orients before cropping, strips orientation metadata, and retains alpha", async () => {
  const input = await makePngBuffer({ width: 400, height: 600, orientation: 6, alpha: 0.5 });
  const transformed = await transformToWebp({ input, recipeId: "v2" });
  const output = await sharp(transformed.buffer).raw().toBuffer({ resolveWithObject: true });
  const metadata = await sharp(transformed.buffer).metadata();
  const alphaIndex = ((95 * output.info.width) + 100) * output.info.channels + 3;

  assert.deepEqual({ width: transformed.width, height: transformed.height }, { width: 200, height: 190 });
  assert.equal(metadata.orientation, undefined);
  assert.equal(output.info.channels, 4);
  assert.ok(output.data[alphaIndex] > 0 && output.data[alphaIndex] < 255);
});

test("v2 rejects sources and embedded previews too small for an exact crop without enlargement", async () => {
  const tooSmallInputs = [
    { width: 199, height: 400 },
    { width: 400, height: 189 },
  ];
  for (const dimensions of tooSmallInputs) {
    const sourceBytes = await makePngBuffer(dimensions);
    const result = await applyThumbnailPolicy({
      region: "us-east-1",
      bucket: "source-bucket",
      sourceKey: "photos/small.png",
      etag: '"small"',
      sourceBytes,
      extension: "png",
      size: sourceBytes.length,
      recipeId: "v2",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "thumbnail-source-too-small");
    assert.equal(result.derivedKey, null);
  }

  const cr2Module = require("../src/thumbnail/cr2");
  const originalExtractor = cr2Module.extractCR2EmbeddedPreview;
  const previewBuffer = await makePngBuffer({ width: 199, height: 400 });
  cr2Module.extractCR2EmbeddedPreview = async () => ({ eligible: true, buffer: previewBuffer });
  try {
    const sourceBytes = Buffer.from("synthetic CR2 bytes");
    const result = await applyThumbnailPolicy({
      region: "us-east-1",
      bucket: "source-bucket",
      sourceKey: "raw/small.CR2",
      etag: '"small-cr2"',
      sourceBytes,
      extension: "cr2",
      size: sourceBytes.length,
      recipeId: "v2",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "thumbnail-source-too-small");
  } finally {
    cr2Module.extractCR2EmbeddedPreview = originalExtractor;
  }
});

test("v2 applies the existing CR2 preview and fallback-orientation path", async () => {
  const sourceBytes = Buffer.from("synthetic CR2 bytes");
  const originalSource = Buffer.from(sourceBytes);
  const previewBuffer = await makePngBuffer({ width: 500, height: 400 });
  const cr2Module = require("../src/thumbnail/cr2");
  const originalExtractor = cr2Module.extractCR2EmbeddedPreview;
  cr2Module.extractCR2EmbeddedPreview = async () => ({
    eligible: true,
    buffer: previewBuffer,
    fallbackOrientation: 6,
  });

  try {
    const result = await applyThumbnailPolicy({
      region: "us-east-1",
      bucket: "source-bucket",
      sourceKey: "raw/v2.CR2",
      etag: '"v2-cr2"',
      sourceBytes,
      extension: "cr2",
      size: sourceBytes.length,
      recipeId: "v2",
    });

    assert.equal(result.eligible, true);
    assert.equal(result.derivedKey, createThumbnailKey({
      region: "us-east-1",
      bucket: "source-bucket",
      sourceKey: "raw/v2.CR2",
      etag: '"v2-cr2"',
      formatVersion: "v2",
    }));
    assert.deepEqual(result.dimensions, { width: 200, height: 190 });
    assert.equal(result.contentType, "image/webp");
    assert.equal(sourceBytes.equals(originalSource), true);
  } finally {
    cr2Module.extractCR2EmbeddedPreview = originalExtractor;
  }
});

test("thumbnail library rejects unknown recipes and custom transform settings", async () => {
  const sourceBytes = await makePngBuffer({ width: 400, height: 400 });
  const base = {
    region: "us-east-1",
    bucket: "source-bucket",
    sourceKey: "photos/recipe.png",
    etag: '"recipe"',
    sourceBytes,
    extension: "png",
    size: sourceBytes.length,
  };

  for (const recipeId of ["v3", "../v2", "V2", { id: "v2" }]) {
    const result = await applyThumbnailPolicy({ ...base, recipeId });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "unsupported-thumbnail-recipe");
  }
  for (const custom of [{ maxEdge: 200 }, { quality: 75 }]) {
    const result = await applyThumbnailPolicy({ ...base, ...custom });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "unsupported-custom-recipe");
  }
  await assert.rejects(
    transformToWebp({ input: sourceBytes, recipeId: "v2", width: 300 }),
    /Custom thumbnail transform options/,
  );
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

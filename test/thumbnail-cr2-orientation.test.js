const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  readCR2Orientation,
  resolveCR2PreviewOrientation,
} = require("../src/thumbnail/cr2");
const { transformToWebp } = require("../src/thumbnail/transform");

const writeUInt16 = (buffer, offset, value, littleEndian) => {
  if (littleEndian) {
    buffer.writeUInt16LE(value, offset);
  } else {
    buffer.writeUInt16BE(value, offset);
  }
};

const writeUInt32 = (buffer, offset, value, littleEndian) => {
  if (littleEndian) {
    buffer.writeUInt32LE(value, offset);
  } else {
    buffer.writeUInt32BE(value, offset);
  }
};

const makeTiffHeader = ({ orientation = 8, littleEndian = true, type = 3, count = 1 } = {}) => {
  const entryCount = orientation === null ? 0 : 1;
  const buffer = Buffer.alloc(8 + 2 + (entryCount * 12) + 4);
  buffer[0] = littleEndian ? 0x49 : 0x4d;
  buffer[1] = buffer[0];
  writeUInt16(buffer, 2, 42, littleEndian);
  writeUInt32(buffer, 4, 8, littleEndian);
  writeUInt16(buffer, 8, entryCount, littleEndian);

  if (entryCount === 1) {
    writeUInt16(buffer, 10, 0x0112, littleEndian);
    writeUInt16(buffer, 12, type, littleEndian);
    writeUInt32(buffer, 14, count, littleEndian);
    writeUInt16(buffer, 18, orientation, littleEndian);
  }

  return buffer;
};

const makeAsymmetricPng = async () => {
  const width = 90;
  const height = 60;
  const cell = 30;
  const colors = [
    [255, 0, 0], [0, 255, 0], [0, 0, 255],
    [255, 255, 0], [0, 255, 255], [255, 0, 255],
  ];
  const pixels = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = colors[(Math.floor(y / cell) * 3) + Math.floor(x / cell)];
      const index = ((y * width) + x) * 3;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
};

const dominantColorAt = (image, x, y) => {
  const index = ((y * image.info.width) + x) * image.info.channels;
  return [...image.data.subarray(index, index + 3)];
};

const assertColorNear = (actual, expected) => {
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(Math.abs(actual[channel] - expected[channel]) < 45, `expected ${actual} near ${expected}`);
  }
};

test("CR2 IFD0 orientation reads values in both TIFF byte orders", () => {
  for (const littleEndian of [true, false]) {
    for (const orientation of [1, 3, 6, 8]) {
      assert.deepEqual(
        readCR2Orientation(makeTiffHeader({ orientation, littleEndian })),
        { status: "orientation", orientation },
      );
    }
  }
});

test("CR2 IFD0 orientation reports absence and rejects malformed TIFF/IFD metadata", () => {
  const badByteOrder = Buffer.from(makeTiffHeader());
  badByteOrder[0] = 0x58;
  const badMagic = Buffer.from(makeTiffHeader());
  badMagic.writeUInt16LE(43, 2);
  const unsafeOffset = Buffer.from(makeTiffHeader());
  unsafeOffset.writeUInt32LE(0xfffffff0, 4);
  const truncatedEntry = makeTiffHeader();
  truncatedEntry.writeUInt16LE(2, 8);
  const invalidOrientation = makeTiffHeader({ orientation: 9 });
  const wrongType = makeTiffHeader({ orientation: 8, type: 4 });
  const wrongCount = makeTiffHeader({ orientation: 8, count: 2 });
  const truncatedHeader = Buffer.from([0x49, 0x49, 42, 0]);

  assert.deepEqual(readCR2Orientation(makeTiffHeader({ orientation: null })), {
    status: "absent",
    orientation: null,
  });

  for (const malformed of [
    badByteOrder,
    badMagic,
    unsafeOffset,
    truncatedEntry,
    invalidOrientation,
    wrongType,
    wrongCount,
    truncatedHeader,
  ]) {
    assert.deepEqual(readCR2Orientation(malformed), {
      status: "malformed",
      orientation: null,
    });
  }
});

test("CR2 orientation uses preview EXIF first and falls back to IFD0 only when absent", () => {
  const sourceOrientation = { status: "orientation", orientation: 8 };
  const fallback = resolveCR2PreviewOrientation({ sourceOrientation });
  const previewOwnOrientation = resolveCR2PreviewOrientation({
    sourceOrientation,
    previewOrientation: 1,
  });

  assert.equal(fallback.eligible, true);
  assert.equal(fallback.orientationSource, "cr2-ifd0");
  assert.equal(fallback.fallbackOrientation, 8);
  assert.equal(fallback.orientationApplied, true);
  assert.equal(previewOwnOrientation.eligible, true);
  assert.equal(previewOwnOrientation.orientationSource, "preview-exif");
  assert.equal(previewOwnOrientation.fallbackOrientation, undefined);
  assert.equal(previewOwnOrientation.orientationApplied, false);
  assert.equal(resolveCR2PreviewOrientation({
    sourceOrientation: { status: "malformed", orientation: null },
    previewOrientation: 6,
  }).orientationSource, "preview-exif");
});

test("CR2 mirrored orientations fail closed when they would need to be applied", () => {
  for (const orientation of [2, 4, 5, 7]) {
    assert.deepEqual(
      resolveCR2PreviewOrientation({
        sourceOrientation: { status: "orientation", orientation },
      }),
      { eligible: false, reason: "cr2-orientation-unsupported" },
    );
    assert.deepEqual(
      resolveCR2PreviewOrientation({ previewOrientation: orientation }),
      { eligible: false, reason: "cr2-orientation-unsupported" },
    );
  }
});

test("CR2 IFD0 orientation 8 rotates pixels counterclockwise with metadata stripped", async () => {
  const input = await makeAsymmetricPng();
  const transformed = await transformToWebp({
    input,
    maxEdge: 512,
    quality: 80,
    fallbackOrientation: 8,
  });
  const output = await sharp(transformed.buffer).raw().toBuffer({ resolveWithObject: true });
  const metadata = await sharp(transformed.buffer).metadata();

  assert.equal(transformed.width, 60);
  assert.equal(transformed.height, 90);
  assert.equal(metadata.orientation, undefined);
  assertColorNear(dominantColorAt(output, 15, 15), [0, 0, 255]);
  assertColorNear(dominantColorAt(output, 15, 45), [0, 255, 0]);
  assertColorNear(dominantColorAt(output, 15, 75), [255, 0, 0]);
  assertColorNear(dominantColorAt(output, 45, 15), [255, 0, 255]);
  assertColorNear(dominantColorAt(output, 45, 45), [0, 255, 255]);
  assertColorNear(dominantColorAt(output, 45, 75), [255, 255, 0]);
});

test("preview EXIF orientation is auto-applied once and ordinary auto-orientation remains unchanged", async () => {
  const input = await sharp({
    create: {
      width: 90,
      height: 60,
      channels: 3,
      background: { r: 30, g: 80, b: 120 },
    },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const previewMetadata = await sharp(input).metadata();
  const selected = resolveCR2PreviewOrientation({
    sourceOrientation: { status: "orientation", orientation: 8 },
    previewOrientation: previewMetadata.orientation,
  });
  const transformed = await transformToWebp({ input, maxEdge: 512, quality: 80 });

  assert.equal(selected.orientationSource, "preview-exif");
  assert.equal(selected.fallbackOrientation, undefined);
  assert.equal(transformed.width, 60);
  assert.equal(transformed.height, 90);
  assert.equal((await sharp(transformed.buffer).metadata()).orientation, undefined);
});

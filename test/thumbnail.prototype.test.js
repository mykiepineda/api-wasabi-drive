const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { prototypeThumbnail } = require("../src/thumbnail/prototype");

let temporaryDirectory;

test.beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "wasabi-thumbnail-test-"));
});

test.afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

const createPng = (filePath, width, height, options = {}) => {
  let image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 35, g: 120, b: 210, alpha: 1 },
    },
  });
  if (options.orientation) {
    image = image.withMetadata({ orientation: options.orientation });
  }
  return image.png().toFile(filePath);
};

test("resizes large images inside bounds and preserves aspect ratio", async () => {
  const inputPath = path.join(temporaryDirectory, "large.png");
  const outputPath = path.join(temporaryDirectory, "large.webp");
  await createPng(inputPath, 1200, 600);

  const result = await prototypeThumbnail({ inputPath, outputPath });

  assert.equal(result.sourceFormat, "png");
  assert.equal(result.sourceWidth, 1200);
  assert.equal(result.sourceHeight, 600);
  assert.ok(result.outputWidth <= 512);
  assert.ok(result.outputHeight <= 512);
  assert.equal(result.outputWidth / result.outputHeight, 2);
  assert.ok(result.inputBytes > 0);
  assert.ok(result.outputBytes > 0);
});

test("does not enlarge smaller images", async () => {
  const inputPath = path.join(temporaryDirectory, "small.png");
  const outputPath = path.join(temporaryDirectory, "small.webp");
  await createPng(inputPath, 32, 18);

  const result = await prototypeThumbnail({ inputPath, outputPath });

  assert.equal(result.outputWidth, 32);
  assert.equal(result.outputHeight, 18);
});

test("auto-orients images using their EXIF orientation", async () => {
  const inputPath = path.join(temporaryDirectory, "oriented.png");
  const outputPath = path.join(temporaryDirectory, "oriented.webp");
  await createPng(inputPath, 40, 20, { orientation: 6 });

  const result = await prototypeThumbnail({ inputPath, outputPath });

  assert.equal(result.sourceWidth, 40);
  assert.equal(result.sourceHeight, 20);
  assert.equal(result.outputWidth, 20);
  assert.equal(result.outputHeight, 40);
  const outputBuffer = await fs.readFile(outputPath);
  assert.equal((await sharp(outputBuffer).metadata()).orientation, undefined);
});

test("rejects undecodable image data without producing a result", async () => {
  const inputPath = path.join(temporaryDirectory, "invalid-image.bin");
  const outputPath = path.join(temporaryDirectory, "invalid.webp");
  await fs.writeFile(inputPath, Buffer.from("not an image"));

  await assert.rejects(prototypeThumbnail({ inputPath, outputPath }));
  await assert.rejects(fs.access(outputPath));
});
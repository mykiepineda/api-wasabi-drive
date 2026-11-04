const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const sharp = require("sharp");
const { prototypeThumbnail } = require("../src/thumbnail/prototype");
const { parseArguments } = require("../scripts/prototype-thumbnail");

const execFileAsync = promisify(execFile);
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

const createSectionedPng = async (filePath, width, height, orientation = undefined) => {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = width > height
        ? (x < width * 0.125 ? [255, 0, 0] : x >= width * 0.875 ? [0, 0, 255] : [0, 255, 0])
        : (y < height * 0.125 ? [255, 0, 0] : y >= height * 0.875 ? [0, 0, 255] : [0, 255, 0]);
      data.set(color, (y * width + x) * 3);
    }
  }

  let image = sharp(data, { raw: { width, height, channels: 3 } });
  if (orientation) {
    image = image.withMetadata({ orientation });
  }
  return image.png().toFile(filePath);
};

const readPixel = async (filePath, x, y) => {
  const image = await fs.readFile(filePath);
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
};

const assertColorNear = (actual, expected) => {
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(Math.abs(actual[channel] - expected[channel]) < 45, `${actual} should be near ${expected}`);
  }
};

test("keeps the default CLI recipe and accepts existing max-edge and quality options", () => {
  assert.deepEqual(parseArguments(["input.jpg", "output.webp"]), {
    inputPath: "input.jpg",
    outputArgument: "output.webp",
    maxEdge: 512,
    quality: 80,
    maxEdgeSpecified: false,
  });
  assert.deepEqual(parseArguments([
    "input.jpg",
    "output.webp",
    "--max-edge",
    "640",
    "--quality",
    "75",
  ]), {
    inputPath: "input.jpg",
    outputArgument: "output.webp",
    maxEdge: 640,
    quality: 75,
    maxEdgeSpecified: true,
  });
});

test("keeps the default thumbnail bytes identical to the explicit 512/80 recipe", async () => {
  const inputPath = path.join(temporaryDirectory, "compatibility.png");
  const defaultOutputPath = path.join(temporaryDirectory, "default.webp");
  const explicitOutputPath = path.join(temporaryDirectory, "explicit.webp");
  await createPng(inputPath, 1200, 600);

  const defaultResult = await prototypeThumbnail({ inputPath, outputPath: defaultOutputPath });
  const explicitResult = await prototypeThumbnail({
    inputPath,
    outputPath: explicitOutputPath,
    maxEdge: 512,
    quality: 80,
  });

  assert.equal(defaultResult.outputWidth, explicitResult.outputWidth);
  assert.equal(defaultResult.outputHeight, explicitResult.outputHeight);
  assert.deepEqual(await fs.readFile(defaultOutputPath), await fs.readFile(explicitOutputPath));
});

test("runs crop options through the local CLI", async () => {
  const inputPath = path.join(temporaryDirectory, "cli-input.png");
  const outputPath = path.join(temporaryDirectory, "cli-output.webp");
  const cliPath = path.join(__dirname, "..", "scripts", "prototype-thumbnail.js");
  await createPng(inputPath, 40, 20);

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    inputPath,
    outputPath,
    "--crop-width",
    "20",
    "--crop-height",
    "19",
    "--quality",
    "80",
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.outputWidth, 20);
  assert.equal(result.outputHeight, 19);
  assert.equal(result.outputBytes, (await fs.stat(outputPath)).size);
});

test("parses crop dimensions and rejects ambiguous or invalid CLI options", () => {
  const parsed = parseArguments([
    "input.jpg",
    "output.webp",
    "--crop-width",
    "200",
    "--crop-height",
    "190",
    "--quality",
    "80",
  ]);
  assert.equal(parsed.cropWidth, 200);
  assert.equal(parsed.cropHeight, 190);
  assert.throws(() => parseArguments(["input.jpg", "output.webp", "--crop-width", "200"]), /specified together/);
  assert.throws(() => parseArguments(["input.jpg", "output.webp", "--crop-height", "190"]), /specified together/);
  assert.throws(() => parseArguments([
    "input.jpg",
    "output.webp",
    "--crop-width",
    "200",
    "--crop-height",
    "190",
    "--max-edge",
    "512",
  ]), /cannot be combined/);
  assert.throws(() => parseArguments(["input.jpg", "output.webp", "--crop-width", "0", "--crop-height", "190"]), /positive/);
  assert.throws(() => parseArguments(["input.jpg", "output.webp", "--crop-width", "1.5", "--crop-height", "190"]), /integer/);
  assert.throws(() => parseArguments(["input.jpg", "output.webp", "--crop-width", "10001", "--crop-height", "190"]), /positive/);
  assert.throws(() => parseArguments(["input.jpg", "output.webp", "--quality", "101"]), /Quality/);
  assert.throws(() => parseArguments(["input.jpg", "output.webp", "--quality", "80", "--quality", "90"]), /once/);
  assert.throws(() => parseArguments(["input.jpg", "output.webp", "--max-edge", "512", "--max-edge", "256"]), /once/);
});

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

test("centre-crops a landscape source to the requested 20:19 dimensions", async () => {
  const inputPath = path.join(temporaryDirectory, "landscape.png");
  const outputPath = path.join(temporaryDirectory, "landscape.webp");
  await createSectionedPng(inputPath, 40, 20);

  const result = await prototypeThumbnail({
    inputPath,
    outputPath,
    cropWidth: 20,
    cropHeight: 19,
  });

  assert.equal(result.outputWidth, 20);
  assert.equal(result.outputHeight, 19);
  assert.ok(result.outputBytes > 0);
  assert.equal((await fs.stat(outputPath)).size, result.outputBytes);
  assertColorNear(await readPixel(outputPath, 1, 9), [0, 255, 0]);
  assertColorNear(await readPixel(outputPath, 18, 9), [0, 255, 0]);
});

test("centre-crops a portrait source to the requested 20:19 dimensions", async () => {
  const inputPath = path.join(temporaryDirectory, "portrait.png");
  const outputPath = path.join(temporaryDirectory, "portrait.webp");
  await createSectionedPng(inputPath, 20, 40);

  const result = await prototypeThumbnail({
    inputPath,
    outputPath,
    cropWidth: 20,
    cropHeight: 19,
  });

  assert.equal(result.outputWidth, 20);
  assert.equal(result.outputHeight, 19);
  assert.ok(result.outputBytes > 0);
  assertColorNear(await readPixel(outputPath, 10, 1), [0, 255, 0]);
  assertColorNear(await readPixel(outputPath, 10, 17), [0, 255, 0]);
});

test("auto-orients and centre-crops oriented images", async () => {
  const inputPath = path.join(temporaryDirectory, "oriented-crop.png");
  const outputPath = path.join(temporaryDirectory, "oriented-crop.webp");
  await createSectionedPng(inputPath, 40, 20, 6);

  const result = await prototypeThumbnail({
    inputPath,
    outputPath,
    cropWidth: 20,
    cropHeight: 19,
  });

  assert.equal(result.outputWidth, 20);
  assert.equal(result.outputHeight, 19);
  const outputBuffer = await fs.readFile(outputPath);
  assert.equal((await sharp(outputBuffer).metadata()).orientation, undefined);
  assertColorNear(await readPixel(outputPath, 1, 9), [0, 255, 0]);
  assertColorNear(await readPixel(outputPath, 18, 9), [0, 255, 0]);
});

test("does not enlarge sources smaller than the crop dimensions", async () => {
  const inputPath = path.join(temporaryDirectory, "tiny.png");
  const outputPath = path.join(temporaryDirectory, "tiny.webp");
  await createPng(inputPath, 10, 8);

  const result = await prototypeThumbnail({
    inputPath,
    outputPath,
    cropWidth: 20,
    cropHeight: 19,
  });

  assert.ok(result.outputWidth < 20);
  assert.ok(result.outputHeight < 19);
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

test("rejects invalid crop options and prevents input overwrite", async () => {
  const inputPath = path.join(temporaryDirectory, "protected.png");
  await createPng(inputPath, 40, 20);
  const originalBytes = await fs.readFile(inputPath);

  await assert.rejects(prototypeThumbnail({
    inputPath,
    outputPath: path.join(temporaryDirectory, "unpaired.webp"),
    cropWidth: 20,
  }), /provided together/);
  await assert.rejects(prototypeThumbnail({
    inputPath,
    outputPath: path.join(temporaryDirectory, "conflict.webp"),
    cropWidth: 20,
    cropHeight: 19,
    maxEdge: 512,
  }), /cannot be combined/);
  await assert.rejects(prototypeThumbnail({
    inputPath,
    outputPath: path.join(temporaryDirectory, "invalid-size.webp"),
    cropWidth: 10001,
    cropHeight: 19,
  }), /no greater than/);
  await assert.rejects(prototypeThumbnail({
    inputPath,
    outputPath: path.join(temporaryDirectory, "invalid-quality.webp"),
    cropWidth: 20,
    cropHeight: 19,
    quality: 101,
  }), /quality/);
  await assert.rejects(prototypeThumbnail({
    inputPath,
    outputPath: inputPath,
    cropWidth: 20,
    cropHeight: 19,
  }), /must be different/);

  assert.deepEqual(await fs.readFile(inputPath), originalBytes);
  await assert.rejects(fs.access(path.join(temporaryDirectory, "unpaired.webp")));
});

test("rejects undecodable image data without producing a result", async () => {
  const inputPath = path.join(temporaryDirectory, "invalid-image.bin");
  const outputPath = path.join(temporaryDirectory, "invalid.webp");
  await fs.writeFile(inputPath, Buffer.from("not an image"));

  await assert.rejects(prototypeThumbnail({ inputPath, outputPath }));
  await assert.rejects(fs.access(outputPath));
});
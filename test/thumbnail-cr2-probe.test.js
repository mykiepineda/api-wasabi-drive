const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { main, parseArguments } = require("../scripts/thumbnail-cr2-probe");

test("CR2 probe accepts only the supported local invocation forms", () => {
  const inputPath = "C:\\synthetic\\sample.CR2";
  const outputPath = "C:\\synthetic\\sample-preview.webp";

  assert.deepEqual(parseArguments([inputPath]), {
    inputPath: path.resolve(inputPath),
    outputPath: null,
  });
  assert.deepEqual(parseArguments([inputPath, "--webp", outputPath]), {
    inputPath: path.resolve(inputPath),
    outputPath: path.resolve(outputPath),
  });
});

test("CR2 probe rejects missing, misplaced, duplicate, and unsupported arguments", () => {
  const inputPath = "C:\\synthetic\\sample.CR2";
  const outputPath = "C:\\synthetic\\sample-preview.webp";
  const invalidArguments = [
    [],
    [""],
    ["--webp", outputPath],
    [inputPath, "--webp"],
    [inputPath, outputPath],
    [inputPath, outputPath, "--webp"],
    [inputPath, "--webp", outputPath, "--webp"],
    [inputPath, "--webp", ""],
    [inputPath, "--webp", "C:\\synthetic\\sample-preview.jpg"],
    [inputPath, "--webp", inputPath],
  ];

  for (const args of invalidArguments) {
    assert.throws(() => parseArguments(args), /Usage: node scripts\/thumbnail-cr2-probe\.js/);
  }
});

test("CR2 probe returns a nonzero safe usage error for invalid CLI arguments", async () => {
  const originalError = console.error;
  const messages = [];
  console.error = (message) => messages.push(message);

  try {
    assert.equal(await main(["C:\\synthetic\\sample.CR2", "--webp"]), 2);
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(messages, [
    "Usage: node scripts/thumbnail-cr2-probe.js <local-cr2-file> [--webp <output-webp-file>]",
  ]);
  assert.equal(messages.some((message) => message.includes("synthetic")), false);
});

test("CR2 probe transforms a synthetic embedded preview with v1 and writes output exclusively", async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "thumbnail-cr2-probe-test-"));
  const sourcePath = path.join(temporaryDirectory, "synthetic.CR2");
  const outputPath = path.join(temporaryDirectory, "synthetic.webp");
  const sourceBytes = Buffer.from("synthetic CR2 container");
  const previewBuffer = await sharp({
    create: {
      width: 800,
      height: 400,
      channels: 3,
      background: { r: 35, g: 120, b: 210 },
    },
  }).png().toBuffer();
  const cr2Module = require("../src/thumbnail/cr2");
  const probePath = require.resolve("../scripts/thumbnail-cr2-probe");
  const cachedProbe = require.cache[probePath];
  const originalExtractor = cr2Module.extractCR2EmbeddedPreview;
  const originalLog = console.log;
  const messages = [];
  let receivedSource;

  cr2Module.extractCR2EmbeddedPreview = async ({ input }) => {
    receivedSource = input;
    return {
      eligible: true,
      reason: "synthetic-preview-ready",
      buffer: previewBuffer,
      width: 800,
      height: 400,
      format: "image/png",
      byteLength: previewBuffer.length,
      sourceOrientation: 6,
      orientationSource: "cr2-ifd0",
      orientationApplied: true,
      fallbackOrientation: 6,
    };
  };
  delete require.cache[probePath];
  const { main: runProbe } = require("../scripts/thumbnail-cr2-probe");
  console.log = (message) => messages.push(message);

  try {
    await fs.writeFile(sourcePath, sourceBytes);
    assert.equal(await runProbe([sourcePath, "--webp", outputPath]), 0);

    const result = JSON.parse(messages[0]);
    assert.equal(receivedSource.equals(sourceBytes), true);
    assert.deepEqual(result, {
      eligible: true,
      reason: "synthetic-preview-ready",
      mimeType: "image/png",
      width: 800,
      height: 400,
      byteLength: previewBuffer.length,
      sourceOrientation: 6,
      orientationSource: "cr2-ifd0",
      orientationApplied: true,
      webp: {
        width: 256,
        height: 512,
        byteLength: result.webp.byteLength,
      },
    });
    assert.ok(result.webp.byteLength > 0);

    const writtenWebp = await fs.readFile(outputPath);
    const metadata = await sharp(writtenWebp).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.orientation, undefined);

    messages.length = 0;
    assert.equal(await runProbe([sourcePath, "--webp", outputPath]), 1);
    assert.equal(JSON.parse(messages[0]).reason, "probe-failed");
    assert.deepEqual(await fs.readFile(outputPath), writtenWebp);
  } finally {
    console.log = originalLog;
    cr2Module.extractCR2EmbeddedPreview = originalExtractor;
    if (cachedProbe) {
      require.cache[probePath] = cachedProbe;
    } else {
      delete require.cache[probePath];
    }
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

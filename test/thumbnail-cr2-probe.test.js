const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
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

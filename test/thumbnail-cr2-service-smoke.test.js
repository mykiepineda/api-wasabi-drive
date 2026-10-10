const test = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("../scripts/thumbnail-cr2-service-smoke");

const runWithSyntheticInput = async (result) => {
  const originalExitCode = process.exitCode;
  const originalLog = console.log;
  const messages = [];
  process.exitCode = 23;
  console.log = (message) => messages.push(message);

  try {
    await run({
      sourcePath: "private-local-sample.CR2",
      readFile: () => Buffer.from("synthetic CR2 bytes"),
      applyPolicy: async () => result,
    });
    return { exitCode: process.exitCode, messages };
  } finally {
    process.exitCode = originalExitCode;
    console.log = originalLog;
  }
};

test("CR2 service smoke exits successfully and preserves sanitized JSON on generation success", async () => {
  const smoke = await runWithSyntheticInput({
    eligible: true,
    reason: "thumbnail-generated",
    derivedKey: "private-key-must-not-print",
    dimensions: { width: 341, height: 512 },
    bytes: 41620,
    contentType: "image/webp",
    webpBuffer: Buffer.from("synthetic output"),
  });

  assert.equal(smoke.exitCode, 0);
  assert.deepEqual(JSON.parse(smoke.messages[0]), {
    eligible: true,
    reason: "thumbnail-generated",
    dimensions: { width: 341, height: 512 },
    bytes: 41620,
    contentType: "image/webp",
  });
  assert.equal(smoke.messages[0].includes("private-key-must-not-print"), false);
});

test("CR2 service smoke exits unsuccessfully and preserves sanitized JSON when ineligible", async () => {
  const smoke = await runWithSyntheticInput({
    eligible: false,
    reason: "cr2-preview-unavailable",
    derivedKey: null,
    dimensions: null,
    bytes: null,
    contentType: null,
    message: "private failure details must not print",
  });

  assert.equal(smoke.exitCode, 1);
  assert.deepEqual(JSON.parse(smoke.messages[0]), {
    eligible: false,
    reason: "cr2-preview-unavailable",
    dimensions: null,
    bytes: null,
    contentType: null,
  });
  assert.equal(smoke.messages[0].includes("private failure details"), false);
});
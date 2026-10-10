const fs = require("node:fs");
const { applyThumbnailPolicy } = require("../src/thumbnail/service");

const printResult = (result) => {
  console.log(JSON.stringify({
    eligible: result.eligible,
    reason: result.reason,
    dimensions: result.dimensions,
    bytes: result.bytes,
    contentType: result.contentType,
  }));
};

const run = async () => {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    printResult({
      eligible: false,
      reason: "missing-local-cr2-path",
      dimensions: null,
      bytes: null,
      contentType: null,
    });
    process.exitCode = 2;
    return;
  }

  let sourceBytes;
  try {
    sourceBytes = fs.readFileSync(sourcePath);
  } catch {
    printResult({
      eligible: false,
      reason: "local-cr2-read-failed",
      dimensions: null,
      bytes: null,
      contentType: null,
    });
    process.exitCode = 1;
    return;
  }

  const result = await applyThumbnailPolicy({
    region: "local-smoke-region",
    bucket: "local-smoke-bucket",
    sourceKey: "local-smoke-source.CR2",
    etag: '"local-smoke-etag"',
    sourceBytes,
    extension: "cr2",
    size: sourceBytes.length,
  });
  printResult(result);
};

run().catch(() => {
  printResult({
    eligible: false,
    reason: "local-cr2-service-failed",
    dimensions: null,
    bytes: null,
    contentType: null,
  });
  process.exitCode = 1;
});
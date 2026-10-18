#!/usr/bin/env node
require("dotenv").config();

const {
  DEFAULT_PAGE_SIZE,
  MAX_OBJECTS_LIMIT,
  MAX_PAGE_SIZE,
  loadPreflightConfig,
  parseArguments,
  parseBoundedInteger,
  scanPreflight,
  validateScope,
} = require("../src/thumbnail/production-preflight");
const { createThumbnailPreflightStorage } = require("../src/storage/thumbnail-preflight-wasabi");

const SUMMARY_CATEGORIES = [
  "eligibleStandard",
  "eligibleCr2",
  "oversized",
  "unsupported",
  "zeroByte",
  "invalidEtag",
];

const safeSummary = (result, maxObjects) => {
  const isValidCategory = (value) =>
    value
    && Number.isSafeInteger(value.count)
    && value.count >= 0
    && Number.isSafeInteger(value.bytes)
    && value.bytes >= 0;
  if (
    !result
    || !Number.isSafeInteger(result.examined)
    || result.examined < 0
    || result.examined > maxObjects
    || !SUMMARY_CATEGORIES.every((category) => isValidCategory(result[category]))
    || SUMMARY_CATEGORIES.some((category) => result[category].count > result.examined)
    || !Number.isSafeInteger(result.cap)
    || result.cap !== maxObjects
    || typeof result.complete !== "boolean"
    || typeof result.capped !== "boolean"
    || result.complete === result.capped
    || (result.capped && result.examined !== maxObjects)
  ) {
    throw new Error("invalid-preflight-summary");
  }
  return {
    examined: result.examined,
    ...Object.fromEntries(SUMMARY_CATEGORIES.map((category) => [
      category,
      { count: result[category].count, bytes: result[category].bytes },
    ])),
    complete: result.complete,
    capped: result.capped,
    cap: result.cap,
  };
};

const main = async (
  args = process.argv.slice(2),
  {
    env = process.env,
    write = (message) => console.log(message),
    createStorage = createThumbnailPreflightStorage,
    runScan = scanPreflight,
  } = {},
) => {
  try {
    const options = parseArguments(args);
    const config = loadPreflightConfig(env);
    validateScope(options, config);
    const maxObjects = parseBoundedInteger(
      options.maxObjects,
      undefined,
      MAX_OBJECTS_LIMIT,
      "invalid-max-objects",
    );
    const pageSize = parseBoundedInteger(
      options.pageSize,
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
      "invalid-page-size",
    );
    const storage = createStorage({
      bucket: config.sourceBucket,
      prefix: config.sourcePrefix,
      region: config.sourceRegion,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
    const summary = await runScan({
      bucket: config.sourceBucket,
      region: config.sourceRegion,
      prefix: config.sourcePrefix,
      maxObjects,
      pageSize,
      listPage: ({ pageSize: requestedPageSize, continuationToken }) => storage.listPage({
        pageSize: requestedPageSize,
        continuationToken,
      }),
    });
    write(JSON.stringify(safeSummary(summary, maxObjects)));
    return 0;
  } catch {
    write(JSON.stringify({ category: "failed", code: "preflight-failed" }));
    return 1;
  }
};

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  main,
  safeSummary,
};

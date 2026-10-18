const { getObjectExtension } = require("./inventory");
const { evaluateThumbnailEligibility } = require("./eligibility");
const { normalizeEtag } = require("./key");
const {
  DEFAULT_PREFLIGHT_PAGE_SIZE,
  MAX_PREFLIGHT_OBJECTS,
  MAX_PREFLIGHT_PAGE_SIZE,
  MAX_SOURCE_BYTES,
} = require("./policy");
const {
  loadPreflightConfig,
  validatePrefix,
  validateSourceBucket,
  validateScope,
} = require("./preflight-scope");
const { SUPPORTED_WASABI_REGIONS } = require("../storage/wasabi-regions");

const MAX_OBJECTS_LIMIT = MAX_PREFLIGHT_OBJECTS;
const DEFAULT_PAGE_SIZE = DEFAULT_PREFLIGHT_PAGE_SIZE;
const MAX_PAGE_SIZE = MAX_PREFLIGHT_PAGE_SIZE;

const parseArguments = (args) => {
  const values = new Map();
  const valueFlags = new Set(["--source-bucket", "--source-region", "--prefix", "--max-objects", "--page-size"]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (
      !valueFlags.has(flag)
      || values.has(flag)
      || typeof args[index + 1] !== "string"
      || !args[index + 1]
      || args[index + 1].startsWith("--")
    ) {
      throw new Error("invalid-arguments");
    }
    values.set(flag, args[index + 1]);
    index += 1;
  }
  for (const flag of ["--source-bucket", "--source-region", "--prefix", "--max-objects"]) {
    if (!values.has(flag)) {
      throw new Error("invalid-arguments");
    }
  }

  return {
    sourceBucket: values.get("--source-bucket"),
    sourceRegion: values.get("--source-region"),
    prefix: values.get("--prefix"),
    maxObjects: values.get("--max-objects"),
    pageSize: values.get("--page-size"),
  };
};

const parseBoundedInteger = (value, defaultValue, maximum, errorCode) => {
  if (value === undefined) {
    return defaultValue;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(errorCode);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(errorCode);
  }
  return parsed;
};

const createSummary = () => ({
  examined: 0,
  eligibleStandard: { count: 0, bytes: 0 },
  eligibleCr2: { count: 0, bytes: 0 },
  oversized: { count: 0, bytes: 0 },
  unsupported: { count: 0, bytes: 0 },
  zeroByte: { count: 0, bytes: 0 },
  invalidEtag: { count: 0, bytes: 0 },
});

const incrementCategory = (summary, category, size) => {
  if (category !== "invalidEtag") {
    const primaryBytes = summary.eligibleStandard.bytes
      + summary.eligibleCr2.bytes
      + summary.oversized.bytes
      + summary.unsupported.bytes
      + summary.zeroByte.bytes;
    if (!Number.isSafeInteger(primaryBytes + size)) {
      throw new Error("invalid-listing-size-total");
    }
  }
  const nextBytes = summary[category].bytes + size;
  if (!Number.isSafeInteger(nextBytes)) {
    throw new Error("invalid-listing-size-total");
  }
  summary[category].count += 1;
  summary[category].bytes = nextBytes;
};

const classifyObject = (object, { bucket, region, prefix }, summary) => {
  const key = object.Key;
  const size = object.Size;
  if (
    typeof key !== "string"
    || !key.startsWith(prefix)
    || key.length === 0
    || !Number.isSafeInteger(size)
    || size < 0
  ) {
    throw new Error("invalid-listing-object");
  }

  summary.examined += 1;
  const hasValidEtag = typeof object.ETag === "string" && Boolean(normalizeEtag(object.ETag));
  if (!hasValidEtag) {
    incrementCategory(summary, "invalidEtag", size);
  }
  if (size === 0) {
    incrementCategory(summary, "zeroByte", size);
    return;
  }

  const eligibility = evaluateThumbnailEligibility({
    size,
    extension: getObjectExtension(key),
    sourceKey: key,
    region,
    bucket,
    etag: hasValidEtag ? object.ETag : "preflight-etag",
  });
  // Primary-category precedence: zero-byte, ineligible, oversized, then eligible.
  if (!eligibility.eligible) {
    incrementCategory(summary, "unsupported", size);
    return;
  }
  if (size > MAX_SOURCE_BYTES) {
    incrementCategory(summary, "oversized", size);
    return;
  }
  if (!hasValidEtag) {
    incrementCategory(summary, "unsupported", size);
    return;
  }
  if (eligibility.category === "standard-image") {
    incrementCategory(summary, "eligibleStandard", size);
  } else if (eligibility.category === "cr2-preview") {
    incrementCategory(summary, "eligibleCr2", size);
  } else {
    incrementCategory(summary, "unsupported", size);
  }
};

const scanPreflight = async ({
  bucket,
  region,
  prefix,
  maxObjects,
  pageSize,
  listPage,
}) => {
  if (
    validateSourceBucket(bucket) !== bucket
    || !SUPPORTED_WASABI_REGIONS.has(region)
    || validatePrefix(prefix) !== prefix
    || !Number.isSafeInteger(maxObjects)
    || maxObjects < 1
    || maxObjects > MAX_OBJECTS_LIMIT
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > MAX_PAGE_SIZE
    || typeof listPage !== "function"
  ) {
    throw new Error("invalid-preflight-scan-options");
  }

  const summary = createSummary();
  let continuationToken;
  let previousKey;
  const seenTokens = new Set();

  while (true) {
    const requestedPageSize = Math.min(pageSize, maxObjects - summary.examined);
    const page = await listPage({
      bucket,
      prefix,
      pageSize: requestedPageSize,
      continuationToken,
    });
    if (
      !page
      || typeof page !== "object"
      || typeof page.IsTruncated !== "boolean"
      || (page.Contents !== undefined && !Array.isArray(page.Contents))
      || page.CommonPrefixes !== undefined
      || (
        page.KeyCount !== undefined
        && (!Number.isSafeInteger(page.KeyCount) || page.KeyCount < 0)
      )
      || (!page.IsTruncated && page.NextContinuationToken !== undefined)
    ) {
      throw new Error("invalid-listing-page");
    }
    const objects = page.Contents ?? [];
    if (
      objects.length > requestedPageSize
      || (page.KeyCount !== undefined && page.KeyCount !== objects.length)
      || (page.IsTruncated && objects.length === 0)
    ) {
      throw new Error("invalid-listing-page");
    }

    for (const object of objects) {
      if (
        previousKey !== undefined
        && typeof object?.Key === "string"
        && Buffer.compare(Buffer.from(object.Key), Buffer.from(previousKey)) <= 0
      ) {
        throw new Error("invalid-listing-order");
      }
      classifyObject(object, { bucket, region, prefix }, summary);
      previousKey = object.Key;
    }

    if (!page.IsTruncated) {
      return { ...summary, complete: true, capped: false, cap: maxObjects };
    }
    if (
      typeof page.NextContinuationToken !== "string"
      || !page.NextContinuationToken
      || !page.NextContinuationToken.trim()
      || seenTokens.has(page.NextContinuationToken)
    ) {
      throw new Error("invalid-listing-pagination");
    }
    if (summary.examined >= maxObjects) {
      return { ...summary, complete: false, capped: true, cap: maxObjects };
    }
    seenTokens.add(page.NextContinuationToken);
    continuationToken = page.NextContinuationToken;
  }
};

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_OBJECTS_LIMIT,
  MAX_PAGE_SIZE,
  loadPreflightConfig,
  parseArguments,
  parseBoundedInteger,
  scanPreflight,
  validatePrefix,
  validateScope,
};

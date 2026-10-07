const { getObjectExtension } = require("./inventory");

const DIAGNOSTIC_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jfif",
  "png",
  "webp",
  "heic",
  "gif",
  "nef",
  "cr2",
]);

const normalizeExtension = (extension) => {
  if (typeof extension !== "string") {
    throw new Error("Extensions must be non-empty strings.");
  }
  const normalized = extension.trim().replace(/^\./, "").toLowerCase();
  if (!normalized || normalized.includes("/") || normalized.includes("\\")) {
    throw new Error("Extensions must be non-empty file extensions.");
  }
  return normalized;
};

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const compareObjects = (left, right) =>
  right.sizeBytes - left.sizeBytes
  || compareText(left.bucket, right.bucket)
  || compareText(left.key, right.key);

const collectLocatedObjects = async ({ buckets, prefix, extensions, listPage }) => {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    throw new Error("At least one source bucket is required.");
  }
  if (typeof listPage !== "function") {
    throw new TypeError("A metadata page function is required.");
  }
  if (!Array.isArray(extensions) || extensions.length === 0) {
    throw new Error("At least one extension is required.");
  }

  const requestedExtensions = new Set(extensions.map(normalizeExtension));
  const objects = [];

  for (const bucket of buckets) {
    let ContinuationToken;
    const seenTokens = new Set();
    while (true) {
      const params = { Bucket: bucket };
      if (prefix !== undefined) {
        params.Prefix = prefix;
      }
      if (ContinuationToken !== undefined) {
        params.ContinuationToken = ContinuationToken;
      }

      const page = await listPage(params);
      for (const object of Array.isArray(page?.Contents) ? page.Contents : []) {
        const extension = getObjectExtension(object.Key);
        if (!requestedExtensions.has(extension)) {
          continue;
        }
        if (!Number.isFinite(object.Size) || object.Size < 0) {
          throw new Error("Storage metadata contains an invalid object size.");
        }
        objects.push({
          bucket,
          key: object.Key,
          extension,
          sizeBytes: object.Size,
        });
      }

      const isTruncated = page?.IsTruncated === true;
      const nextToken = isTruncated ? page.NextContinuationToken : undefined;
      if (isTruncated && (typeof nextToken !== "string" || !nextToken.trim())) {
        throw new Error("Storage pagination is truncated without a continuation token.");
      }
      if (!nextToken) {
        break;
      }
      if (seenTokens.has(nextToken)) {
        throw new Error("Storage pagination returned a repeated continuation token.");
      }
      seenTokens.add(nextToken);
      ContinuationToken = nextToken;
    }
  }

  return objects.sort(compareObjects);
};

const formatLocatedObject = (object) => ({
  ...object,
  sizeMiB: Number((object.sizeBytes / (1024 * 1024)).toFixed(2)),
});

const locateByExtensions = async ({ limit, ...options }) => {
  const objects = await collectLocatedObjects(options);
  return {
    mode: "extension",
    extensions: [...new Set(options.extensions.map(normalizeExtension))].sort(),
    matchCount: objects.length,
    returnedCount: Math.min(objects.length, limit),
    objects: objects.slice(0, limit).map(formatLocatedObject),
  };
};

const locateLargestImages = async ({ limit, ...options }) => {
  const objects = await collectLocatedObjects({
    ...options,
    extensions: [...DIAGNOSTIC_IMAGE_EXTENSIONS],
  });
  return {
    mode: "largest-images",
    matchCount: objects.length,
    returnedCount: Math.min(objects.length, limit),
    objects: objects.slice(0, limit).map(formatLocatedObject),
  };
};

module.exports = {
  DIAGNOSTIC_IMAGE_EXTENSIONS,
  collectLocatedObjects,
  locateByExtensions,
  locateLargestImages,
  normalizeExtension,
};
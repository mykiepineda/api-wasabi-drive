const INVENTORY_CANDIDATE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "png",
  "gif",
  "heic",
  "heif",
  "tif",
  "tiff",
  "avif",
]);

const getObjectExtension = (key) => {
  if (typeof key !== "string") {
    return undefined;
  }

  const basename = key.slice(key.lastIndexOf("/") + 1);
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === basename.length - 1) {
    return undefined;
  }

  return basename.slice(dotIndex + 1).toLowerCase();
};

const nearestRankPercentile = (values, percentile) => {
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) {
    throw new RangeError("Percentile must be between 0 and 1.");
  }
  if (values.length === 0) {
    return null;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile * sortedValues.length));
  return sortedValues[rank - 1];
};

const createInventoryAccumulator = (bucketCount) => ({
  bucketCount,
  totalObjects: 0,
  totalBytes: 0,
  zeroByteObjects: 0,
  folderMarkers: 0,
  extensions: new Map(),
  unknownExtensionObjects: 0,
  unknownExtensionBytes: 0,
  candidateImageBytes: [],
  candidateImagesBytes: 0,
  candidateImagesCount: 0,
  missingETags: 0,
});

const addInventoryPage = (accumulator, objects) => {
  for (const object of objects) {
    const size = Number.isFinite(object.Size) && object.Size >= 0 ? object.Size : 0;
    const extension = getObjectExtension(object.Key);

    accumulator.totalObjects += 1;
    accumulator.totalBytes += size;
    if (size === 0) {
      accumulator.zeroByteObjects += 1;
    }
    if (typeof object.Key === "string" && object.Key.endsWith("/")) {
      accumulator.folderMarkers += 1;
    }
    if (typeof object.ETag !== "string" || !object.ETag.trim()) {
      accumulator.missingETags += 1;
    }

    if (extension === undefined) {
      accumulator.unknownExtensionObjects += 1;
      accumulator.unknownExtensionBytes += size;
      continue;
    }

    const extensionTotals = accumulator.extensions.get(extension) ?? { count: 0, bytes: 0 };
    extensionTotals.count += 1;
    extensionTotals.bytes += size;
    accumulator.extensions.set(extension, extensionTotals);

    if (INVENTORY_CANDIDATE_EXTENSIONS.has(extension)) {
      accumulator.candidateImagesCount += 1;
      accumulator.candidateImagesBytes += size;
      accumulator.candidateImageBytes.push(size);
    }
  }
};

const finishInventory = (accumulator) => ({
  bucketCount: accumulator.bucketCount,
  totalObjects: accumulator.totalObjects,
  totalBytes: accumulator.totalBytes,
  zeroByteObjects: accumulator.zeroByteObjects,
  folderMarkers: accumulator.folderMarkers,
  extensions: Object.fromEntries(
    [...accumulator.extensions.entries()].sort(([left], [right]) => left.localeCompare(right)),
  ),
  unknownExtensionObjects: accumulator.unknownExtensionObjects,
  unknownExtensionBytes: accumulator.unknownExtensionBytes,
  candidateImages: {
    count: accumulator.candidateImagesCount,
    bytes: accumulator.candidateImagesBytes,
    p50Bytes: nearestRankPercentile(accumulator.candidateImageBytes, 0.5),
    p90Bytes: nearestRankPercentile(accumulator.candidateImageBytes, 0.9),
    maxBytes: accumulator.candidateImageBytes.length
      ? accumulator.candidateImageBytes.reduce((maximum, size) => Math.max(maximum, size), 0)
      : null,
  },
  missingETags: accumulator.missingETags,
});

const collectInventory = async ({ buckets, prefix, listPage }) => {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    throw new Error("At least one source bucket is required.");
  }
  if (typeof listPage !== "function") {
    throw new TypeError("A metadata page function is required.");
  }

  const accumulator = createInventoryAccumulator(buckets.length);
  for (const Bucket of buckets) {
    let ContinuationToken;
    const seenTokens = new Set();
    while (true) {
      const params = { Bucket };
      if (prefix !== undefined) {
        params.Prefix = prefix;
      }
      if (ContinuationToken !== undefined) {
        params.ContinuationToken = ContinuationToken;
      }

      const page = await listPage(params);
      addInventoryPage(accumulator, Array.isArray(page?.Contents) ? page.Contents : []);
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

  return finishInventory(accumulator);
};

module.exports = {
  INVENTORY_CANDIDATE_EXTENSIONS,
  addInventoryPage,
  collectInventory,
  finishInventory,
  getObjectExtension,
  nearestRankPercentile,
};
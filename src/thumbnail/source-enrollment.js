const { SUPPORTED_WASABI_REGIONS } = require("../storage/wasabi-regions");

const isValidBucketName = (value) =>
  typeof value === "string"
  && value.length >= 3
  && value.length <= 63
  && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value)
  && !value.includes("..")
  && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);

const validateSourceEnrollment = (entries, options = {}) => {
  const stage = typeof options.stage === "string" ? options.stage.trim().toLowerCase() : "";
  if (!["test", "prd"].includes(stage)) {
    throw new Error("Source enrollment requires stage test or prd.");
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Source enrollment must be a nonempty array.");
  }

  const derivedBucket = typeof options.derivedBucket === "string"
    ? options.derivedBucket.trim()
    : "";
  const derivedRegion = typeof options.derivedRegion === "string"
    ? options.derivedRegion.trim()
    : "";
  if (!isValidBucketName(derivedBucket)) {
    throw new Error("Source enrollment requires a valid derived bucket.");
  }
  if (!SUPPORTED_WASABI_REGIONS.has(derivedRegion)) {
    throw new Error("Source enrollment requires a supported derived region.");
  }

  const internalBuckets = new Set(
    Array.isArray(options.internalBuckets)
      ? options.internalBuckets.filter((bucket) => typeof bucket === "string").map((bucket) => bucket.trim())
      : [],
  );
  internalBuckets.add(derivedBucket);

  const excludedBuckets = new Set(
    Array.isArray(options.excludedBuckets)
      ? options.excludedBuckets.filter((bucket) => typeof bucket === "string").map((bucket) => bucket.trim())
      : [],
  );

  const entriesByBucket = new Map();
  const normalizedEntries = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Source enrollment entries must be bucket-region objects.");
    }
    if (Object.keys(entry).some((key) => key !== "bucket" && key !== "region")) {
      throw new Error("Source enrollment entries may contain only bucket and region.");
    }

    const bucket = typeof entry.bucket === "string" ? entry.bucket.trim() : "";
    const region = typeof entry.region === "string" ? entry.region.trim() : "";
    if (!isValidBucketName(bucket) || bucket !== entry.bucket) {
      throw new Error("Source enrollment bucket must be an exact valid bucket name.");
    }
    if (!SUPPORTED_WASABI_REGIONS.has(region)) {
      throw new Error("Source enrollment region is unsupported.");
    }
    if (bucket === derivedBucket) {
      throw new Error("Source enrollment bucket may not be the derived bucket.");
    }
    if (internalBuckets.has(bucket)) {
      throw new Error("Source enrollment bucket may not be internal storage.");
    }
    if (excludedBuckets.has(bucket)) {
      throw new Error("Source enrollment bucket is excluded for this stage.");
    }

    if (entriesByBucket.has(bucket)) {
      const previousRegion = entriesByBucket.get(bucket);
      if (previousRegion !== region) {
        throw new Error("A source bucket may not enroll conflicting regions.");
      }
      throw new Error("Duplicate source enrollment bucket.");
    }
    entriesByBucket.set(bucket, region);
    normalizedEntries.push(Object.freeze({ bucket, region }));
  }

  const frozenEntries = Object.freeze(normalizedEntries);
  const membership = new Map(frozenEntries.map((entry) => [entry.bucket, entry.region]));

  return Object.freeze({
    entries: frozenEntries,
    isEnrolled: (bucket, region) =>
      typeof bucket === "string"
      && typeof region === "string"
      && bucket === bucket.trim()
      && region === region.trim()
      && membership.get(bucket) === region
      && bucket !== derivedBucket,
  });
};

const parseSourceEnrollmentJson = (value, options = {}) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("THUMBNAIL_API_V2_SOURCE_BUCKETS_JSON must be a nonempty JSON array.");
  }

  let entries;
  try {
    entries = JSON.parse(value);
  } catch {
    throw new Error("THUMBNAIL_API_V2_SOURCE_BUCKETS_JSON contains malformed JSON.");
  }

  return validateSourceEnrollment(entries, options);
};

const isSourceEnrolled = (enrollment, bucket, region) =>
  enrollment
  && typeof enrollment.isEnrolled === "function"
  && enrollment.isEnrolled(bucket, region);

module.exports = {
  isValidBucketName,
  validateSourceEnrollment,
  parseSourceEnrollmentJson,
  isSourceEnrolled,
};

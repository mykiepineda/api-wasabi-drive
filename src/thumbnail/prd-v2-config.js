const { validateSourceEnrollment } = require("./source-enrollment");
const { SUPPORTED_WASABI_REGIONS } = require("../storage/wasabi-regions");

const PRD_V2_CONFIG_KEYS = Object.freeze({
  sourceBuckets: "THUMBNAIL_PRD_V2_SOURCE_BUCKETS_JSON",
  excludedBuckets: "THUMBNAIL_PRD_V2_EXCLUDED_BUCKETS_JSON",
  derivedBucket: "THUMBNAIL_PRD_V2_DERIVED_BUCKET",
});

const parseJsonArray = (value, name) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} requires a nonempty JSON array.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} contains malformed JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array.`);
  }
  return parsed;
};

const loadPrdV2Enrollment = (env, options = {}) => {
  const value = env[PRD_V2_CONFIG_KEYS.sourceBuckets];
  if (value === undefined) return null;

  const excludedValue = env[PRD_V2_CONFIG_KEYS.excludedBuckets];
  const derivedBucket = env[PRD_V2_CONFIG_KEYS.derivedBucket];
  if (typeof excludedValue !== "string" || typeof derivedBucket !== "string") {
    throw new Error("invalid-prd-v2-enrollment");
  }

  const entries = parseJsonArray(value, PRD_V2_CONFIG_KEYS.sourceBuckets);
  const excludedBuckets = parseJsonArray(excludedValue, PRD_V2_CONFIG_KEYS.excludedBuckets);
  if (entries.length === 0 || excludedBuckets.length === 0) {
    throw new Error("invalid-prd-v2-enrollment");
  }

  const derivedRegion = options.derivedRegion ?? "ap-southeast-1";
  const enrollment = validateSourceEnrollment(entries, {
    stage: "prd",
    derivedBucket,
    derivedRegion,
    internalBuckets: [derivedBucket],
    excludedBuckets,
  });

  if (!SUPPORTED_WASABI_REGIONS.has(derivedRegion)) {
    throw new Error("invalid-prd-v2-enrollment");
  }
  return Object.freeze({ enrollment, excludedBuckets, derivedBucket, derivedRegion });
};

const validatePrdV2Scope = (scope, prdV2) => {
  if (!prdV2) return;
  if (
    scope.destinationBucket !== prdV2.derivedBucket
    || scope.destinationRegion !== prdV2.derivedRegion
    || !prdV2.enrollment.isEnrolled(scope.sourceBucket, scope.sourceRegion)
  ) {
    throw new Error("invalid-prd-v2-source-enrollment");
  }
};

module.exports = {
  PRD_V2_CONFIG_KEYS,
  loadPrdV2Enrollment,
  validatePrdV2Scope,
};

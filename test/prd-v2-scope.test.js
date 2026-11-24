const test = require("node:test");
const assert = require("node:assert/strict");

const {
  loadPrdV2Enrollment,
  validatePrdV2Scope,
} = require("../src/thumbnail/prd-v2-config");
const { parseArguments: parseBackfillArguments } = require("../src/thumbnail/production-backfill");
const { parseArguments: parsePreflightArguments } = require("../src/thumbnail/production-preflight");

const derivedBucket = "synthetic-private-derived";
const env = {
  THUMBNAIL_PRD_V2_SOURCE_BUCKETS_JSON: JSON.stringify([
    { bucket: "synthetic-source", region: "ap-southeast-2" },
  ]),
  THUMBNAIL_PRD_V2_EXCLUDED_BUCKETS_JSON: JSON.stringify([
    "synthetic-test-bucket",
    "synthetic-ops-bucket",
  ]),
  THUMBNAIL_PRD_V2_DERIVED_BUCKET: derivedBucket,
};

test("PRD v2 opt-in is exact and rejects derived, excluded and wrong-region scopes", () => {
  const loaded = loadPrdV2Enrollment(env);
  assert.equal(loaded.derivedBucket, derivedBucket);
  assert.doesNotThrow(() => validatePrdV2Scope({
    sourceBucket: "synthetic-source",
    sourceRegion: "ap-southeast-2",
    destinationBucket: derivedBucket,
    destinationRegion: "ap-southeast-1",
  }, loaded));
  for (const scope of [
    { sourceBucket: "synthetic-source", sourceRegion: "ap-northeast-1" },
    { sourceBucket: "synthetic-test-bucket", sourceRegion: "ap-southeast-2" },
    { sourceBucket: derivedBucket, sourceRegion: "ap-southeast-2" },
  ]) {
    assert.throws(() => validatePrdV2Scope({
      ...scope,
      destinationBucket: derivedBucket,
      destinationRegion: "ap-southeast-1",
    }, loaded));
  }
});

test("opt-in JSON rejects malformed, empty, duplicate and excluded settings", () => {
  for (const overrides of [
    { THUMBNAIL_PRD_V2_SOURCE_BUCKETS_JSON: "" },
    { THUMBNAIL_PRD_V2_SOURCE_BUCKETS_JSON: "{bad" },
    { THUMBNAIL_PRD_V2_SOURCE_BUCKETS_JSON: "[]" },
    { THUMBNAIL_PRD_V2_EXCLUDED_BUCKETS_JSON: "[]" },
    { THUMBNAIL_PRD_V2_EXCLUDED_BUCKETS_JSON: "{bad" },
  ]) {
    assert.throws(() => loadPrdV2Enrollment({ ...env, ...overrides }));
  }
  assert.throws(() => loadPrdV2Enrollment({
    ...env,
    THUMBNAIL_PRD_V2_EXCLUDED_BUCKETS_JSON: JSON.stringify(["synthetic-source"]),
  }));
});

test("backfill and preflight require one unambiguous root or prefix selector", () => {
  const base = [
    "--source-bucket", "synthetic-source",
    "--source-region", "ap-southeast-2",
    "--max-objects", "10",
  ];
  for (const parse of [parseBackfillArguments, parsePreflightArguments]) {
    assert.throws(() => parse(base));
    assert.throws(() => parse([...base, "--prefix", "", "--recipe", "v2"]));
    assert.throws(() => parse([...base, "--prefix", "photos/", "--whole-bucket", "--recipe", "v2"]));
    assert.throws(() => parse([...base, "--whole-bucket"]));
  }
  assert.deepEqual(parseBackfillArguments([
    ...base, "--whole-bucket", "--recipe", "v2",
  ]).prefix, "");
  assert.deepEqual(parsePreflightArguments([
    ...base, "--prefix", "photos/2026/", "--recipe", "v2",
  ]).prefix, "photos/2026/");
});

test("opt-in folder prefixes require slash termination and root requires whole-bucket", () => {
  const loaded = loadPrdV2Enrollment(env);
  const { validateOptInV2Prefix } = require("../src/thumbnail/preflight-scope");
  for (const prefix of [
    "photos",
    "photos-old",
    "/photos/",
    "photos//",
    "photos/../",
    "photos/./",
    " ",
  ]) {
    assert.throws(() => validateOptInV2Prefix(prefix, false));
  }
  assert.throws(() => validateOptInV2Prefix("photos/", true));
  assert.throws(() => validateOptInV2Prefix("", false));
  assert.doesNotThrow(() => validateOptInV2Prefix("", true));
  assert.doesNotThrow(() => validateOptInV2Prefix("photos/2026/", false));

  const scopeConfig = {
    destinationBucket: derivedBucket,
    destinationRegion: "ap-southeast-1",
    prdV2: loaded,
  };
  const { validateScope } = require("../src/thumbnail/preflight-scope");
  for (const options of [
    { recipeId: "v2", sourceBucket: "synthetic-source", sourceRegion: "ap-southeast-2", prefix: "photos", wholeBucket: false },
    { recipeId: "v2", sourceBucket: "synthetic-source", sourceRegion: "ap-southeast-2", prefix: "", wholeBucket: false },
    { recipeId: "v2", sourceBucket: "synthetic-source", sourceRegion: "ap-southeast-2", prefix: "photos/", wholeBucket: true },
  ]) {
    assert.throws(() => validateScope(options, { ...scopeConfig, prdV2: loaded }));
  }
  assert.doesNotThrow(() => validateScope({
    recipeId: "v2",
    sourceBucket: "synthetic-source",
    sourceRegion: "ap-southeast-2",
    prefix: "photos/2026/",
    wholeBucket: false,
  }, { ...scopeConfig, prdV2: loaded }));
  assert.doesNotThrow(() => validateScope({
    recipeId: "v2",
    sourceBucket: "synthetic-source",
    sourceRegion: "ap-southeast-2",
    prefix: "",
    wholeBucket: true,
  }, { ...scopeConfig, prdV2: loaded }));
});

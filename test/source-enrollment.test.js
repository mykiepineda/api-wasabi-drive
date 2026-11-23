const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateSourceEnrollment,
  parseSourceEnrollmentJson,
  isSourceEnrolled,
} = require("../src/thumbnail/source-enrollment");

const baseOptions = {
  stage: "test",
  derivedBucket: "internal-derived",
  derivedRegion: "ap-southeast-1",
  internalBuckets: ["internal-derived", "internal-ops"],
  excludedBuckets: [],
};

test("pure validator accepts exact multi-bucket and exact region membership", () => {
  const enrollment = validateSourceEnrollment([
    { bucket: "synthetic-photos", region: "ap-southeast-2" },
    { bucket: "synthetic-other", region: "us-east-2" },
  ], baseOptions);

  assert.equal(isSourceEnrolled(enrollment, "synthetic-photos", "ap-southeast-2"), true);
  assert.equal(isSourceEnrolled(enrollment, "synthetic-photos", "us-east-2"), false);
  assert.equal(isSourceEnrolled(enrollment, "synthetic", "ap-southeast-2"), false);
});

test("pure validator rejects duplicates, region conflicts, malformed entries and unsupported values", () => {
  assert.throws(() => validateSourceEnrollment([
    { bucket: "synthetic-photos", region: "ap-southeast-2" },
    { bucket: "synthetic-photos", region: "ap-southeast-2" },
  ], baseOptions), /Duplicate source enrollment bucket/);

  assert.throws(() => validateSourceEnrollment([
    { bucket: "synthetic-photos", region: "ap-southeast-2" },
    { bucket: "synthetic-photos", region: "us-east-2" },
  ], baseOptions), /conflicting regions/);

  for (const entries of [
    [],
    null,
    [{ bucket: "UPPERCASE", region: "ap-southeast-2" }],
    [{ bucket: "synthetic-photos", region: "invalid-region" }],
    [{ bucket: "synthetic-photos", region: "ap-southeast-2", prefix: "photos/" }],
  ]) {
    assert.throws(() => validateSourceEnrollment(entries, baseOptions));
  }
});

test("pure validator rejects internal derived buckets and stage exclusions but allows same-region distinct buckets", () => {
  assert.throws(() => validateSourceEnrollment([
    { bucket: "internal-derived", region: "ap-southeast-2" },
  ], baseOptions), /derived bucket|internal storage/);
  assert.throws(() => validateSourceEnrollment([
    { bucket: "internal-ops", region: "us-east-1" },
  ], baseOptions), /internal storage/);
  assert.throws(() => validateSourceEnrollment([
    { bucket: "protected-test-source", region: "us-east-1" },
  ], { ...baseOptions, stage: "prd", excludedBuckets: ["protected-test-source"] }), /excluded/);

  const testEnrollment = validateSourceEnrollment([
    { bucket: "approved-test-source", region: "us-east-1" },
  ], { ...baseOptions, excludedBuckets: ["protected-test-source"] });
  assert.equal(isSourceEnrolled(testEnrollment, "approved-test-source", "us-east-1"), true);

  const sameRegion = validateSourceEnrollment([
    { bucket: "synthetic-source", region: "ap-southeast-1" },
  ], baseOptions);
  assert.equal(isSourceEnrolled(sameRegion, "synthetic-source", "ap-southeast-1"), true);
});

test("malformed, empty and stage-mismatched JSON enrollment fails closed", () => {
  assert.throws(() => parseSourceEnrollmentJson("{bad", baseOptions), /malformed JSON/);
  assert.throws(() => parseSourceEnrollmentJson("", baseOptions), /nonempty JSON array/);
  assert.throws(() => parseSourceEnrollmentJson("[]", baseOptions), /nonempty array/);
  assert.throws(() => parseSourceEnrollmentJson(
    '[{"bucket":"synthetic-photos","region":"ap-southeast-2"}]',
    { ...baseOptions, stage: "other" },
  ), /stage test or prd/);
});

test("malformed supplied internal and excluded bucket lists fail closed", () => {
  for (const malformed of [null, "synthetic-bucket", {}, 123]) {
    assert.throws(() => validateSourceEnrollment([
      { bucket: "synthetic-photos", region: "ap-southeast-2" },
    ], { ...baseOptions, internalBuckets: malformed }), /array or Set/);
    assert.throws(() => validateSourceEnrollment([
      { bucket: "synthetic-photos", region: "ap-southeast-2" },
    ], { ...baseOptions, excludedBuckets: malformed }), /array or Set/);
  }

  assert.throws(() => validateSourceEnrollment([
    { bucket: "synthetic-photos", region: "ap-southeast-2" },
  ], { ...baseOptions, excludedBuckets: ["BAD_NAME"] }), /invalid exact bucket name/);
  assert.throws(() => validateSourceEnrollment([
    { bucket: "synthetic-photos", region: "ap-southeast-2" },
  ], { ...baseOptions, excludedBuckets: ["synthetic-ops", "synthetic-ops"] }), /duplicate bucket name/);

  const setEnrollment = validateSourceEnrollment([
    { bucket: "synthetic-photos", region: "ap-southeast-2" },
  ], {
    ...baseOptions,
    internalBuckets: new Set(["internal-one"]),
    excludedBuckets: new Set(["synthetic-protected"]),
  });
  assert.equal(isSourceEnrolled(setEnrollment, "synthetic-photos", "ap-southeast-2"), true);
  assert.throws(() => validateSourceEnrollment([
    { bucket: "synthetic-photos", region: "ap-southeast-2" },
  ], null), /options must be an object/);
});

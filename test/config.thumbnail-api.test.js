const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const allowedKey = `v1/ab/${"ab"}${"0".repeat(62)}.webp`;

const baseEnvironment = (overrides = {}) => ({
  ENTRA_TENANT_ID: "11111111-2222-4222-8aaa-555555666666",
  ENTRA_API_CLIENT_ID: "synthetic-api-client",
  ENTRA_REQUIRED_SCOPE: "WasabiDrive.Access",
  ENTRA_TRUSTED_USER_OBJECT_IDS: "11111111-2222-4222-8aaa-555555666666",
  WASABI_ACCESS_KEY_ID: "synthetic-original-access",
  WASABI_SECRET_ACCESS_KEY: "synthetic-original-secret",
  DEPLOYMENT_STAGE: "test",
  WASABI_INTERNAL_BUCKETS: "internal-derived",
  THUMBNAIL_API_ENABLED: "false",
  ...overrides,
});

const enabledEnvironment = (overrides = {}) => baseEnvironment({
  THUMBNAIL_API_ENABLED: "true",
  THUMBNAIL_API_SOURCE_BUCKET: "synthetic-source",
  THUMBNAIL_API_SOURCE_REGION: "ap-southeast-2",
  THUMBNAIL_API_SOURCE_PREFIX: "synthetic/photos/",
  THUMBNAIL_API_DERIVED_BUCKET: "internal-derived",
  THUMBNAIL_API_DERIVED_REGION: "ap-southeast-1",
  THUMBNAIL_API_ALLOWED_KEYS: allowedKey,
  THUMBNAIL_API_READ_ACCESS_KEY_ID: "synthetic-derived-read",
  THUMBNAIL_API_READ_SECRET_ACCESS_KEY: "synthetic-derived-secret",
  THUMBNAIL_API_URL_TTL_SECONDS: "3600",
  ...overrides,
});

const loadConfig = (environment) => {
  const script = "const config = require('./src/config'); process.stdout.write(JSON.stringify({ stage: config.stage, enabled: config.thumbnailApi.enabled, internalCount: config.wasabi.internalBucketSet.size }));";
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: {
      PATH: path.dirname(process.execPath),
      SystemRoot: process.env.SystemRoot,
      ...environment,
    },
  });

  return result;
};

const assertConfigRejects = (environment) => {
  const result = loadConfig(environment);
  assert.notEqual(result.status, 0);
};

test("thumbnail enrichment is disabled without optional credentials and internal protection remains configured", () => {
  const result = loadConfig(baseEnvironment());

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    stage: "test",
    enabled: false,
    internalCount: 1,
  });
});

test("local disabled configuration permits an absent stage and internal list", () => {
  const environment = baseEnvironment();
  delete environment.DEPLOYMENT_STAGE;
  delete environment.WASABI_INTERNAL_BUCKETS;

  const result = loadConfig(environment);
  assert.equal(result.status, 0, result.stderr);
});

test("absent or empty enablement remains disabled with empty optional thumbnail values", () => {
  for (const enabledValue of [undefined, ""]) {
    const environment = baseEnvironment({
      THUMBNAIL_API_SOURCE_BUCKET: "",
      THUMBNAIL_API_SOURCE_PREFIX: "",
      THUMBNAIL_API_ALLOWED_KEYS: "",
      THUMBNAIL_API_READ_ACCESS_KEY_ID: "",
      THUMBNAIL_API_READ_SECRET_ACCESS_KEY: "",
    });
    if (enabledValue === undefined) {
      delete environment.THUMBNAIL_API_ENABLED;
    } else {
      environment.THUMBNAIL_API_ENABLED = enabledValue;
    }

    const result = loadConfig(environment);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).enabled, false);
  }
});

test("deployed stages require valid internal bucket protection even while thumbnails are disabled", () => {
  for (const value of [undefined, "", "bad/name", "internal-derived,*", "internal-derived,internal-derived"]) {
    const environment = baseEnvironment();
    if (value === undefined) {
      delete environment.WASABI_INTERNAL_BUCKETS;
    } else {
      environment.WASABI_INTERNAL_BUCKETS = value;
    }
    assertConfigRejects(environment);
  }
});

test("enabled config accepts a valid exact allowlist, scoped source and Singapore destination", () => {
  const result = loadConfig(enabledEnvironment());
  assert.equal(result.status, 0, result.stderr);
});

test("enabled PRD configuration requires the Tokyo source and Singapore destination", () => {
  const result = loadConfig(enabledEnvironment({
    DEPLOYMENT_STAGE: "prd",
    THUMBNAIL_API_SOURCE_BUCKET: "synthetic-prd-source",
    THUMBNAIL_API_SOURCE_REGION: "ap-northeast-1",
  }));
  assert.equal(result.status, 0, result.stderr);
});

test("enabled config rejects malformed booleans, TTLs, shards, missing keys, duplicates and excess keys", () => {
  for (const invalid of [
    { THUMBNAIL_API_ENABLED: "yes" },
    { THUMBNAIL_API_URL_TTL_SECONDS: "3600junk" },
    { THUMBNAIL_API_URL_TTL_SECONDS: "59" },
    { THUMBNAIL_API_ALLOWED_KEYS: `v1/aa/${"00"}${"0".repeat(62)}.webp` },
    { THUMBNAIL_API_ALLOWED_KEYS: "" },
    { THUMBNAIL_API_ALLOWED_KEYS: `${allowedKey},${allowedKey.toUpperCase()}` },
    {
      THUMBNAIL_API_ALLOWED_KEYS: Array.from({ length: 14 }, (_, index) =>
        `v1/${index.toString(16).padStart(2, "0")}/${index.toString(16).padStart(2, "0")}${"0".repeat(62)}.webp`,
      ).join(","),
    },
  ]) {
    assertConfigRejects(enabledEnvironment(invalid));
  }
});

test("enabled config rejects missing scope, credential reuse and unexpected stage-region combinations", () => {
  for (const invalid of [
    { THUMBNAIL_API_SOURCE_PREFIX: "" },
    { THUMBNAIL_API_SOURCE_PREFIX: "synthetic/photos" },
    { THUMBNAIL_API_SOURCE_BUCKET: "" },
    { THUMBNAIL_API_READ_ACCESS_KEY_ID: "synthetic-original-access" },
    { DEPLOYMENT_STAGE: "local" },
    { THUMBNAIL_API_SOURCE_REGION: "ap-northeast-1" },
    { DEPLOYMENT_STAGE: "prd", THUMBNAIL_API_SOURCE_REGION: "ap-southeast-2" },
    { THUMBNAIL_API_DERIVED_REGION: "ap-southeast-2" },
    { THUMBNAIL_API_SOURCE_REGION: "ap-southeast-1" },
  ]) {
    assertConfigRejects(enabledEnvironment(invalid));
  }
});

test("enabled config requires its derived bucket in the internal bucket set", () => {
  assertConfigRejects(enabledEnvironment({ WASABI_INTERNAL_BUCKETS: "another-internal" }));
});

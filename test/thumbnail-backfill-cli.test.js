const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const {
  loadBackfillConfig,
  main,
  parseArguments,
} = require("../scripts/thumbnail-backfill-test");

const env = (overrides = {}) => ({
  THUMBNAIL_PILOT_STAGE: "test",
  THUMBNAIL_TEST_SOURCE_BUCKET: "wasabi-test-source",
  THUMBNAIL_TEST_DERIVED_BUCKET: "wasabi-test-derived",
  THUMBNAIL_TEST_DERIVED_REGION: "ap-southeast-1",
  THUMBNAIL_TEST_WASABI_ACCESS_KEY_ID: "test-access",
  THUMBNAIL_TEST_WASABI_SECRET_ACCESS_KEY: "test-secret",
  ...overrides,
});
const cliArgs = (extra = []) => [
  "--source-bucket", "wasabi-test-source",
  "--source-region", "ap-southeast-2",
  "--prefix", "pilot/",
  "--max-objects", "10",
  ...extra,
];
const collectOutput = () => {
  const output = [];
  return { output, write: (line) => output.push(line) };
};

test("CLI requires explicit selection and the paired execution confirmations", () => {
  assert.throws(() => parseArguments([]), { message: "invalid-arguments" });
  assert.throws(() => parseArguments(cliArgs(["--execute"])), { message: "invalid-arguments" });
  assert.throws(() => parseArguments(cliArgs(["--confirm-test-backfill"])), { message: "invalid-arguments" });
  assert.throws(() => parseArguments(cliArgs(["--stage", "prd"])), { message: "invalid-arguments" });
  assert.throws(() => parseArguments(cliArgs(["--source-bucket", "wasabi-test-source"])), { message: "invalid-arguments" });
  assert.deepEqual(parseArguments(cliArgs()), {
    sourceBucket: "wasabi-test-source",
    sourceRegion: "ap-southeast-2",
    prefix: "pilot/",
    maxObjects: "10",
    pageSize: undefined,
    checkpoint: undefined,
    execute: false,
  });
});

test("TEST configuration rejects non-TEST stage, production buckets, or non-Singapore destination", () => {
  assert.throws(() => loadBackfillConfig(env({ THUMBNAIL_PILOT_STAGE: "prd" })));
  assert.throws(() => loadBackfillConfig(env({ DEPLOYMENT_STAGE: "prd" })));
  assert.throws(() => loadBackfillConfig(env({ NODE_ENV: "production" })));
  assert.throws(() => loadBackfillConfig(env({ THUMBNAIL_TEST_SOURCE_BUCKET: "wasabi-prd-source" })));
  assert.throws(() => loadBackfillConfig(env({ THUMBNAIL_TEST_DERIVED_REGION: "ap-southeast-2" })));
  assert.equal(loadBackfillConfig(env()).destinationRegion, "ap-southeast-1");
});

test("default CLI mode is dry-run and prints only the allowlisted aggregate summary", async () => {
  const { output, write } = collectOutput();
  let storageCreated = false;
  let scanParams;
  const exitCode = await main(cliArgs(), {
    env: env(),
    write,
    createStorage: () => {
      storageCreated = true;
      return {};
    },
    runScan: async (params) => {
      scanParams = params;
      return {
        category: "dry-run",
        examined: 2,
        generated: 0,
        alreadyPresent: 1,
        unsupported: 1,
        oversize: 0,
        failed: 0,
        privateKey: "pilot/private.jpg",
        checkpointContents: "sensitive",
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(storageCreated, true);
  assert.equal(scanParams.dryRun, true);
  assert.equal(scanParams.checkpointPath, undefined);
  assert.deepEqual(JSON.parse(output[0]), {
    category: "dry-run",
    examined: 2,
    generated: 0,
    alreadyPresent: 1,
    unsupported: 1,
    oversize: 0,
    failed: 0,
  });
  assert.equal(output[0].includes("private.jpg"), false);
  assert.equal(output[0].includes("sensitive"), false);
});

test("live CLI requires an absolute checkpoint and passes paired confirmations only to TEST scope", async () => {
  const checkpoint = path.join(os.tmpdir(), "thumbnail-backfill-checkpoint.json");
  let scanParams;
  const { output, write } = collectOutput();
  const exitCode = await main(cliArgs([
    "--checkpoint", checkpoint,
    "--execute",
    "--confirm-test-backfill",
  ]), {
    env: env(),
    write,
    createStorage: () => ({}),
    runScan: async (params) => {
      scanParams = params;
      return {
        category: "paused-cap",
        examined: 10,
        generated: 2,
        alreadyPresent: 3,
        unsupported: 5,
        oversize: 0,
        failed: 0,
      };
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(scanParams.dryRun, false);
  assert.equal(scanParams.checkpointPath, checkpoint);
  assert.equal(scanParams.destinationRegion, "ap-southeast-1");
  assert.equal(JSON.parse(output[0]).category, "paused-cap");

  const missingCheckpointOutput = collectOutput();
  assert.equal(await main(cliArgs(["--execute", "--confirm-test-backfill"]), {
    env: env(),
    write: missingCheckpointOutput.write,
    createStorage: () => {
      throw new Error("must not create storage");
    },
  }), 1);
  assert.equal(JSON.parse(missingCheckpointOutput.output[0]).category, "failed");
});

test("invalid bucket, prefix, bounds, and stage fail with sanitized nonzero summaries", async (t) => {
  const attempts = [
    ["wrong source", cliArgs(["--source-bucket", "another-test-source"])],
    ["wrong prefix", cliArgs(["--prefix", "personal/"])],
    ["prefix traversal", cliArgs(["--prefix", "pilot/../other/"])],
    ["zero limit", cliArgs(["--max-objects", "0"])],
    ["unbounded limit", cliArgs(["--max-objects", "11"])],
    ["production stage", cliArgs(), env({ THUMBNAIL_PILOT_STAGE: "prd" })],
  ];
  for (const [name, args, testEnv = env()] of attempts) {
    await t.test(name, async () => {
      const { output, write } = collectOutput();
      let scanCalled = false;
      const exitCode = await main(args, {
        env: testEnv,
        write,
        createStorage: () => ({}),
        runScan: async () => {
          scanCalled = true;
          return { category: "completed" };
        },
      });
      assert.equal(exitCode, 1);
      assert.equal(scanCalled, false);
      assert.equal(JSON.parse(output[0]).category, "failed");
    });
  }
});

test("failed scan outcomes return nonzero without exposing failure details", async () => {
  const { output, write } = collectOutput();
  const exitCode = await main(cliArgs(), {
    env: env(),
    write,
    createStorage: () => ({}),
    runScan: async () => ({
      category: "failed",
      examined: 1,
      failed: 1,
      stopReason: "private key and bucket",
    }),
  });
  assert.equal(exitCode, 1);
  assert.equal(output[0].includes("private"), false);
});

test("nonzero failure counts cannot exit successfully under a paused or completed category", async (t) => {
  for (const category of ["paused-cap", "completed"]) {
    await t.test(category, async () => {
      const { output, write } = collectOutput();
      const exitCode = await main(cliArgs(), {
        env: env(),
        write,
        createStorage: () => ({}),
        runScan: async () => ({
          category,
          examined: 1,
          generated: 1,
          alreadyPresent: 0,
          unsupported: 0,
          oversize: 0,
          failed: 1,
        }),
      });
      assert.equal(exitCode, 1);
      assert.equal(JSON.parse(output[0]).failed, 1);
    });
  }
});

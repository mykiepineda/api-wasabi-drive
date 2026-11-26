const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  acquireWriterLock,
  appendAuditRecord,
  buildCheckpoint,
  recipeStatePaths,
  releaseWriterLock,
  runProductionBackfill,
  validateStatePaths,
  writeCheckpointAtomically,
} = require("../src/thumbnail/production-backfill");
const {
  main,
  parseArguments,
  runCampaign,
  validateCampaignPlan,
} = require("../src/thumbnail/production-backfill-campaign");
const { main: backfillCliMain } = require("../scripts/thumbnail-backfill-prd");

const temporaryRoots = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wasabi-campaign-test-"));
  temporaryRoots.push(root);
  if (process.platform !== "win32") fs.chmodSync(root, 0o700);
  return root;
};
test.afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const sourceEntries = [
  { bucket: "approved-photo-library", region: "ap-southeast-2" },
  { bucket: "approved-tokyo-pilot", region: "ap-northeast-1" },
];
const env = () => ({
  THUMBNAIL_PRD_BACKFILL_STAGE: "prd",
  THUMBNAIL_PRD_BACKFILL_DERIVED_BUCKET: "private-derived-library",
  THUMBNAIL_PRD_BACKFILL_DERIVED_REGION: "ap-southeast-1",
  THUMBNAIL_PRD_BACKFILL_WASABI_ACCESS_KEY_ID: "private-access-value",
  THUMBNAIL_PRD_BACKFILL_WASABI_SECRET_ACCESS_KEY: "private-secret-value",
  THUMBNAIL_PRD_V2_SOURCE_BUCKETS_JSON: JSON.stringify(sourceEntries),
  THUMBNAIL_PRD_V2_EXCLUDED_BUCKETS_JSON: JSON.stringify([
    "protected-ops-library",
    "protected-test-library",
  ]),
  THUMBNAIL_PRD_V2_DERIVED_BUCKET: "private-derived-library",
});
const validatePlanFile = (target) => {
  const metadata = fs.lstatSync(target);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  assert.equal(metadata.nlink, 1);
  return path.resolve(target);
};
const validatePaths = (paths) => validateStatePaths({
  ...paths,
  assertPrivatePathImpl: () => {},
});
const writePlan = (root, plan) => {
  const planPath = path.join(root, "campaign-plan.json");
  fs.writeFileSync(planPath, JSON.stringify(plan), { mode: 0o600 });
  return planPath;
};
const baseJob = (root, {
  sourceBucket = sourceEntries[0].bucket,
  sourceRegion = sourceEntries[0].region,
  prefix = "photos/2026/",
  index = 1,
  ...overrides
} = {}) => ({
  sourceBucket,
  sourceRegion,
  prefix,
  checkpointPath: path.join(root, `job-${index}.checkpoint.json`),
  auditPath: path.join(root, `job-${index}.audit.jsonl`),
  checkpointBackupPath: path.join(root, `job-${index}.checkpoint-backup.json`),
  auditBackupPath: path.join(root, `job-${index}.audit-backup.jsonl`),
  batchLimit: 2,
  ...overrides,
});
const basePlan = (root, jobs = [baseJob(root)]) => ({
  version: 1,
  stage: "prd",
  recipe: "v2",
  maxSlices: 10,
  jobs,
});
const validate = (root, plan, options = {}) => {
  const planPath = options.planPath ?? writePlan(root, plan);
  return validateCampaignPlan({
    plan,
    planPath,
    env: options.env ?? env(),
    stateRoot: root,
    validatePlanFile,
    validatePaths,
  });
};
const outputCollector = () => {
  const output = [];
  return { output, write: (line) => output.push(line) };
};
const summaryLine = (category, counts = {}) => JSON.stringify({
  category,
  examined: 0,
  generated: 0,
  alreadyPresent: 0,
  unsupported: 0,
  oversize: 0,
  failed: 0,
  ...counts,
});
const checkpointFor = (job, key) => {
  const versioned = recipeStatePaths({
    recipeId: "v2",
    checkpointPath: job.basePaths.checkpointPath,
    auditPath: job.basePaths.auditPath,
  });
  writeCheckpointAtomically(
    versioned.checkpointPath,
    buildCheckpoint(job.scope, key, "v2"),
    () => {},
  );
};
const executeCampaign = async (campaign, runSlice, extra = {}) => runCampaign({
  campaign,
  env: env(),
  runSlice,
  assertPrivatePathImpl: () => {},
  ...extra,
});
const runActualCliSlice = async (args, { env: prdEnv, root, storage }) => {
  const output = [];
  const exitCode = await backfillCliMain(args, {
    env: prdEnv,
    platform: "linux",
    assertPrivatePathImpl: () => {},
    write: (line) => output.push(line),
    createStorage: () => storage,
    runScan: (options) => runProductionBackfill({
      ...options,
      platform: "linux",
      assertPrivatePathImpl: () => {},
      saveCheckpoint: (checkpointPath, checkpoint) =>
        writeCheckpointAtomically(checkpointPath, checkpoint, () => {}),
      appendAudit: (auditPath, record) => appendAuditRecord(auditPath, record, {
        assertPrivatePath: () => {},
        syncDirectory: () => {},
      }),
      acquireLock: () => acquireWriterLock({
        lockPath: path.join(root, "campaign-test.lock"),
        syncDirectoryImpl: () => {},
        assertPrivatePathImpl: () => {},
      }),
      releaseLock: releaseWriterLock,
    }),
  });
  return { exitCode, output };
};

test("campaign CLI requires the paired execution gate and rejects unknown arguments", () => {
  assert.throws(() => parseArguments([]), { message: "invalid-arguments" });
  assert.throws(() => parseArguments(["--plan", "C:\\state\\plan.json", "--execute-campaign"]), {
    message: "invalid-arguments",
  });
  assert.throws(() => parseArguments(["--plan", "C:\\state\\plan.json", "--confirm-prd-campaign"]), {
    message: "invalid-arguments",
  });
  assert.throws(() => parseArguments([
    "--plan", "C:\\state\\plan.json",
    "--execute-campaign",
    "--confirm-prd-campaign",
    "--unexpected",
  ]), { message: "invalid-arguments" });
  assert.deepEqual(parseArguments([
    "--plan", "C:\\state\\plan.json",
    "--execute-campaign",
    "--confirm-prd-campaign",
  ]), {
    planPath: "C:\\state\\plan.json",
    execute: true,
  });
});

test("validation-only is the default and does not invoke any storage-backed slice", async () => {
  const root = makeRoot();
  const plan = basePlan(root);
  const planPath = writePlan(root, plan);
  let sliceCalls = 0;
  const { output, write } = outputCollector();
  const result = await main(["--plan", planPath], {
    env: env(),
    stateRoot: root,
    validatePlanFile,
    validatePaths,
    write,
    runSlice: async () => {
      sliceCalls += 1;
      throw new Error("storage must not be reached");
    },
  });
  assert.equal(result, 0);
  assert.equal(sliceCalls, 0);
  assert.deepEqual(JSON.parse(output[0]), {
    category: "validated",
    jobs: 1,
    maxSlices: 10,
  });
});

test("strict plan validation rejects invalid stage, recipe, fields, selectors and limits before a slice", () => {
  const root = makeRoot();
  const invalidPlans = [
    { ...basePlan(root), stage: "test" },
    { ...basePlan(root), recipe: "v1" },
    { ...basePlan(root), destinationBucket: "injected-destination" },
    { ...basePlan(root), accessKeyId: "injected-credential" },
    { ...basePlan(root), jobs: [baseJob(root, { unexpected: "private" })] },
    { ...basePlan(root), jobs: [baseJob(root, { prefix: "" })] },
    { ...basePlan(root), jobs: [baseJob(root, { prefix: "photos/*/" })] },
    { ...basePlan(root), jobs: [baseJob(root, { prefix: undefined, wholeBucket: false })] },
    { ...basePlan(root), jobs: [baseJob(root, { wholeBucket: true })] },
    { ...basePlan(root), jobs: [baseJob(root, { batchLimit: 251 })] },
    { ...basePlan(root), jobs: [baseJob(root, { pageSize: 11 })] },
    { ...basePlan(root), maxSlices: 0 },
  ];
  for (const plan of invalidPlans) {
    assert.throws(() => validate(root, plan));
  }
  const rootJob = baseJob(root);
  delete rootJob.prefix;
  rootJob.wholeBucket = true;
  assert.doesNotThrow(() => validate(root, basePlan(root, [rootJob])));
});

test("source enrollment, region, protected buckets, root selection and path privacy fail closed", () => {
  const root = makeRoot();
  const invalidJobs = [
    baseJob(root, { sourceBucket: "unapproved-library" }),
    baseJob(root, { sourceRegion: "ap-southeast-1" }),
    baseJob(root, { sourceBucket: "protected-ops-library" }),
    baseJob(root, { sourceBucket: "protected-test-library" }),
    baseJob(root, { sourceBucket: "private-derived-library" }),
    baseJob(root, { sourceBucket: "approved-test-library" }),
    baseJob(root, { prefix: undefined, wholeBucket: false }),
    baseJob(root, { checkpointPath: "relative-checkpoint.json" }),
    baseJob(root, {
      checkpointPath: path.join(path.dirname(root), "outside-checkpoint.json"),
    }),
  ];
  for (const job of invalidJobs) {
    assert.throws(() => validate(root, basePlan(root, [job])));
  }
});

test("duplicate scopes and state collisions after v2 suffix resolution are rejected", () => {
  const root = makeRoot();
  const first = baseJob(root, { index: 1 });
  const duplicate = baseJob(root, { index: 2 });
  assert.throws(() => validate(root, basePlan(root, [first, duplicate])));

  const differentScope = baseJob(root, {
    index: 2,
    sourceBucket: sourceEntries[1].bucket,
    sourceRegion: sourceEntries[1].region,
    prefix: "pilot/",
    auditPath: first.checkpointPath,
  });
  assert.throws(() => validate(root, basePlan(root, [first, differentScope])));
});

test("campaign progresses sequentially across bounded slices and reconciles sanitized counts", async () => {
  const root = makeRoot();
  const plan = basePlan(root, [
    baseJob(root, { index: 1 }),
    baseJob(root, {
      index: 2,
      sourceBucket: sourceEntries[1].bucket,
      sourceRegion: sourceEntries[1].region,
      prefix: "pilot/",
    }),
  ]);
  const campaign = validate(root, plan);
  const calls = [];
  const outcomes = [
    ["paused-cap", { examined: 2, generated: 2 }, "photos/2026/b.jpg"],
    ["completed", { examined: 1, alreadyPresent: 1 }, "photos/2026/c.jpg"],
    ["completed", { examined: 1, alreadyPresent: 1 }, "pilot/a.jpg"],
  ];
  const result = await executeCampaign(campaign, async (args, { jobIndex, sliceIndex }) => {
    calls.push({ args, jobIndex, sliceIndex });
    const [category, counts, cursor] = outcomes.shift();
    checkpointFor(campaign.jobs[jobIndex - 1], cursor);
    return { exitCode: 0, output: [summaryLine(category, counts)] };
  });

  assert.equal(result.category, "completed");
  assert.equal(result.slices, 3);
  assert.deepEqual(calls.map((call) => [call.jobIndex, call.sliceIndex]), [[1, 1], [1, 2], [2, 3]]);
  assert.equal(calls.every(({ args }) =>
    args.includes("--recipe") && args[args.indexOf("--recipe") + 1] === "v2"
    && args.includes("--execute")
    && args.includes("--confirm-prd-backfill")
    && !args.includes("--recipe-v1")), true);
  assert.equal(calls.every(({ args }) => args[args.indexOf("--max-objects") + 1] === "2"), true);
  assert.equal(calls.every(({ args }) => args[args.indexOf("--page-size") + 1] === "5"), true);
  assert.deepEqual(result.jobs.map((job) => job.category), ["completed", "completed"]);
  assert.deepEqual(result.jobs.map((job) => job.scanState), [
    "started-new-scan",
    "started-new-scan",
  ]);
  assert.equal(result.jobs[1].alreadyPresent, 1);
  assert.equal(result.totals.examined, 4);
  assert.equal(result.totals.generated + result.totals.alreadyPresent, 4);
  assert.notEqual(campaign.jobs[0].scopeId, campaign.jobs[1].scopeId);
  assert.notEqual(campaign.jobs[0].paths.checkpointPath, campaign.jobs[1].paths.checkpointPath);
  assert.notEqual(campaign.jobs[0].paths.auditPath, campaign.jobs[1].paths.auditPath);
  assert.equal(calls[2].args[calls[2].args.indexOf("--source-bucket") + 1], sourceEntries[1].bucket);
});

test("251 synthetic objects take a 250-object slice then complete with bounded pages and no key gaps", async () => {
  const root = makeRoot();
  const plan = basePlan(root);
  plan.jobs[0].batchLimit = 250;
  plan.jobs[0].pageSize = 10;
  const campaign = validate(root, plan);
  const objects = Array.from({ length: 251 }, (_, index) => ({
    Key: `photos/2026/${String(index).padStart(3, "0")}.txt`,
    Size: 100,
  }));
  const listedKeys = [];
  const pageSizes = [];
  const sliceSummaries = [];
  let createdStorageCount = 0;
  const runSlice = async (args, { env: prdEnv }) => {
    const output = [];
    const exitCode = await backfillCliMain(args, {
      env: prdEnv,
      platform: "linux",
      assertPrivatePathImpl: () => {},
      write: (line) => output.push(line),
      createStorage: () => {
        createdStorageCount += 1;
        return {
          async listSourcePage({ prefix, maxKeys, startAfter }) {
            assert.ok(maxKeys <= 10);
            pageSizes.push(maxKeys);
            const remaining = objects.filter((object) =>
              object.Key.startsWith(prefix)
              && (startAfter === undefined || object.Key > startAfter));
            const contents = remaining.slice(0, maxKeys);
            listedKeys.push(...contents.map((object) => object.Key));
            return {
              Contents: contents,
              IsTruncated: remaining.length > contents.length,
            };
          },
        };
      },
      runScan: (options) => runProductionBackfill({
        ...options,
        platform: "linux",
        assertPrivatePathImpl: () => {},
        saveCheckpoint: (checkpointPath, checkpoint) =>
          writeCheckpointAtomically(checkpointPath, checkpoint, () => {}),
        appendAudit: (auditPath, record) => appendAuditRecord(auditPath, record, {
          assertPrivatePath: () => {},
          syncDirectory: () => {},
        }),
        acquireLock: () => acquireWriterLock({
          lockPath: path.join(root, "campaign-test.lock"),
          syncDirectoryImpl: () => {},
          assertPrivatePathImpl: () => {},
        }),
        releaseLock: releaseWriterLock,
      }),
    });
    sliceSummaries.push(JSON.parse(output[0]));
    return { exitCode, output };
  };
  const result = await executeCampaign(campaign, runSlice);
  assert.equal(result.category, "completed", JSON.stringify({
    result,
    createdStorageCount,
    sliceSummaries,
    listedKeys: listedKeys.length,
    pageSizes: pageSizes.length,
  }));
  assert.equal(createdStorageCount, 2);
  assert.deepEqual(sliceSummaries.map((summary) => [
    summary.category,
    summary.examined,
    summary.unsupported,
  ]), [
    ["paused-cap", 250, 250],
    ["completed", 1, 1],
  ]);
  assert.equal(listedKeys.length, 251);
  assert.equal(new Set(listedKeys).size, 251);
  assert.deepEqual(listedKeys, objects.map((object) => object.Key));
  assert.equal(Math.max(...pageSizes), 10);
  assert.equal(pageSizes.length, 26);
});

test("existing state resumes without resetting its cursor and requires an exact clean-boundary backup", async () => {
  const root = makeRoot();
  const plan = basePlan(root);
  const campaign = validate(root, plan);
  const selected = campaign.jobs[0];
  const savedKey = "photos/2026/prior.jpg";
  checkpointFor(selected, savedKey);
  fs.copyFileSync(selected.paths.checkpointPath, selected.backupPaths.checkpointPath);

  const resumedCampaign = validate(root, plan);
  let callCount = 0;
  const result = await executeCampaign(resumedCampaign, async () => {
    callCount += 1;
    return {
      exitCode: 0,
      output: [summaryLine("completed")],
    };
  });
  assert.equal(result.category, "completed", JSON.stringify(result));
  assert.equal(callCount, 1);
  assert.equal(result.jobs[0].scanState, "resumed-existing-scan");
  assert.equal(
    JSON.parse(fs.readFileSync(selected.paths.checkpointPath, "utf8")).lastCompletedKey,
    savedKey,
  );

  fs.unlinkSync(selected.backupPaths.checkpointPath);
  assert.throws(() => validate(root, plan));
  fs.copyFileSync(selected.paths.checkpointPath, selected.backupPaths.checkpointPath);
  fs.writeFileSync(selected.backupPaths.checkpointPath, "stale");
  assert.throws(() => validate(root, plan));
});

test("corrupt checkpoint or audit state stops before any campaign slice", async (t) => {
  for (const stateKind of ["checkpoint", "audit"]) {
    await t.test(stateKind, async () => {
      const root = makeRoot();
      const plan = basePlan(root);
      const campaign = validate(root, plan);
      const job = campaign.jobs[0];
      if (stateKind === "checkpoint") {
        fs.writeFileSync(job.paths.checkpointPath, "not-json");
        fs.copyFileSync(job.paths.checkpointPath, job.backupPaths.checkpointPath);
      } else {
        checkpointFor(job, "photos/2026/existing.jpg");
        fs.copyFileSync(job.paths.checkpointPath, job.backupPaths.checkpointPath);
        fs.writeFileSync(job.paths.auditPath, "{malformed}\n");
        fs.copyFileSync(job.paths.auditPath, job.backupPaths.auditPath);
      }
      const validated = validate(root, plan);
      let sliceCalls = 0;
      const result = await executeCampaign(validated, async () => {
        sliceCalls += 1;
        throw new Error("invalid state must fail before storage");
      });
      assert.equal(result.category, "failed");
      assert.equal(result.jobs[0].category, "failed");
      assert.equal(sliceCalls, 0);
    });
  }
});

test("Sydney catch-up uses a fresh checkpoint while the prior job history stays untouched", async () => {
  const root = makeRoot();
  const oldJob = baseJob(root, { index: 1 });
  const plan = basePlan(root, [baseJob(root, { index: 2 })]);
  const oldCheckpoint = path.join(root, "prior-sydney.v2.json");
  fs.writeFileSync(oldCheckpoint, "historical private state");
  const before = fs.readFileSync(oldCheckpoint);
  const campaign = validate(root, plan);
  const keys = [
    "photos/2026/a-new-upload.jpg",
    "photos/2026/z-last.jpg",
  ];
  const startAfterValues = [];
  let sourceReads = 0;
  let derivedWrites = 0;
  const storage = {
    async listSourcePage(params) {
      startAfterValues.push(params.startAfter);
      return {
        Contents: keys.map((Key, index) => ({
          Key,
          Size: 1000,
          ETag: `"sydney-etag-${index}"`,
        })),
        IsTruncated: false,
      };
    },
    async headSource({ key }) {
      const index = keys.indexOf(key);
      return { etag: `"sydney-etag-${index}"`, size: 1000 };
    },
    async headDerived() {
      return true;
    },
    async getSourceBuffer() {
      sourceReads += 1;
      throw new Error("existing derivatives must not read source bodies");
    },
    async putDerived() {
      derivedWrites += 1;
      throw new Error("existing derivatives must not write");
    },
  };
  const result = await executeCampaign(campaign, (args, options) =>
    runActualCliSlice(args, { ...options, root, storage }));
  assert.equal(result.category, "completed");
  assert.equal(result.jobs[0].scanState, "started-new-scan");
  assert.equal(result.jobs[0].examined, 2);
  assert.equal(result.jobs[0].alreadyPresent, 2);
  assert.deepEqual(startAfterValues, [undefined]);
  assert.equal(sourceReads, 0);
  assert.equal(derivedWrites, 0);
  assert.notEqual(
    campaign.jobs[0].paths.checkpointPath,
    recipeStatePaths({ recipeId: "v2", checkpointPath: oldJob.checkpointPath }).checkpointPath,
  );
  assert.deepEqual(fs.readFileSync(oldCheckpoint), before);
});

test("a v1 Tokyo pilot can be selected as v2 without changing its v1 state", async () => {
  const root = makeRoot();
  const planJob = baseJob(root, {
    sourceBucket: sourceEntries[1].bucket,
    sourceRegion: sourceEntries[1].region,
    prefix: "pilot/",
  });
  const legacyCheckpoint = Buffer.from("preserve legacy v1 checkpoint");
  const legacyAudit = Buffer.from("preserve legacy v1 audit");
  fs.writeFileSync(planJob.checkpointPath, legacyCheckpoint);
  fs.writeFileSync(planJob.auditPath, legacyAudit);
  const campaign = validate(root, basePlan(root, [planJob]));
  const sourceKey = "pilot/photo.jpg";
  let sourceReads = 0;
  let derivedWrites = 0;
  let selectedRecipe;
  const storage = {
    async listSourcePage() {
      return {
        Contents: [{ Key: sourceKey, Size: 1000, ETag: '"tokyo-etag"' }],
        IsTruncated: false,
      };
    },
    async headSource() {
      return { etag: '"tokyo-etag"', size: 1000 };
    },
    async headDerived() {
      return true;
    },
    async getSourceBuffer() {
      sourceReads += 1;
      throw new Error("existing v2 derivative must skip body read");
    },
    async putDerived() {
      derivedWrites += 1;
      throw new Error("v1 state is not a v2 write target");
    },
  };
  const result = await executeCampaign(campaign, (args, options) => {
    selectedRecipe = args[args.indexOf("--recipe") + 1];
    return runActualCliSlice(args, { ...options, root, storage });
  });
  assert.equal(result.category, "completed");
  assert.equal(result.jobs[0].alreadyPresent, 1);
  assert.equal(selectedRecipe, "v2");
  assert.equal(sourceReads, 0);
  assert.equal(derivedWrites, 0);
  assert.equal(fs.existsSync(campaign.jobs[0].paths.checkpointPath), true);
  assert.deepEqual(fs.readFileSync(planJob.checkpointPath), legacyCheckpoint);
  assert.deepEqual(fs.readFileSync(planJob.auditPath), legacyAudit);
});

test("campaign stops on provider failure, unexpected CLI output, invalid counts and no progress", async (t) => {
  for (const [name, runSlice] of [
    ["provider failure", async () => ({
      exitCode: 1,
      output: [summaryLine("failed", { failed: 1 })],
    })],
    ["unexpected output", async () => ({ exitCode: 0, output: ["provider detail and private key"] })],
    ["invalid counters", async () => ({
      exitCode: 0,
      output: [summaryLine("completed", { examined: 2, generated: 1 })],
    })],
    ["non-advancing cursor", async () => ({
      exitCode: 0,
      output: [summaryLine("paused-cap", { examined: 2, generated: 2 })],
    })],
    ["premature cap", async () => ({
      exitCode: 0,
      output: [summaryLine("paused-cap", { examined: 1, generated: 1 })],
    })],
    ["zero-progress cap", async () => ({
      exitCode: 0,
      output: [summaryLine("paused-cap")],
    })],
    ["lock or writer failure", async () => ({
      exitCode: 1,
      output: [JSON.stringify({
        category: "failed",
        code: "invalid-state",
        examined: 0,
        generated: 0,
        alreadyPresent: 0,
        unsupported: 0,
        oversize: 0,
        failed: 1,
      })],
    })],
    ["ambiguous write", async () => ({
      exitCode: 1,
      output: [JSON.stringify({
        category: "failed",
        code: "unknown-write-outcome",
        examined: 0,
        generated: 0,
        alreadyPresent: 0,
        unsupported: 0,
        oversize: 0,
        failed: 1,
      })],
    })],
  ]) {
    await t.test(name, async () => {
      const root = makeRoot();
      const plan = basePlan(root, [
        baseJob(root, { index: 1 }),
        baseJob(root, {
          index: 2,
          sourceBucket: sourceEntries[1].bucket,
          sourceRegion: sourceEntries[1].region,
          prefix: "pilot/",
        }),
      ]);
      const campaign = validate(root, plan);
      const result = await executeCampaign(campaign, runSlice);
      assert.equal(result.category, "failed");
      assert.equal(result.jobs[0].category, "failed");
      assert.equal(result.jobs[1].category, "not-started");
    });
  }
});

test("stop requests and finite slice budgets return non-completed statuses", async (t) => {
  await t.test("stop between slices", async () => {
    const root = makeRoot();
    const plan = basePlan(root);
    plan.jobs[0].batchLimit = 1;
    const campaign = validate(root, plan);
    const result = await executeCampaign(campaign, async (_args, { jobIndex }) => {
      checkpointFor(campaign.jobs[jobIndex - 1], "photos/2026/a.jpg");
      return {
        exitCode: 0,
        output: [summaryLine("paused-cap", { examined: 1, generated: 1 })],
      };
    }, { stopRequested: () => campaign.jobs[0].paths.checkpointPath
      && fs.existsSync(campaign.jobs[0].paths.checkpointPath) });
    assert.equal(result.category, "stopped");
    assert.equal(result.slices, 1);
    assert.notEqual(result.category, "completed");
  });

  await t.test("global batch guard", async () => {
    const root = makeRoot();
    const plan = basePlan(root);
    plan.maxSlices = 1;
    plan.jobs[0].batchLimit = 1;
    const campaign = validate(root, plan);
    const result = await executeCampaign(campaign, async (_args, { jobIndex }) => {
      const state = readCursorForTest(campaign.jobs[jobIndex - 1]);
      checkpointFor(campaign.jobs[jobIndex - 1], state
        ? `${state}b`
        : "photos/2026/a.jpg");
      return {
        exitCode: 0,
        output: [summaryLine("paused-cap", { examined: 1, alreadyPresent: 1 })],
      };
    });
    assert.equal(result.category, "paused-budget");
    assert.equal(result.slices, 1);
    assert.notEqual(result.jobs[0].category, "completed");
  });
});

const readCursorForTest = (job) => {
  const checkpoint = recipeStatePaths({
    recipeId: "v2",
    checkpointPath: job.basePaths.checkpointPath,
    auditPath: job.basePaths.auditPath,
  }).checkpointPath;
  try {
    return JSON.parse(fs.readFileSync(checkpoint, "utf8")).lastCompletedKey;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

test("routine failure output contains no plan, credential, provider, or object details", async () => {
  const root = makeRoot();
  const planPath = writePlan(root, {
    ...basePlan(root),
    injectedSecret: "do-not-print",
  });
  const { output, write } = outputCollector();
  const code = await main(["--plan", planPath], {
    env: env(),
    stateRoot: root,
    validatePlanFile,
    validatePaths,
    write,
  });
  assert.equal(code, 1);
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), {
    category: "failed",
    slices: 0,
    jobs: [],
    examined: 0,
    generated: 0,
    alreadyPresent: 0,
    unsupported: 0,
    oversize: 0,
    failed: 0,
  });
  assert.equal(output[0].includes("do-not-print"), false);
  assert.equal(output[0].includes("private-access-value"), false);
  assert.equal(output[0].includes("approved-photo-library"), false);
});

test("successful campaign summary exposes only sanitized indices and aggregate counters", async () => {
  const root = makeRoot();
  const planPath = writePlan(root, basePlan(root));
  const { output, write } = outputCollector();
  const code = await main([
    "--plan", planPath,
    "--execute-campaign",
    "--confirm-prd-campaign",
  ], {
    env: env(),
    stateRoot: root,
    validatePlanFile,
    validatePaths,
    write,
    runSlice: async () => ({
      exitCode: 0,
      output: [summaryLine("completed")],
    }),
    assertPrivatePathImpl: () => {},
  });
  assert.equal(code, 0);
  assert.equal(output.length, 1);
  assert.equal(output[0].includes("approved-photo-library"), false);
  assert.equal(output[0].includes("private-derived-library"), false);
  assert.equal(output[0].includes("private-access-value"), false);
  assert.equal(output[0].includes("private-secret-value"), false);
  assert.equal(output[0].includes(planPath), false);
  assert.deepEqual(JSON.parse(output[0]), {
    category: "completed",
    slices: 1,
    jobs: [{
      jobIndex: 1,
      category: "completed",
      scanState: "started-new-scan",
      slices: 1,
      examined: 0,
      generated: 0,
      alreadyPresent: 0,
      unsupported: 0,
      oversize: 0,
      failed: 0,
    }],
    examined: 0,
    generated: 0,
    alreadyPresent: 0,
    unsupported: 0,
    oversize: 0,
    failed: 0,
  });
});

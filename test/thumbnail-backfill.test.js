const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  acquireLock,
  buildCheckpoint,
  checkpointPathIsOutsideRepo,
  runBackfillScan,
} = require("../src/thumbnail/backfill");

const scope = {
  sourceBucket: "wasabi-test-source",
  sourceRegion: "ap-southeast-2",
  prefix: "pilot/",
  destinationBucket: "wasabi-test-derived",
  destinationRegion: "ap-southeast-1",
};
const item = (Key, overrides = {}) => ({
  Key,
  Size: 100,
  ETag: '"test-etag"',
  ...overrides,
});
const result = (category) => ({ category, count: 1 });
const temporaryDirectories = [];
const temporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wasabi-backfill-test-"));
  temporaryDirectories.push(directory);
  return directory;
};
test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
const storageWithPages = (pages) => {
  const calls = [];
  return {
    calls,
    storage: {
      async listSourcePage(params) {
        calls.push(params);
        const page = pages.shift();
        if (page instanceof Error) {
          throw page;
        }
        return page;
      },
    },
  };
};
test("waits for one generation to settle before starting the next object or checkpointing it", async () => {
  const directory = temporaryDirectory();
  const checkpointPath = path.join(directory, "nested", "checkpoint.json");
  let resolveFirst;
  const started = [];
  const { storage } = storageWithPages([{
    Contents: [item("pilot/a.jpg"), item("pilot/b.jpg")],
    IsTruncated: false,
  }]);
  const scan = runBackfillScan({
    ...scope,
    storage,
    checkpointPath,
    dryRun: false,
    maxObjects: 2,
    generate: async ({ sourceKey }) => {
      started.push(sourceKey);
      if (sourceKey === "pilot/a.jpg") {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return result("already-present");
    },
  });

  let settled = false;
  scan.then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["pilot/a.jpg"]);
  assert.equal(settled, false);
  assert.equal(fs.existsSync(checkpointPath), false);
  resolveFirst(result("generated"));
  const summary = await scan;

  assert.deepEqual(started, ["pilot/a.jpg", "pilot/b.jpg"]);
  assert.equal(summary.generated, 1);
  assert.equal(summary.alreadyPresent, 1);
  assert.equal(summary.examined, 2);
  assert.equal(JSON.parse(fs.readFileSync(checkpointPath, "utf8")).lastCompletedKey, "pilot/b.jpg");
});

test("rejected and malformed generation outcomes stop without advancing the failing key", async (t) => {
  for (const [name, generate] of [
    ["rejected", async () => { throw new Error("private detail"); }],
    ["unknown category", async () => ({ category: "success", count: 1 })],
    ["missing result shape", async () => ({ category: "generated" })],
  ]) {
    await t.test(name, async () => {
      const directory = temporaryDirectory();
      const checkpointPath = path.join(directory, "checkpoint.json");
      const { storage } = storageWithPages([{
        Contents: [item("pilot/a.jpg")],
        IsTruncated: false,
      }]);
      const summary = await runBackfillScan({
        ...scope,
        storage,
        checkpointPath,
        dryRun: false,
        generate,
      });
      assert.equal(summary.category, "failed");
      assert.equal(summary.failed, 1);
      assert.equal(fs.existsSync(checkpointPath), false);
      assert.equal(fs.existsSync(`${checkpointPath}.lock`), false);
    });
  }
});

test("counts generated, existing, unsupported, oversized, and failed outcomes without advancing past failure", async () => {
  const directory = temporaryDirectory();
  const checkpointPath = path.join(directory, "checkpoint.json");
  const { storage } = storageWithPages([{
    Contents: [
      item("pilot/a.jpg"),
      item("pilot/b.jpg"),
      item("pilot/c.txt", { ETag: undefined }),
      item("pilot/d.jpg", { Size: 25 * 1024 * 1024 + 1, ETag: undefined }),
      item("pilot/e.jpg"),
    ],
    IsTruncated: false,
  }]);
  const summary = await runBackfillScan({
    ...scope,
    storage,
    checkpointPath,
    dryRun: false,
    generate: async ({ sourceKey }) => {
      if (sourceKey === "pilot/a.jpg") return result("generated");
      if (sourceKey === "pilot/b.jpg") return result("already-present");
      return result("failed");
    },
  });

  assert.deepEqual({
    category: summary.category,
    examined: summary.examined,
    generated: summary.generated,
    alreadyPresent: summary.alreadyPresent,
    unsupported: summary.unsupported,
    oversize: summary.oversize,
    failed: summary.failed,
  }, {
    category: "failed",
    examined: 5,
    generated: 1,
    alreadyPresent: 1,
    unsupported: 1,
    oversize: 1,
    failed: 1,
  });
  assert.equal(JSON.parse(fs.readFileSync(checkpointPath, "utf8")).lastCompletedKey, "pilot/d.jpg");
});

test("missing ETag on otherwise eligible metadata is a failure and does not checkpoint the key", async () => {
  const checkpointPath = path.join(temporaryDirectory(), "checkpoint.json");
  const { storage } = storageWithPages([{
    Contents: [item("pilot/a.jpg", { ETag: undefined })],
    IsTruncated: false,
  }]);
  const summary = await runBackfillScan({
    ...scope,
    storage,
    dryRun: false,
    checkpointPath,
    generate: async () => result("generated"),
  });
  assert.equal(summary.category, "failed");
  assert.equal(summary.examined, 1);
  assert.equal(summary.failed, 1);
  assert.equal(fs.existsSync(checkpointPath), false);
});

test("dry-run examines at most ten sequentially and never invokes source-body or derived-write methods", async () => {
  let active = 0;
  let maximumActive = 0;
  let bodyReads = 0;
  let derivedWrites = 0;
  const checkpointPath = path.join(temporaryDirectory(), "checkpoint.json");
  const { storage, calls } = storageWithPages([{
    Contents: Array.from({ length: 10 }, (_, index) => item(`pilot/${String(index).padStart(2, "0")}.jpg`)),
    IsTruncated: true,
  }]);
  storage.headSource = async () => ({ etag: '"test-etag"', size: 100 });
  storage.headDerived = async () => false;
  storage.getSourceBuffer = async () => { bodyReads += 1; };
  storage.putDerived = async () => { derivedWrites += 1; };
  const summary = await runBackfillScan({
    ...scope,
    storage,
    dryRun: true,
    maxObjects: 10,
    pageSize: 10,
    checkpointPath,
    generate: async ({ sourceKey, ...params }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const { generateThumbnailForObject } = require("../src/thumbnail/generate");
      const outcome = await generateThumbnailForObject({ ...params, sourceKey, dryRun: true });
      active -= 1;
      return outcome;
    },
  });

  assert.equal(summary.category, "paused-cap");
  assert.equal(summary.examined, 10);
  assert.equal(maximumActive, 1);
  assert.equal(bodyReads, 0);
  assert.equal(derivedWrites, 0);
  assert.equal(fs.existsSync(checkpointPath), false);
  assert.equal(fs.existsSync(`${checkpointPath}.lock`), false);
  assert.equal(calls.length, 1);
});

test("paginates in strict order from each fully processed StartAfter key", async () => {
  const starts = [];
  const pages = [
    { Contents: [item("pilot/a.jpg"), item("pilot/b.jpg")], IsTruncated: true },
    { Contents: [item("pilot/c.jpg"), item("pilot/d.jpg")], IsTruncated: true },
    { Contents: [item("pilot/e.jpg")], IsTruncated: false },
  ];
  const storage = {
    async listSourcePage(params) {
      starts.push(params.startAfter);
      return pages.shift();
    },
  };
  const summary = await runBackfillScan({
    ...scope,
    storage,
    dryRun: true,
    maxObjects: 5,
    pageSize: 2,
    generate: async () => result("dry-run"),
  });
  assert.equal(summary.examined, 5);
  assert.equal(summary.category, "dry-run");
  assert.deepEqual(starts, [undefined, "pilot/b.jpg", "pilot/d.jpg"]);
});

test("rejects malformed, unordered, duplicate, and out-of-prefix listing pages", async (t) => {
  const badPages = [
    { Contents: [item("pilot/b.jpg"), item("pilot/a.jpg")], IsTruncated: false },
    { Contents: [item("pilot/a.jpg"), item("pilot/a.jpg")], IsTruncated: false },
    { Contents: [item("other/a.jpg")], IsTruncated: false },
    { Contents: [], IsTruncated: true },
    { Contents: "malformed", IsTruncated: false },
    { Contents: [item("")], IsTruncated: false },
    {
      Contents: [item("pilot/a.jpg"), item("pilot/b.jpg")],
      IsTruncated: false,
    },
  ];
  for (const [index, page] of badPages.entries()) {
    await t.test(`invalid page ${index + 1}`, async () => {
      const { storage } = storageWithPages([page]);
      const summary = await runBackfillScan({
        ...scope,
        storage,
        dryRun: true,
        pageSize: index === badPages.length - 1 ? 1 : 5,
      });
      assert.equal(summary.category, "failed");
      assert.equal(summary.examined, 0);
    });
  }
});

test("stops on provider listing errors with a sanitized failure summary", async () => {
  const { storage } = storageWithPages([new Error("private bucket and key details")]);
  const summary = await runBackfillScan({ ...scope, storage, dryRun: true });
  assert.equal(summary.category, "failed");
  assert.equal(summary.failed, 1);
  assert.equal(JSON.stringify(summary).includes("private"), false);
});

test("resumes mid-page using StartAfter and binds the checkpoint to its exact scope", async () => {
  const directory = temporaryDirectory();
  const checkpointPath = path.join(directory, "checkpoint.json");
  fs.writeFileSync(checkpointPath, JSON.stringify(buildCheckpoint({
    scope,
    lastCompletedKey: "pilot/b.jpg",
  })));
  const { storage, calls } = storageWithPages([{
    Contents: [item("pilot/c.jpg")],
    IsTruncated: false,
  }]);
  const summary = await runBackfillScan({
    ...scope,
    storage,
    dryRun: false,
    checkpointPath,
    generate: async () => result("already-present"),
  });
  assert.equal(summary.alreadyPresent, 1);
  assert.equal(calls[0].startAfter, "pilot/b.jpg");
  assert.equal(JSON.parse(fs.readFileSync(checkpointPath, "utf8")).lastCompletedKey, "pilot/c.jpg");

  const mismatch = await runBackfillScan({
    ...scope,
    prefix: "pilot/narrow/",
    storage,
    dryRun: false,
    checkpointPath,
  });
  assert.equal(mismatch.category, "failed");
  assert.equal(fs.existsSync(`${checkpointPath}.lock`), false);
});

test("an ambiguous post-write failure retries from the prior checkpoint and recognizes already-present", async () => {
  const directory = temporaryDirectory();
  const checkpointPath = path.join(directory, "checkpoint.json");
  let generationCalls = 0;
  const makeStorage = () => ({
    async listSourcePage(params) {
      assert.equal(params.startAfter, undefined);
      return { Contents: [item("pilot/a.jpg")], IsTruncated: false };
    },
  });
  const first = await runBackfillScan({
    ...scope,
    storage: makeStorage(),
    dryRun: false,
    checkpointPath,
    generate: async () => {
      generationCalls += 1;
      throw new Error("ambiguous response after write");
    },
  });
  assert.equal(first.category, "failed");
  assert.equal(fs.existsSync(checkpointPath), false);

  const retry = await runBackfillScan({
    ...scope,
    storage: makeStorage(),
    dryRun: false,
    checkpointPath,
    generate: async () => {
      generationCalls += 1;
      return result("already-present");
    },
  });
  assert.equal(retry.alreadyPresent, 1);
  assert.equal(generationCalls, 2);
  assert.equal(JSON.parse(fs.readFileSync(checkpointPath, "utf8")).lastCompletedKey, "pilot/a.jpg");
});

test("rejects repository paths but permits a nested external checkpoint on first run", async () => {
  const repoRoot = path.resolve(__dirname, "..");
  assert.equal(checkpointPathIsOutsideRepo(repoRoot), false);
  assert.equal(checkpointPathIsOutsideRepo(path.join(repoRoot, "nested", "state.json")), false);
  assert.equal(checkpointPathIsOutsideRepo(path.join(temporaryDirectory(), "missing", "state.json")), true);

  const checkpointPath = path.join(temporaryDirectory(), "new", "subdir", "state.json");
  const { storage } = storageWithPages([{
    Contents: [item("pilot/a.jpg")],
    IsTruncated: false,
  }]);
  const summary = await runBackfillScan({
    ...scope,
    storage,
    dryRun: false,
    checkpointPath,
    generate: async () => result("generated"),
  });
  assert.equal(summary.generated, 1);
  assert.equal(fs.existsSync(checkpointPath), true);
});

test("exclusive locks reject contention and stale locks without taking them over", () => {
  const checkpointPath = path.join(temporaryDirectory(), "new", "checkpoint.json");
  const lock = acquireLock(checkpointPath);
  assert.throws(() => acquireLock(checkpointPath), { message: "lock-already-held" });
  fs.closeSync(lock.fd);
  fs.writeFileSync(lock.lockPath, "stale");
  assert.throws(() => acquireLock(checkpointPath), { message: "lock-already-held" });
  assert.equal(fs.readFileSync(lock.lockPath, "utf8"), "stale");
});

test("rejects corrupt, stale-version, unexpected, and mismatched checkpoints and always releases lock", async (t) => {
  const checkpoints = [
    ["corrupt", "not-json"],
    ["wrong version", JSON.stringify({ ...buildCheckpoint({ scope, lastCompletedKey: null }), version: 99 })],
    ["unexpected shape", JSON.stringify({ ...buildCheckpoint({ scope, lastCompletedKey: null }), extra: true })],
    ["scope mismatch", JSON.stringify(buildCheckpoint({
      scope: { ...scope, sourceBucket: "another-test-source" },
      lastCompletedKey: null,
    }))],
  ];
  for (const [name, contents] of checkpoints) {
    await t.test(name, async () => {
      const checkpointPath = path.join(temporaryDirectory(), "checkpoint.json");
      fs.writeFileSync(checkpointPath, contents);
      const summary = await runBackfillScan({
        ...scope,
        storage: { listSourcePage: async () => ({ Contents: [], IsTruncated: false }) },
        dryRun: false,
        checkpointPath,
      });
      assert.equal(summary.category, "failed");
      assert.equal(fs.existsSync(`${checkpointPath}.lock`), false);
    });
  }
});

test("a directory at the checkpoint path fails closed rather than being treated as a fresh run", async () => {
  const checkpointPath = path.join(temporaryDirectory(), "checkpoint.json");
  fs.mkdirSync(checkpointPath);
  const summary = await runBackfillScan({
    ...scope,
    storage: { listSourcePage: async () => ({ Contents: [], IsTruncated: false }) },
    dryRun: false,
    checkpointPath,
  });
  assert.equal(summary.category, "failed");
  assert.equal(fs.existsSync(`${checkpointPath}.lock`), false);
});

test("failed checkpoint replacement stops processing, cleans temp files, and releases its lock", async () => {
  const directory = temporaryDirectory();
  const checkpointPath = path.join(directory, "checkpoint.json");
  const { storage } = storageWithPages([{
    Contents: [item("pilot/a.jpg"), item("pilot/b.jpg")],
    IsTruncated: false,
  }]);
  const originalRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("synthetic filesystem failure");
  };
  let summary;
  try {
    summary = await runBackfillScan({
      ...scope,
      storage,
      dryRun: false,
      checkpointPath,
      generate: async () => result("generated"),
    });
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(summary.category, "failed");
  assert.equal(summary.examined, 1);
  assert.equal(fs.existsSync(`${checkpointPath}.lock`), false);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("uses the checkpoint cursor after each result and does not fetch another page past the cap", async () => {
  const starts = [];
  const storage = {
    async listSourcePage(params) {
      starts.push(params.startAfter);
      return {
        Contents: [item("pilot/a.jpg")],
        IsTruncated: true,
      };
    },
  };
  const summary = await runBackfillScan({
    ...scope,
    storage,
    dryRun: false,
    checkpointPath: path.join(temporaryDirectory(), "checkpoint.json"),
    maxObjects: 1,
    generate: async () => result("already-present"),
  });
  assert.equal(summary.category, "paused-cap");
  assert.deepEqual(starts, [undefined]);
});

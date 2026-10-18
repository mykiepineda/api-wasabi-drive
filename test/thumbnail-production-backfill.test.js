const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { createThumbnailKey } = require("../src/thumbnail/key");
const { runProductionBackfill } = require("../src/thumbnail/production-backfill");
const {
  loadProductionBackfillConfig,
  parseArguments,
  validateSourceScope,
  validateStatePaths,
  writeCheckpointAtomically,
} = require("../src/thumbnail/production-backfill");
const { main, safeSummary } = require("../scripts/thumbnail-backfill-prd");
const { createThumbnailPrdBackfillStorage } = require("../src/storage/thumbnail-prd-backfill-wasabi");

const scope = {
  sourceBucket: "approved-source-photos",
  sourceRegion: "ap-northeast-1",
  prefix: "approved-prefix/",
  destinationBucket: "private-derived-bucket",
  destinationRegion: "ap-southeast-1",
};
const config = {
  ...scope,
  stage: "prd",
  accessKeyId: "dedicated-backfill-access",
  secretAccessKey: "dedicated-backfill-secret",
};
const configEnv = (overrides = {}) => ({
  THUMBNAIL_PRD_BACKFILL_STAGE: config.stage,
  THUMBNAIL_PRD_BACKFILL_SOURCE_BUCKET: config.sourceBucket,
  THUMBNAIL_PRD_BACKFILL_SOURCE_REGION: config.sourceRegion,
  THUMBNAIL_PRD_BACKFILL_SOURCE_PREFIX: config.prefix,
  THUMBNAIL_PRD_BACKFILL_DERIVED_BUCKET: config.destinationBucket,
  THUMBNAIL_PRD_BACKFILL_DERIVED_REGION: config.destinationRegion,
  THUMBNAIL_PRD_BACKFILL_WASABI_ACCESS_KEY_ID: config.accessKeyId,
  THUMBNAIL_PRD_BACKFILL_WASABI_SECRET_ACCESS_KEY: config.secretAccessKey,
  ...overrides,
});
const cliArgs = (extra = []) => [
  "--source-bucket", scope.sourceBucket,
  "--source-region", scope.sourceRegion,
  "--prefix", scope.prefix,
  "--max-objects", "2",
  ...extra,
];
const makeItem = (key, overrides = {}) => ({
  Key: key,
  Size: 100,
  ETag: '"source-etag"',
  ...overrides,
});
const generatedKey = createThumbnailKey({
  sourceRegion: scope.sourceRegion,
  sourceBucket: scope.sourceBucket,
  completeSourceKey: `${scope.prefix}image.jpg`,
  normalizedETag: "source-etag",
});
const privateTestRoot = fs.mkdtempSync(path.join(os.homedir(), ".wasabi-prd-backfill-test-"));
if (process.platform !== "win32") fs.chmodSync(privateTestRoot, 0o700);
let nextStatePath = 0;
const makePrivateDirectory = () => privateTestRoot;
const statePaths = () => {
  nextStatePath += 1;
  const directory = privateTestRoot;
  return {
    checkpointPath: path.join(directory, `checkpoint-${nextStatePath}.json`),
    auditPath: path.join(directory, `audit-${nextStatePath}.jsonl`),
  };
};
const storageFor = (pages) => {
  const calls = [];
  return {
    calls,
    storage: {
      async listSourcePage(params) {
        calls.push(params);
        const page = pages.shift();
        if (page instanceof Error) throw page;
        return page;
      },
    },
  };
};
const generated = (key = generatedKey) => ({ category: "generated", count: 1, derivedKey: key });

test.after(() => fs.rmSync(privateTestRoot, { recursive: true, force: true }));

test("configuration requires dedicated credentials, exact production stage and Tokyo/Singapore regions", () => {
  assert.deepEqual(loadProductionBackfillConfig(configEnv()), config);
  const invalid = [
    { THUMBNAIL_PRD_BACKFILL_STAGE: "test" },
    { DEPLOYMENT_STAGE: "test" },
    { THUMBNAIL_PRD_BACKFILL_SOURCE_REGION: "ap-southeast-2" },
    { THUMBNAIL_PRD_BACKFILL_DERIVED_REGION: "ap-northeast-1" },
    { THUMBNAIL_PRD_BACKFILL_SOURCE_BUCKET: "wasabi-test-source" },
    { THUMBNAIL_PRD_BACKFILL_DERIVED_BUCKET: "wasabi-test-derived" },
    { THUMBNAIL_PRD_BACKFILL_DERIVED_BUCKET: config.sourceBucket },
    { THUMBNAIL_PRD_BACKFILL_SOURCE_PREFIX: "" },
    { THUMBNAIL_PRD_BACKFILL_SOURCE_PREFIX: "../" },
    { THUMBNAIL_PRD_BACKFILL_SOURCE_PREFIX: "approved-prefix/../sibling/" },
    { THUMBNAIL_PRD_BACKFILL_SOURCE_PREFIX: "approved-prefix\\nested/" },
    { WASABI_ACCESS_KEY_ID: "api-access" },
    { THUMBNAIL_TEST_WASABI_SECRET_ACCESS_KEY: "test-secret" },
    { THUMBNAIL_PRD_PREFLIGHT_WASABI_ACCESS_KEY_ID: "audit-access" },
    { AWS_ACCESS_KEY_ID: "aws-access" },
    { AWS_PROFILE: "owner-profile" },
    { AWS_WEB_IDENTITY_TOKEN_FILE: "token-path" },
  ];
  for (const overrides of invalid) {
    assert.throws(() => loadProductionBackfillConfig(configEnv(overrides)));
  }
  for (const key of Object.keys(configEnv())) {
    if (key.startsWith("THUMBNAIL_PRD_BACKFILL_")) {
      const incomplete = configEnv();
      delete incomplete[key];
      assert.throws(() => loadProductionBackfillConfig(incomplete));
    }
  }
});

test("arguments reject unknown, duplicate, malformed and unpaired execution flags", () => {
  assert.deepEqual(parseArguments(cliArgs()), {
    sourceBucket: scope.sourceBucket,
    sourceRegion: scope.sourceRegion,
    prefix: scope.prefix,
    maxObjects: "2",
    pageSize: undefined,
    checkpoint: undefined,
    audit: undefined,
    execute: false,
  });
  for (const args of [
    cliArgs(["--execute"]),
    cliArgs(["--confirm-prd-backfill"]),
    cliArgs(["--execute", "--confirm-prd-backfill", "--execute"]),
    cliArgs(["--execute", "--confirm-prd-backfill", "--write"]),
    cliArgs(["--source-region", scope.sourceRegion]),
    cliArgs(["--max-objects", "2"]),
  ]) {
    assert.throws(() => parseArguments(args), { message: "invalid-arguments" });
  }
});

test("source allowlisting is byte-exact and CLI validates scope before creating storage", async () => {
  const loaded = loadProductionBackfillConfig(configEnv());
  for (const options of [
    { sourceBucket: "another-approved-source" },
    { sourceRegion: "ap-southeast-1" },
    { prefix: `${scope.prefix}child/` },
    { prefix: `${scope.prefix} ` },
  ]) {
    assert.throws(() => validateSourceScope({ ...scope, ...options }, loaded));
  }
  for (const [flagIndex, wrongValue] of [
    [1, "another-approved-source"],
    [3, "ap-southeast-1"],
    [5, `${scope.prefix}child/`],
  ]) {
    const args = cliArgs();
    args[flagIndex] = wrongValue;
    let storageCreated = false;
    const output = [];
    assert.equal(await main(args, {
      env: configEnv(),
      write: (line) => output.push(line),
      createStorage: () => { storageCreated = true; return {}; },
    }), 1);
    assert.equal(storageCreated, false);
    assert.deepEqual(JSON.parse(output[0]), {
      category: "failed",
      examined: 0,
      generated: 0,
      alreadyPresent: 0,
      unsupported: 0,
      oversize: 0,
      failed: 1,
    });
  }
  let storageCreated = false;
  const incompleteExecution = [];
  const noPathsExit = await main(cliArgs(["--execute", "--confirm-prd-backfill"]), {
    env: configEnv(),
    write: (line) => incompleteExecution.push(line),
    createStorage: () => { storageCreated = true; return {}; },
  });
  assert.equal(noPathsExit, 1);
  assert.equal(storageCreated, false);
  assert.equal(JSON.parse(incompleteExecution[0]).category, "failed");
});

test("default CLI is dry-run and prints only a validated aggregate summary", async () => {
  const output = [];
  let storageCreated = false;
  let scanParams;
  const exitCode = await main(cliArgs(), {
    env: configEnv(),
    write: (line) => output.push(line),
    createStorage: (params) => {
      storageCreated = true;
      assert.equal(params.accessKeyId, config.accessKeyId);
      return {};
    },
    runScan: async (params) => {
      scanParams = params;
      return {
        category: "dry-run",
        examined: 1,
        generated: 0,
        alreadyPresent: 1,
        unsupported: 0,
        oversize: 0,
        failed: 0,
        sourceKey: "source-name-not-for-output",
        derivedKey: "derived-hash-not-for-output",
        etag: "etag-not-for-output",
        checkpointPath: "path-not-for-output",
        accessUrl: "url-not-for-output",
        credentials: "secret-not-for-output",
      };
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(storageCreated, true);
  assert.equal(scanParams.dryRun, true);
  assert.equal(scanParams.checkpointPath, undefined);
  assert.equal(scanParams.auditPath, undefined);
  for (const privateValue of [
    "source-name-not-for-output",
    "derived-hash-not-for-output",
    "etag-not-for-output",
    "path-not-for-output",
    "url-not-for-output",
    "secret-not-for-output",
  ]) {
    assert.equal(output[0].includes(privateValue), false);
  }
  assert.deepEqual(safeSummary({
    category: "completed",
    examined: 11,
    generated: 11,
    alreadyPresent: 0,
    unsupported: 0,
    oversize: 0,
    failed: 0,
  }), {
    category: "failed",
    examined: 0,
    generated: 0,
    alreadyPresent: 0,
    unsupported: 0,
    oversize: 0,
    failed: 0,
  });
});

test("region clients and operations are explicit and bound to the configured buckets, prefix and v1 keys", async () => {
  const commands = [];
  const clients = [];
  const body = Buffer.from("source");
  const storage = createThumbnailPrdBackfillStorage({
    scope,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    createClient: (options) => {
      const client = {
        options,
        async send(command) {
          commands.push(command);
          if (command instanceof ListObjectsV2Command) {
            return { IsTruncated: false, Contents: [] };
          }
          if (command instanceof HeadObjectCommand) {
            return command.input.Bucket === scope.sourceBucket
              ? { ETag: '"source-etag"', ContentLength: body.length }
              : { ETag: '"derived-etag"' };
          }
          if (command instanceof GetObjectCommand) {
            return {
              ETag: '"source-etag"',
              ContentLength: body.length,
              Body: (async function* stream() { yield body; }()),
            };
          }
          if (command instanceof PutObjectCommand) return { ETag: '"derived-etag"' };
          throw new Error("unexpected command");
        },
      };
      clients.push(client);
      return client;
    },
  });

  await storage.listSourcePage({
    bucket: scope.sourceBucket,
    region: scope.sourceRegion,
    prefix: scope.prefix,
    maxKeys: 2,
  });
  assert.deepEqual(commands[0].input, {
    Bucket: scope.sourceBucket,
    Prefix: scope.prefix,
    MaxKeys: 2,
  });
  await storage.headSource({
    bucket: scope.sourceBucket,
    key: `${scope.prefix}image.jpg`,
    region: scope.sourceRegion,
  });
  await storage.getSourceBuffer({
    bucket: scope.sourceBucket,
    key: `${scope.prefix}image.jpg`,
    region: scope.sourceRegion,
    etag: '"source-etag"',
    size: body.length,
  });
  assert.equal(commands.find((command) => command instanceof GetObjectCommand).input.IfMatch, '"source-etag"');
  await storage.headDerived({
    bucket: scope.destinationBucket,
    key: generatedKey,
    region: scope.destinationRegion,
  });
  await storage.putDerived({
    bucket: scope.destinationBucket,
    key: generatedKey,
    region: scope.destinationRegion,
    body: Buffer.from("webp"),
  });
  const put = commands.find((command) => command instanceof PutObjectCommand);
  assert.equal(put.input.IfNoneMatch, "*");
  assert.equal(clients.length, 2);
  assert.deepEqual(clients.map((client) => client.options.region).sort(), [
    "ap-northeast-1",
    "ap-southeast-1",
  ]);
  assert.deepEqual(clients.map((client) => client.options.endpoint).sort(), [
    "https://s3.ap-northeast-1.wasabisys.com",
    "https://s3.ap-southeast-1.wasabisys.com",
  ]);
  assert.ok(clients.every((client) => client.options.credentials.accessKeyId === config.accessKeyId));
  assert.ok(clients.every((client) => client.options.forcePathStyle === true));
  assert.ok(clients.every((client) => client.options.maxAttempts === 1));

  const callsBeforeInvalid = commands.length;
  await assert.rejects(storage.listSourcePage({
    bucket: scope.sourceBucket,
    region: scope.sourceRegion,
    prefix: "sibling/",
    maxKeys: 1,
  }));
  await assert.rejects(storage.headSource({
    bucket: scope.sourceBucket,
    key: "sibling/image.jpg",
    region: scope.sourceRegion,
  }));
  await assert.rejects(storage.headDerived({
    bucket: "unapproved-derived",
    key: generatedKey,
    region: scope.destinationRegion,
  }));
  await assert.rejects(storage.putDerived({
    bucket: scope.destinationBucket,
    key: "v1/aa/not-a-v1-key.webp",
    region: scope.destinationRegion,
    body: Buffer.from("webp"),
  }));
  const unrelatedKey = createThumbnailKey({
    sourceRegion: scope.sourceRegion,
    sourceBucket: scope.sourceBucket,
    completeSourceKey: `${scope.prefix}other-image.jpg`,
    normalizedETag: "source-etag",
  });
  await assert.rejects(storage.headDerived({
    bucket: scope.destinationBucket,
    key: unrelatedKey,
    region: scope.destinationRegion,
  }));
  assert.equal(commands.length, callsBeforeInvalid);
});

test("provider 403 and unsupported conditional headers fail; 412 is only already-present after positive HEAD", async () => {
  let headCalls = 0;
  let putCalls = 0;
  const storage = createThumbnailPrdBackfillStorage({
    scope,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    createClient: () => ({
      async send(command) {
        if (command instanceof HeadObjectCommand && command.input.Bucket === scope.sourceBucket) {
          return { ETag: '"source-etag"', ContentLength: 6 };
        }
        if (command instanceof HeadObjectCommand) {
          headCalls += 1;
          if (headCalls === 1) {
            const error = new Error("missing");
            error.name = "NotFound";
            error.$metadata = { httpStatusCode: 404 };
            throw error;
          }
          return { ETag: '"derived"' };
        }
        if (command instanceof GetObjectCommand) {
          return {
            ETag: '"source-etag"',
            ContentLength: 6,
            Body: (async function* stream() { yield Buffer.from("source"); }()),
          };
        }
        if (command instanceof PutObjectCommand) {
          putCalls += 1;
          const error = new Error("precondition failed");
          error.name = "PreconditionFailed";
          error.$metadata = { httpStatusCode: 412 };
          throw error;
        }
        throw new Error("unexpected operation");
      },
    }),
  });
  const { generateThumbnailForObject } = require("../src/thumbnail/generate");
  const raced = await generateThumbnailForObject({
    sourceBucket: scope.sourceBucket,
    sourceKey: `${scope.prefix}image.jpg`,
    sourceRegion: scope.sourceRegion,
    destinationBucket: scope.destinationBucket,
    destinationRegion: scope.destinationRegion,
    storage,
    dryRun: false,
    applyPolicy: async () => ({
      eligible: true,
      derivedKey: generatedKey,
      webpBuffer: Buffer.from("webp"),
      contentType: "image/webp",
      dimensions: { width: 1, height: 1 },
    }),
  });
  assert.equal(raced.category, "already-present");
  assert.equal(putCalls, 1);
  assert.equal(headCalls, 2);

  const forbiddenStorage = createThumbnailPrdBackfillStorage({
    scope,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    createClient: () => ({
      async send() {
        const error = new Error("private provider details");
        error.$metadata = { httpStatusCode: 403 };
        error.name = "AccessDenied";
        throw error;
      },
    }),
  });
  await assert.rejects(forbiddenStorage.headSource({
    bucket: scope.sourceBucket,
    key: `${scope.prefix}image.jpg`,
    region: scope.sourceRegion,
  }), { code: "provider-failure" });

  let putCount = 0;
  const unsupportedStorage = createThumbnailPrdBackfillStorage({
    scope,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    createClient: () => ({
      async send(command) {
        if (command instanceof HeadObjectCommand && command.input.Bucket === scope.sourceBucket) {
          return { ETag: '"source-etag"', ContentLength: 6 };
        }
        if (command instanceof HeadObjectCommand) {
          const error = new Error("missing");
          error.name = "NotFound";
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        if (command instanceof PutObjectCommand) {
          putCount += 1;
          const error = new Error("unsupported");
          error.name = "NotImplemented";
          error.$metadata = { httpStatusCode: 501 };
          throw error;
        }
        if (command instanceof GetObjectCommand) {
          return {
            ETag: '"source-etag"',
            ContentLength: 6,
            Body: (async function* stream() { yield Buffer.from("source"); }()),
          };
        }
        throw new Error("unexpected operation");
      },
    }),
  });
  const refused = await generateThumbnailForObject({
    sourceBucket: scope.sourceBucket,
    sourceKey: `${scope.prefix}image.jpg`,
    sourceRegion: scope.sourceRegion,
    destinationBucket: scope.destinationBucket,
    destinationRegion: scope.destinationRegion,
    storage: unsupportedStorage,
    dryRun: false,
    applyPolicy: async () => ({
      eligible: true,
      derivedKey: generatedKey,
      webpBuffer: Buffer.from("webp"),
      contentType: "image/webp",
      dimensions: { width: 1, height: 1 },
    }),
  });
  assert.equal(refused.category, "precondition-unsupported");
  assert.equal(putCount, 1);
});

test("dry-run lists and HEADs only, without body reads, PUTs, checkpoints, audit or lock changes", async () => {
  const lockExisted = fs.existsSync(require("../src/thumbnail/production-backfill").LOCK_PATH);
  const auditPath = path.join(makePrivateDirectory(), "audit.jsonl");
  let bodyReads = 0;
  let puts = 0;
  const summary = await runProductionBackfill({
    scope,
    storage: {
      async listSourcePage() {
        return {
          IsTruncated: false,
          Contents: [makeItem(`${scope.prefix}image.jpg`)],
        };
      },
      async headSource() { return { etag: '"source-etag"', size: 100 }; },
      async headDerived() { return false; },
      async getSourceBuffer() { bodyReads += 1; throw new Error("must not GET"); },
      async putDerived() { puts += 1; throw new Error("must not PUT"); },
    },
    maxObjects: 1,
    dryRun: true,
    generate: require("../src/thumbnail/generate").generateThumbnailForObject,
  });
  assert.equal(summary.category, "dry-run");
  assert.equal(summary.examined, 1);
  assert.equal(bodyReads, 0);
  assert.equal(puts, 0);
  assert.equal(fs.existsSync(auditPath), false);
  assert.equal(fs.existsSync(require("../src/thumbnail/production-backfill").LOCK_PATH), lockExisted);
});

test("source HEAD must match the listed ETag and size before checking derived metadata", async () => {
  let derivedHeads = 0;
  const summary = await runProductionBackfill({
    scope,
    storage: {
      async listSourcePage() {
        return {
          IsTruncated: false,
          Contents: [makeItem(`${scope.prefix}image.jpg`)],
        };
      },
      async headSource() { return { etag: '"changed-etag"', size: 100 }; },
      async headDerived() { derivedHeads += 1; return false; },
    },
    maxObjects: 1,
    dryRun: true,
  });
  assert.equal(summary.category, "failed");
  assert.equal(summary.failed, 1);
  assert.equal(derivedHeads, 0);
});

test("live scan initializes a scoped checkpoint, writes audit before checkpoint, then resumes via StartAfter", async () => {
  const paths = statePaths();
  const writes = [];
  const first = storageFor([{
    Contents: [makeItem(`${scope.prefix}a.jpg`)],
    IsTruncated: true,
  }]);
  const firstSummary = await runProductionBackfill({
    scope,
    storage: first.storage,
    maxObjects: 1,
    pageSize: 2,
    dryRun: false,
    ...paths,
    generate: async () => generated(),
    appendAudit: (file, record) => {
      writes.push("audit");
      require("../src/thumbnail/production-backfill").appendAuditRecord(file, record);
    },
    saveCheckpoint: (file, value) => {
      writes.push(`checkpoint:${value.lastCompletedKey ?? "initial"}`);
      writeCheckpointAtomically(file, value);
    },
  });
  assert.equal(firstSummary.category, "paused-cap");
  assert.equal(firstSummary.generated, 1);
  assert.deepEqual(writes, ["checkpoint:initial", "audit", `checkpoint:${scope.prefix}a.jpg`]);
  assert.equal(JSON.parse(fs.readFileSync(paths.checkpointPath, "utf8")).lastCompletedKey, `${scope.prefix}a.jpg`);
  const auditRecords = fs.readFileSync(paths.auditPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(Object.keys(auditRecords[0]).sort(), [
    "derivedKey", "scopeId", "status", "timestamp", "version",
  ]);
  assert.equal(auditRecords[0].derivedKey, generatedKey);
  assert.equal(auditRecords[0].status, "generated");
  assert.equal(auditRecords[0].scopeId.length, 64);

  const second = storageFor([{
    Contents: [makeItem(`${scope.prefix}b.jpg`)],
    IsTruncated: false,
  }]);
  const resumed = await runProductionBackfill({
    scope,
    storage: second.storage,
    maxObjects: 1,
    dryRun: false,
    ...paths,
    generate: async () => ({ category: "already-present", count: 1 }),
  });
  assert.equal(resumed.alreadyPresent, 1);
  assert.equal(second.calls[0].startAfter, `${scope.prefix}a.jpg`);
  assert.equal(fs.readFileSync(paths.auditPath, "utf8").trim().split("\n").length, 1);
  assert.equal(fs.existsSync(require("../src/thumbnail/production-backfill").LOCK_PATH), false);
});

test("one- and two-object caps stay bounded and report truncation honestly", async (t) => {
  for (const cap of [1, 2, 10]) {
    await t.test(`cap ${cap}`, async () => {
      const pages = cap === 10
        ? [
          {
            Contents: Array.from({ length: 5 }, (_, index) =>
              makeItem(`${scope.prefix}${String(index).padStart(2, "0")}.jpg`)),
            IsTruncated: true,
          },
          {
            Contents: Array.from({ length: 5 }, (_, index) =>
              makeItem(`${scope.prefix}${String(index + 5).padStart(2, "0")}.jpg`)),
            IsTruncated: false,
          },
        ]
        : [{
          Contents: Array.from({ length: cap }, (_, index) =>
            makeItem(`${scope.prefix}${String(index).padStart(2, "0")}.jpg`)),
          IsTruncated: true,
        }];
      const { storage, calls } = storageFor(pages);
      const summary = await runProductionBackfill({
        scope,
        storage,
        maxObjects: cap,
        dryRun: true,
        generate: async () => ({ category: "dry-run", count: 1 }),
      });
      assert.equal(summary.examined, cap);
      assert.equal(calls[0].maxKeys, Math.min(cap, 5));
      if (cap < 10) assert.equal(summary.category, "paused-cap");
      if (cap === 10) assert.equal(summary.category, "dry-run");
    });
  }
  for (const maxObjects of [0, 11]) {
    await assert.rejects(runProductionBackfill({
      scope,
      storage: { listSourcePage: async () => { throw new Error("must not list"); } },
      maxObjects,
    }));
  }
});

test("malformed, empty-truncated, out-of-order, duplicate and failed provider pages stop without checkpoint progress", async (t) => {
  const invalidPages = [
    { Contents: [], IsTruncated: true },
    { Contents: "invalid", IsTruncated: false },
    { Contents: [makeItem("outside/image.jpg")], IsTruncated: false },
    { Contents: [makeItem(`${scope.prefix}b.jpg`), makeItem(`${scope.prefix}a.jpg`)], IsTruncated: false },
    { Contents: [makeItem(`${scope.prefix}a.jpg`), makeItem(`${scope.prefix}a.jpg`)], IsTruncated: false },
    { Contents: [makeItem(`${scope.prefix}a.jpg`)], IsTruncated: "yes" },
    { Contents: [makeItem(`${scope.prefix}a.jpg`)], KeyCount: 2, IsTruncated: false },
    { Contents: [makeItem(`${scope.prefix}a.jpg`)], CommonPrefixes: [], IsTruncated: false },
  ];
  for (const [index, page] of invalidPages.entries()) {
    await t.test(`invalid page ${index + 1}`, async () => {
      const paths = statePaths();
      const { storage } = storageFor([page]);
      const summary = await runProductionBackfill({
        scope,
        storage,
        maxObjects: 2,
        dryRun: false,
        ...paths,
        generate: async () => ({ category: "already-present", count: 1 }),
      });
      assert.equal(summary.category, "failed");
      assert.equal(JSON.parse(fs.readFileSync(paths.checkpointPath, "utf8")).lastCompletedKey, null);
    });
  }
  const paths = statePaths();
  const failed = await runProductionBackfill({
    scope,
    storage: { listSourcePage: async () => { throw new Error("secret provider response"); } },
    maxObjects: 1,
    dryRun: false,
    ...paths,
  });
  assert.equal(failed.category, "failed");
  assert.equal(JSON.parse(fs.readFileSync(paths.checkpointPath, "utf8")).lastCompletedKey, null);
});

test("unsupported, oversize, zero-byte and malformed metadata have terminal/fail-closed outcomes", async () => {
  const paths = statePaths();
  const keys = [
    makeItem(`${scope.prefix}0-unsupported.txt`),
    makeItem(`${scope.prefix}a-empty.jpg`, { Size: 0 }),
    makeItem(`${scope.prefix}b-large.jpg`, { Size: 25 * 1024 * 1024 + 1 }),
    makeItem(`${scope.prefix}c-missing-etag.jpg`, { ETag: undefined }),
  ];
  const { storage } = storageFor([{ Contents: keys, IsTruncated: false }]);
  const summary = await runProductionBackfill({
    scope,
    storage,
    maxObjects: 4,
    dryRun: false,
    ...paths,
    generate: async () => { throw new Error("should not generate"); },
  });
  assert.equal(summary.category, "failed");
  assert.equal(summary.examined, 4);
  assert.equal(summary.unsupported, 2);
  assert.equal(summary.oversize, 1);
  assert.equal(JSON.parse(fs.readFileSync(paths.checkpointPath, "utf8")).lastCompletedKey, `${scope.prefix}b-large.jpg`);
});

test("CR2 retains preview eligibility while HEIC and NEF remain unsupported", async () => {
  const { storage } = storageFor([{
    Contents: [
      makeItem(`${scope.prefix}a-preview.cr2`),
      makeItem(`${scope.prefix}b-photo.heic`),
      makeItem(`${scope.prefix}c-photo.nef`),
    ],
    IsTruncated: false,
  }]);
  const generatedKeys = [];
  const summary = await runProductionBackfill({
    scope,
    storage,
    maxObjects: 3,
    dryRun: true,
    generate: async ({ sourceKey }) => {
      generatedKeys.push(sourceKey);
      return { category: "dry-run", count: 1 };
    },
  });
  assert.deepEqual(generatedKeys, [`${scope.prefix}a-preview.cr2`]);
  assert.equal(summary.examined, 3);
  assert.equal(summary.unsupported, 2);
  assert.equal(summary.category, "dry-run");
});

test("audit failure and checkpoint failure never advance past an unsettled object", async (t) => {
  await t.test("audit failure", async () => {
    const paths = statePaths();
    const { storage } = storageFor([{
      Contents: [makeItem(`${scope.prefix}a.jpg`)],
      IsTruncated: false,
    }]);
    const summary = await runProductionBackfill({
      scope,
      storage,
      maxObjects: 1,
      dryRun: false,
      ...paths,
      generate: async () => generated(),
      appendAudit: () => { throw new Error("audit disk failed"); },
    });
    assert.equal(summary.category, "failed");
    assert.equal(JSON.parse(fs.readFileSync(paths.checkpointPath, "utf8")).lastCompletedKey, null);
    assert.equal(fs.existsSync(paths.auditPath), false);
  });
  await t.test("checkpoint failure after durable audit", async () => {
    const paths = statePaths();
    const { storage } = storageFor([{
      Contents: [makeItem(`${scope.prefix}a.jpg`)],
      IsTruncated: false,
    }]);
    let saveCount = 0;
    const summary = await runProductionBackfill({
      scope,
      storage,
      maxObjects: 1,
      dryRun: false,
      ...paths,
      generate: async () => generated(),
      saveCheckpoint: (file, checkpoint) => {
        saveCount += 1;
        if (saveCount > 1) throw new Error("checkpoint disk failed");
        writeCheckpointAtomically(file, checkpoint);
      },
    });
    assert.equal(summary.category, "failed");
    assert.equal(fs.readFileSync(paths.auditPath, "utf8").trim().length > 0, true);
    assert.equal(JSON.parse(fs.readFileSync(paths.checkpointPath, "utf8")).lastCompletedKey, null);
  });
});

test("checkpoint scope mismatch, unsafe paths and stale writer locks fail closed", async (t) => {
  const paths = statePaths();
  writeCheckpointAtomically(paths.checkpointPath, {
    version: 1,
    scope: { ...scope, prefix: "different/" },
    lastCompletedKey: null,
  });
  let listed = false;
  const mismatch = await runProductionBackfill({
    scope,
    storage: { listSourcePage: async () => { listed = true; return { Contents: [], IsTruncated: false }; } },
    maxObjects: 1,
    dryRun: false,
    ...paths,
  });
  assert.equal(mismatch.category, "failed");
  assert.equal(listed, false);

  const repositoryPath = path.join(__dirname, "..", "private.json");
  assert.throws(() => validateStatePaths({
    checkpointPath: repositoryPath,
    auditPath: paths.auditPath,
  }));
  assert.throws(() => validateStatePaths({
    checkpointPath: paths.checkpointPath,
    auditPath: paths.checkpointPath,
  }));
  await t.test("symlinked checkpoint paths are rejected", (t) => {
    const linkPath = path.join(path.dirname(paths.checkpointPath), "checkpoint-link.json");
    try {
      fs.symlinkSync(paths.checkpointPath, linkPath, "file");
    } catch {
      t.skip("file symlink creation is unavailable");
      return;
    }
    assert.throws(() => validateStatePaths({
      checkpointPath: linkPath,
      auditPath: paths.auditPath,
    }));
  });

  const { LOCK_PATH, acquireWriterLock } = require("../src/thumbnail/production-backfill");
  try {
    fs.writeFileSync(LOCK_PATH, "stale-lock");
    assert.throws(() => acquireWriterLock(), { message: "lock-already-held" });
    assert.equal(fs.readFileSync(LOCK_PATH, "utf8"), "stale-lock");
  } finally {
    fs.unlinkSync(LOCK_PATH);
  }
});

test("different checkpoint paths contend for one production lock and release safely", async () => {
  const firstPaths = statePaths();
  const secondPaths = statePaths();
  let finishFirst;
  let startedFirst;
  const firstStarted = new Promise((resolve) => { startedFirst = resolve; });
  const firstRun = runProductionBackfill({
    scope,
    storage: storageFor([{
      Contents: [makeItem(`${scope.prefix}a.jpg`)],
      IsTruncated: false,
    }]).storage,
    maxObjects: 1,
    dryRun: false,
    ...firstPaths,
    generate: async () => {
      startedFirst();
      return new Promise((resolve) => { finishFirst = resolve; });
    },
  });
  await firstStarted;
  assert.equal(fs.existsSync(require("../src/thumbnail/production-backfill").LOCK_PATH), true);
  let secondListCalls = 0;
  const secondRun = await runProductionBackfill({
    scope,
    storage: {
      async listSourcePage() {
        secondListCalls += 1;
        return { Contents: [], IsTruncated: false };
      },
    },
    maxObjects: 1,
    dryRun: false,
    ...secondPaths,
  });
  assert.equal(secondRun.category, "failed");
  assert.equal(secondListCalls, 0);
  finishFirst({ category: "already-present", count: 1 });
  const firstResult = await firstRun;
  assert.equal(firstResult.category, "completed");
  assert.equal(fs.existsSync(require("../src/thumbnail/production-backfill").LOCK_PATH), false);
});

test("generated audit is append-only and ambiguous post-PUT replay is not claimed as generated", async () => {
  const paths = statePaths();
  const page = {
    Contents: [makeItem(`${scope.prefix}image.jpg`)],
    IsTruncated: false,
  };
  const first = await runProductionBackfill({
    scope,
    storage: storageFor([page]).storage,
    maxObjects: 1,
    dryRun: false,
    ...paths,
    generate: async () => generated(),
    saveCheckpoint: (file, checkpoint) => {
      if (checkpoint.lastCompletedKey !== null) throw new Error("simulated stop after audit/PUT");
      writeCheckpointAtomically(file, checkpoint);
    },
  });
  assert.equal(first.category, "failed");
  const auditBefore = fs.readFileSync(paths.auditPath, "utf8");

  const second = await runProductionBackfill({
    scope,
    storage: storageFor([page]).storage,
    maxObjects: 1,
    dryRun: false,
    ...paths,
    generate: async () => ({ category: "already-present", count: 1 }),
  });
  assert.equal(second.generated, 0);
  assert.equal(second.alreadyPresent, 1);
  assert.equal(fs.readFileSync(paths.auditPath, "utf8"), auditBefore);
});

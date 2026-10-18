const test = require("node:test");
const assert = require("node:assert/strict");
const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { main, safeSummary } = require("../scripts/thumbnail-production-preflight");
const {
  loadPreflightConfig,
  parseArguments,
  scanPreflight,
  validateScope,
} = require("../src/thumbnail/production-preflight");
const { createThumbnailPreflightStorage } = require("../src/storage/thumbnail-preflight-wasabi");
const { MAX_SOURCE_BYTES } = require("../src/thumbnail/policy");

const approved = {
  sourceBucket: "approved-photo-source",
  sourceRegion: "ap-southeast-2",
  sourcePrefix: "approved/",
  accessKeyId: "audit-only-access",
  secretAccessKey: "audit-only-secret",
};
const configEnv = (overrides = {}) => ({
  THUMBNAIL_PRD_PREFLIGHT_SOURCE_BUCKET: approved.sourceBucket,
  THUMBNAIL_PRD_PREFLIGHT_SOURCE_REGION: approved.sourceRegion,
  THUMBNAIL_PRD_PREFLIGHT_SOURCE_PREFIX: approved.sourcePrefix,
  THUMBNAIL_PRD_PREFLIGHT_WASABI_ACCESS_KEY_ID: approved.accessKeyId,
  THUMBNAIL_PRD_PREFLIGHT_WASABI_SECRET_ACCESS_KEY: approved.secretAccessKey,
  ...overrides,
});
const cliArgs = (extra = []) => [
  "--source-bucket", approved.sourceBucket,
  "--source-region", approved.sourceRegion,
  "--prefix", approved.sourcePrefix,
  "--max-objects", "10",
  ...extra,
];
const object = (key, size = 10, ETag = '"valid-etag"') => ({ Key: key, Size: size, ETag });
const category = (count, bytes) => ({ count, bytes });

test("configuration requires dedicated audit credentials and an exact safe scope", () => {
  const config = loadPreflightConfig(configEnv({
    WASABI_ACCESS_KEY_ID: "api-access-must-not-be-used",
    WASABI_SECRET_ACCESS_KEY: "api-secret-must-not-be-used",
    THUMBNAIL_TEST_WASABI_ACCESS_KEY_ID: "test-access-must-not-be-used",
  }));
  assert.deepEqual(config, approved);

  for (const key of [
    "THUMBNAIL_PRD_PREFLIGHT_SOURCE_BUCKET",
    "THUMBNAIL_PRD_PREFLIGHT_SOURCE_REGION",
    "THUMBNAIL_PRD_PREFLIGHT_SOURCE_PREFIX",
    "THUMBNAIL_PRD_PREFLIGHT_WASABI_ACCESS_KEY_ID",
    "THUMBNAIL_PRD_PREFLIGHT_WASABI_SECRET_ACCESS_KEY",
  ]) {
    const missing = configEnv({
      WASABI_ACCESS_KEY_ID: "api-access-must-not-be-used",
      WASABI_SECRET_ACCESS_KEY: "api-secret-must-not-be-used",
      AWS_ACCESS_KEY_ID: "aws-profile-must-not-be-used",
      AWS_SECRET_ACCESS_KEY: "aws-secret-must-not-be-used",
    });
    delete missing[key];
    assert.throws(() => loadPreflightConfig(missing));
  }
  assert.throws(() => loadPreflightConfig(configEnv({
    THUMBNAIL_PRD_PREFLIGHT_SOURCE_PREFIX: " ",
  })));
  assert.throws(() => loadPreflightConfig(configEnv({
    THUMBNAIL_PRD_PREFLIGHT_SOURCE_PREFIX: "../",
  })));
  assert.throws(() => loadPreflightConfig(configEnv({
    THUMBNAIL_PRD_PREFLIGHT_SOURCE_REGION: "unknown-region",
  })));
  assert.throws(() => loadPreflightConfig(configEnv({
    WASABI_ACCESS_KEY_ID: approved.accessKeyId,
  })));
  assert.throws(() => loadPreflightConfig(configEnv({
    THUMBNAIL_TEST_WASABI_SECRET_ACCESS_KEY: approved.secretAccessKey,
  })));
  assert.throws(() => loadPreflightConfig(configEnv({
    AWS_ACCESS_KEY_ID: approved.accessKeyId,
  })));
});

test("CLI requires exact configured identifiers, explicit cap, and rejects write flags", async () => {
  assert.deepEqual(parseArguments(cliArgs()), {
    sourceBucket: approved.sourceBucket,
    sourceRegion: approved.sourceRegion,
    prefix: approved.sourcePrefix,
    maxObjects: "10",
    pageSize: undefined,
  });
  for (const args of [
    cliArgs(["--execute"]),
    cliArgs(["--write"]),
    cliArgs(["--confirm-production"]),
    cliArgs(["--source-bucket", "another-bucket"]),
    cliArgs(["--max-objects", "10"]),
    cliArgs().slice(0, 6),
  ]) {
    assert.throws(() => parseArguments(args));
  }
  const config = loadPreflightConfig(configEnv());
  for (const mismatch of [
    { sourceBucket: "another-source" },
    { sourceRegion: "ap-southeast-1" },
    { prefix: "approved/sub/" },
  ]) {
    assert.throws(() => validateScope({
      sourceBucket: mismatch.sourceBucket ?? approved.sourceBucket,
      sourceRegion: mismatch.sourceRegion ?? approved.sourceRegion,
      prefix: mismatch.prefix ?? approved.sourcePrefix,
    }, config));
  }
  for (const [index, value] of [[1, "another-source"], [3, "ap-southeast-1"], [5, "approved/sub/"]]) {
    const args = cliArgs();
    args[index] = value;
    let storageCreated = false;
    const output = [];
    assert.equal(await main(args, {
      env: configEnv(),
      write: (line) => output.push(line),
      createStorage: () => {
        storageCreated = true;
        throw new Error("must not create storage");
      },
    }), 1);
    assert.equal(storageCreated, false);
    assert.deepEqual(JSON.parse(output[0]), { category: "failed", code: "preflight-failed" });
  }
});

test("storage is pinned to one bucket/prefix and constructs only bounded ListObjectsV2 requests", async () => {
  let clientOptions;
  const requests = [];
  const storage = createThumbnailPreflightStorage({
    bucket: approved.sourceBucket,
    prefix: approved.sourcePrefix,
    region: approved.sourceRegion,
    accessKeyId: approved.accessKeyId,
    secretAccessKey: approved.secretAccessKey,
    createClient: (options) => {
      clientOptions = options;
      return {
        async send(command) {
          requests.push(command);
          return { IsTruncated: false, Contents: [] };
        },
      };
    },
  });
  await storage.listPage({ pageSize: 7, continuationToken: "opaque-token" });
  assert.equal(clientOptions.region, approved.sourceRegion);
  assert.equal(clientOptions.endpoint, "https://s3.ap-southeast-2.wasabisys.com");
  assert.equal(clientOptions.forcePathStyle, true);
  assert.deepEqual(clientOptions.credentials, {
    accessKeyId: approved.accessKeyId,
    secretAccessKey: approved.secretAccessKey,
  });
  assert.equal(requests.length, 1);
  assert.ok(requests[0] instanceof ListObjectsV2Command);
  assert.deepEqual(requests[0].input, {
    Bucket: approved.sourceBucket,
    Prefix: approved.sourcePrefix,
    MaxKeys: 7,
    ContinuationToken: "opaque-token",
  });
  assert.equal(Object.keys(requests[0].input).some((key) => /Delimiter|StartAfter|Key$/.test(key)), false);
  await assert.rejects(storage.listPage({ pageSize: 1001 }));
  assert.throws(() => createThumbnailPreflightStorage({
    bucket: approved.sourceBucket,
    prefix: "",
    region: approved.sourceRegion,
    accessKeyId: approved.accessKeyId,
    secretAccessKey: approved.secretAccessKey,
  }));
});

test("scan paginates with bounded requests and classifies metadata into aggregate counts and bytes", async () => {
  const pages = [
    {
      IsTruncated: true,
      NextContinuationToken: "next-page",
      Contents: [
        object("approved/01.jpg", 10),
        object("approved/02.CR2", 20),
      ],
    },
    {
      IsTruncated: true,
      NextContinuationToken: "last-page",
      Contents: [
        object("approved/03.jpg", MAX_SOURCE_BYTES + 1, null),
        object("approved/04.nef", 30, null),
      ],
    },
    {
      IsTruncated: true,
      NextContinuationToken: "final-page",
      Contents: [
        object("approved/05.jpg", 0, undefined),
        object("approved/06.jpg", 15, '"malformed'),
      ],
    },
    {
      IsTruncated: false,
      Contents: [
        object("approved/07.jpg", 25, null),
        object("approved/08.jpeg", MAX_SOURCE_BYTES),
      ],
    },
  ];
  const requests = [];
  const summary = await scanPreflight({
    bucket: approved.sourceBucket,
    region: approved.sourceRegion,
    prefix: approved.sourcePrefix,
    maxObjects: 10,
    pageSize: 2,
    listPage: async (params) => {
      requests.push(params);
      return pages.shift();
    },
  });
  assert.deepEqual(requests.map(({ bucket, prefix, pageSize, continuationToken }) => ({
    bucket,
    prefix,
    pageSize,
    continuationToken,
  })), [
    { bucket: approved.sourceBucket, prefix: approved.sourcePrefix, pageSize: 2, continuationToken: undefined },
    { bucket: approved.sourceBucket, prefix: approved.sourcePrefix, pageSize: 2, continuationToken: "next-page" },
    { bucket: approved.sourceBucket, prefix: approved.sourcePrefix, pageSize: 2, continuationToken: "last-page" },
    { bucket: approved.sourceBucket, prefix: approved.sourcePrefix, pageSize: 2, continuationToken: "final-page" },
  ]);
  assert.deepEqual(summary, {
    examined: 8,
    eligibleStandard: category(2, MAX_SOURCE_BYTES + 10),
    eligibleCr2: category(1, 20),
    oversized: category(1, MAX_SOURCE_BYTES + 1),
    unsupported: category(3, 70),
    zeroByte: category(1, 0),
    invalidEtag: category(4, MAX_SOURCE_BYTES + 71),
    complete: true,
    capped: false,
    cap: 10,
  });
});

test("multi-page classification applies primary-category precedence and reconciles counts and bytes", async () => {
  const pages = [
    {
      IsTruncated: true,
      NextContinuationToken: "second-page",
      Contents: [
        object("approved/00-marker/", 0, '"malformed'),
        object("approved/01-video.mp4", MAX_SOURCE_BYTES + 1, null),
        object("approved/02-deferred.nef", MAX_SOURCE_BYTES + 2),
        object("approved/03-large.jpg", MAX_SOURCE_BYTES + 3, '"malformed'),
      ],
    },
    {
      IsTruncated: true,
      NextContinuationToken: "third-page",
      Contents: [
        object("approved/04-large.CR2", MAX_SOURCE_BYTES + 4),
        object("approved/05-folder/", 7, '"malformed'),
        object("approved/06-missing.jpg", 11, null),
        object("approved/07-malformed.jpg", 12, '"malformed'),
      ],
    },
    {
      IsTruncated: false,
      Contents: [
        object("approved/08-eligible.jpg", 13),
        object("approved/09-eligible.CR2", 14),
        object("approved/10-invalid.nef", 5, null),
      ],
    },
  ];
  const summary = await scanPreflight({
    bucket: approved.sourceBucket,
    region: approved.sourceRegion,
    prefix: approved.sourcePrefix,
    maxObjects: 20,
    pageSize: 4,
    listPage: async () => pages.shift(),
  });

  assert.deepEqual(summary, {
    examined: 11,
    eligibleStandard: category(1, 13),
    eligibleCr2: category(1, 14),
    oversized: category(2, 2 * MAX_SOURCE_BYTES + 7),
    unsupported: category(6, 2 * MAX_SOURCE_BYTES + 38),
    zeroByte: category(1, 0),
    invalidEtag: category(7, 2 * MAX_SOURCE_BYTES + 39),
    complete: true,
    capped: false,
    cap: 20,
  });
  const primary = [
    summary.eligibleStandard,
    summary.eligibleCr2,
    summary.oversized,
    summary.unsupported,
    summary.zeroByte,
  ];
  assert.equal(primary.reduce((count, categorySummary) => count + categorySummary.count, 0), summary.examined);
  assert.equal(
    primary.reduce((bytes, categorySummary) => bytes + categorySummary.bytes, 0),
    4 * MAX_SOURCE_BYTES + 72,
  );
});

test("cap reports a partial sample; an exhausted listing at the exact cap is complete", async (t) => {
  const base = {
    bucket: approved.sourceBucket,
    region: approved.sourceRegion,
    prefix: approved.sourcePrefix,
    maxObjects: 2,
    pageSize: 2,
  };
  const items = [object("approved/01.jpg"), object("approved/02.jpg")];
  await t.test("more objects remain", async () => {
    const result = await scanPreflight({
      ...base,
      listPage: async () => ({
        IsTruncated: true,
        NextContinuationToken: "more",
        Contents: items,
      }),
    });
    assert.equal(result.complete, false);
    assert.equal(result.capped, true);
  });
  await t.test("listing exhausted at cap", async () => {
    const result = await scanPreflight({
      ...base,
      listPage: async () => ({ IsTruncated: false, Contents: items }),
    });
    assert.equal(result.complete, true);
    assert.equal(result.capped, false);
  });
});

test("malformed listing pages, repeated tokens, ordering, or scope fail closed", async (t) => {
  const base = {
    bucket: approved.sourceBucket,
    region: approved.sourceRegion,
    prefix: approved.sourcePrefix,
    maxObjects: 10,
    pageSize: 2,
  };
  const cases = [
    ["missing truncation flag", async () => ({ Contents: [] })],
    ["non-array contents", async () => ({ IsTruncated: false, Contents: {} })],
    ["unexpected common prefixes", async () => ({ IsTruncated: false, Contents: [], CommonPrefixes: [{}] })],
    ["inconsistent key count", async () => ({ IsTruncated: false, KeyCount: 1, Contents: [] })],
    ["oversized page", async () => ({
      IsTruncated: false,
      Contents: [object("approved/01.jpg"), object("approved/02.jpg"), object("approved/03.jpg")],
    })],
    ["missing token", async () => ({ IsTruncated: true, Contents: [object("approved/01.jpg")] })],
    ["truncated empty page", async () => ({
      IsTruncated: true,
      NextContinuationToken: "token",
      Contents: [],
    })],
    ["out-of-scope object", async () => ({
      IsTruncated: false,
      Contents: [object("other/01.jpg")],
    })],
    ["invalid size", async () => ({
      IsTruncated: false,
      Contents: [object("approved/01.jpg", Number.NaN)],
    })],
    ["unsorted objects", async () => ({
      IsTruncated: false,
      Contents: [object("approved/02.jpg"), object("approved/01.jpg")],
    })],
  ];
  for (const [name, listPage] of cases) {
    await t.test(name, async () => {
      await assert.rejects(scanPreflight({ ...base, listPage }));
    });
  }
  await t.test("repeated continuation token", async () => {
    let call = 0;
    await assert.rejects(scanPreflight({
      ...base,
      listPage: async () => {
        call += 1;
        return {
          IsTruncated: true,
          NextContinuationToken: "repeated",
          Contents: [object(`approved/0${call}.jpg`)],
        };
      },
    }));
  });
  await t.test("combined primary byte total exceeding the safe integer range", async () => {
    await assert.rejects(scanPreflight({
      ...base,
      listPage: async () => ({
        IsTruncated: false,
        Contents: [
          object("approved/01.jpg", Number.MAX_SAFE_INTEGER),
          object("approved/02.mp4", Number.MAX_SAFE_INTEGER),
        ],
      }),
    }), /invalid-listing-size-total/);
  });
});

test("CLI prints only an allowlisted aggregate summary and sanitizes provider failures", async (t) => {
  const output = [];
  const write = (line) => output.push(line);
  const privateMessage = "private-bucket/private-photo.jpg private-etag private-provider-error";
  await t.test("aggregate result", async () => {
    const exitCode = await main(cliArgs(), {
      env: configEnv(),
      write,
      createStorage: ({ bucket, prefix, region, accessKeyId, secretAccessKey }) => {
        assert.deepEqual({ bucket, prefix, region, accessKeyId, secretAccessKey }, {
          bucket: approved.sourceBucket,
          prefix: approved.sourcePrefix,
          region: approved.sourceRegion,
          accessKeyId: approved.accessKeyId,
          secretAccessKey: approved.secretAccessKey,
        });
        return { listPage: async () => ({ IsTruncated: false, Contents: [object("approved/safe-fixture.jpg")] }) };
      },
    });
    assert.equal(exitCode, 0);
    const line = output.shift();
    const result = JSON.parse(line);
    assert.equal(result.eligibleStandard.count, 1);
    assert.equal(line.includes("approved-photo-source"), false);
    assert.equal(line.includes("approved/"), false);
    assert.equal(line.includes("valid-etag"), false);
    assert.deepEqual(Object.keys(result).sort(), [
      "cap",
      "capped",
      "complete",
      "eligibleCr2",
      "eligibleStandard",
      "examined",
      "invalidEtag",
      "oversized",
      "unsupported",
      "zeroByte",
    ].sort());
  });
  await t.test("provider failure", async () => {
    const exitCode = await main(cliArgs(), {
      env: configEnv(),
      write,
      createStorage: () => ({
        listPage: async () => {
          throw new Error(privateMessage);
        },
      }),
    });
    assert.equal(exitCode, 1);
    const line = output.shift();
    assert.deepEqual(JSON.parse(line), { category: "failed", code: "preflight-failed" });
    assert.equal(line.includes(privateMessage), false);
  });
  await t.test("unexpected private fields in scan summary are discarded", async () => {
    const exitCode = await main(cliArgs(), {
      env: configEnv(),
      write,
      createStorage: () => ({ listPage: async () => ({ IsTruncated: false, Contents: [] }) }),
      runScan: async () => ({
        examined: 0,
        eligibleStandard: category(0, 0),
        eligibleCr2: category(0, 0),
        oversized: category(0, 0),
        unsupported: category(0, 0),
        zeroByte: category(0, 0),
        invalidEtag: category(0, 0),
        complete: true,
        capped: false,
        cap: 10,
        privateKey: privateMessage,
      }),
    });
    assert.equal(exitCode, 0);
    const line = output.shift();
    assert.equal(line.includes(privateMessage), false);
    assert.equal(JSON.parse(line).privateKey, undefined);
  });
});

test("sanitizer rejects partial summaries represented as complete", () => {
  assert.throws(() => safeSummary({
    examined: 0,
    eligibleStandard: category(0, 0),
    eligibleCr2: category(0, 0),
    oversized: category(0, 0),
    unsupported: category(0, 0),
    zeroByte: category(0, 0),
    invalidEtag: category(0, 0),
    complete: true,
    capped: true,
    cap: 10,
  }, 10));
});

test("preflight module exposes no API or body access through its listing adapter", () => {
  const source = require("node:fs").readFileSync(
    require.resolve("../src/storage/thumbnail-preflight-wasabi"),
    "utf8",
  );
  assert.match(source, /ListObjectsV2Command/);
  assert.doesNotMatch(source, /GetObjectCommand|HeadObjectCommand|PutObjectCommand|DeleteObjectCommand|CopyObjectCommand/);
});

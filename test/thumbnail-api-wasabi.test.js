const test = require("node:test");
const assert = require("node:assert/strict");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const {
  ThumbnailApiWasabiError,
  createThumbnailApiWasabiStorage,
} = require("../src/storage/thumbnail-api-wasabi");

const validKey = `v1/ab/${"ab"}${"0".repeat(62)}.webp`;

test("thumbnail signer uses explicit read credentials, Singapore endpoint, fixed bucket and GetObject only", async () => {
  const clients = [];
  const signed = [];
  const signer = createThumbnailApiWasabiStorage({
    bucket: "synthetic-derived",
    region: "ap-southeast-1",
    accessKeyId: "synthetic-derived-read",
    secretAccessKey: "synthetic-derived-secret",
    urlTtlSeconds: 1800,
    createClient: (options) => {
      const client = { options };
      clients.push(client);
      return client;
    },
    signUrl: async (...args) => {
      signed.push(args);
      return "https://signed.example/thumbnail";
    },
  });

  const url = await signer.getObjectAccessUrl({ Key: validKey, Bucket: "caller-selected-bucket" });

  assert.equal(url, "https://signed.example/thumbnail");
  assert.equal(clients.length, 1);
  assert.equal(clients[0].options.endpoint, "https://s3.ap-southeast-1.wasabisys.com");
  assert.equal(clients[0].options.region, "ap-southeast-1");
  assert.deepEqual(clients[0].options.credentials, {
    accessKeyId: "synthetic-derived-read",
    secretAccessKey: "synthetic-derived-secret",
  });
  assert.equal(signed.length, 1);
  assert.equal(signed[0][0], clients[0]);
  assert.ok(signed[0][1] instanceof GetObjectCommand);
  assert.deepEqual(signed[0][1].input, {
    Bucket: "synthetic-derived",
    Key: validKey,
  });
  assert.deepEqual(signed[0][2], { expiresIn: 1800 });
  assert.deepEqual(Object.keys(require.cache).filter((modulePath) =>
    /[\\/]src[\\/](?:thumbnail[\\/](?:service|generate|backfill|production-backfill)|storage[\\/](?:wasabi|thumbnail-prd-backfill-wasabi))\.js$/i.test(modulePath),
  ), []);
});

test("thumbnail signer rejects malformed, non-v1 and shard-mismatched keys", async () => {
  const signer = createThumbnailApiWasabiStorage({
    bucket: "synthetic-derived",
    region: "ap-southeast-1",
    accessKeyId: "synthetic-read",
    secretAccessKey: "synthetic-secret",
    createClient: () => ({}),
    signUrl: async () => {
      throw new Error("signing must not be reached for invalid keys");
    },
  });

  for (const Key of [
    "",
    "v2/ab/ab00000000000000000000000000000000000000000000000000000000000000.webp",
    `v1/aa/${"ab"}${"0".repeat(62)}.webp`,
    `v1/ab/${"0".repeat(64)}.webp`,
  ]) {
    await assert.rejects(
      signer.getObjectAccessUrl({ Key }),
      (error) => error instanceof ThumbnailApiWasabiError,
    );
  }
});

test("thumbnail signer requires fixed regional config, dedicated credentials and a safe lifetime", () => {
  const base = {
    bucket: "synthetic-derived",
    region: "ap-southeast-1",
    accessKeyId: "synthetic-read",
    secretAccessKey: "synthetic-secret",
  };

  for (const invalid of [
    { ...base, bucket: "" },
    { ...base, region: "not-a-region" },
    { ...base, accessKeyId: "" },
    { ...base, secretAccessKey: "" },
    { ...base, urlTtlSeconds: 59 },
    { ...base, urlTtlSeconds: 3601 },
    { ...base, urlTtlSeconds: "3600" },
  ]) {
    assert.throws(() => createThumbnailApiWasabiStorage({
      ...invalid,
      createClient: () => ({}),
    }), ThumbnailApiWasabiError);
  }
});

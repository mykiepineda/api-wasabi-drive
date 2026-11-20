const test = require("node:test");
const assert = require("node:assert/strict");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const {
  ThumbnailApiWasabiError,
  createThumbnailApiWasabiStorage,
} = require("../src/storage/thumbnail-api-wasabi");

const validKey = `v1/ab/${"ab"}${"0".repeat(62)}.webp`;
const validV2Key = `v2/cd/${"cd"}${"0".repeat(62)}.webp`;

test("thumbnail signer uses explicit read credentials, Singapore endpoint, fixed bucket and GetObject only", async () => {
  const clients = [];
  const signed = [];
  let sendCalls = 0;
  const signer = createThumbnailApiWasabiStorage({
    bucket: "synthetic-derived",
    region: "ap-southeast-1",
    accessKeyId: "synthetic-derived-read",
    secretAccessKey: "synthetic-derived-secret",
    urlTtlSeconds: 1800,
    createClient: (options) => {
      const client = {
        options,
        send: async () => {
          sendCalls += 1;
          throw new Error("signer must not make a storage request");
        },
      };
      clients.push(client);
      return client;
    },
    signUrl: async (...args) => {
      signed.push(args);
      return "https://signed.example/thumbnail";
    },
  });

  const url = await signer.getObjectAccessUrl({ Key: validKey, Bucket: "caller-selected-bucket" });
  const v2Url = await signer.getObjectAccessUrl({ Key: validV2Key, Bucket: "another-caller-bucket" });

  assert.equal(url, "https://signed.example/thumbnail");
  assert.equal(v2Url, "https://signed.example/thumbnail");
  assert.equal(clients.length, 1);
  assert.equal(clients[0].options.endpoint, "https://s3.ap-southeast-1.wasabisys.com");
  assert.equal(clients[0].options.region, "ap-southeast-1");
  assert.deepEqual(clients[0].options.credentials, {
    accessKeyId: "synthetic-derived-read",
    secretAccessKey: "synthetic-derived-secret",
  });
  assert.equal(signed.length, 2);
  assert.equal(signed[0][0], clients[0]);
  assert.ok(signed[0][1] instanceof GetObjectCommand);
  assert.deepEqual(signed[0][1].input, {
    Bucket: "synthetic-derived",
    Key: validKey,
  });
  assert.deepEqual(signed[0][2], { expiresIn: 1800 });
  assert.ok(signed[1][1] instanceof GetObjectCommand);
  assert.deepEqual(signed[1][1].input, {
    Bucket: "synthetic-derived",
    Key: validV2Key,
  });
  assert.deepEqual(signed[1][2], { expiresIn: 1800 });
  assert.equal(sendCalls, 0);
  assert.deepEqual(Object.keys(require.cache).filter((modulePath) =>
    /(?:[\\/]node_modules[\\/]sharp[\\/]|[\\/]src[\\/](?:thumbnail[\\/](?:service|generate|backfill|production-backfill)|storage[\\/](?:wasabi|thumbnail-prd-backfill-wasabi))\.js$)/i.test(modulePath),
  ), []);
});

test("thumbnail signer rejects noncanonical versions, malformed keys, and mismatched shards", async () => {
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
    `v3/ab/${"ab"}${"0".repeat(62)}.webp`,
    `v1/aa/${"ab"}${"0".repeat(62)}.webp`,
    `v1/ab/${"0".repeat(64)}.webp`,
    `v2/AB/${"ab"}${"0".repeat(62)}.webp`,
    `v2/ab/${"AB"}${"0".repeat(62)}.webp`,
    `v2/ab/../${"ab"}${"0".repeat(62)}.webp`,
    `v2/ab/${"ab"}${"0".repeat(61)}.webp`,
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

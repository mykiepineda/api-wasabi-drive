const test = require("node:test");
const assert = require("node:assert/strict");
const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
const {
  createThumbnailWasabiStorage,
} = require("../src/storage/thumbnail-wasabi");

const makeStorage = () => {
  const requests = [];
  const clients = [];
  const storage = createThumbnailWasabiStorage({
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
    createClient: (options) => {
      const client = {
        options,
        async send(command) {
          requests.push({ client, command });
          return {
            Contents: [{
              Key: "pilot/nested/item.jpg",
              Size: 20,
              ETag: '"test-etag"',
              LastModified: new Date(),
              Metadata: { private: "not returned" },
            }],
            IsTruncated: false,
            NextContinuationToken: "not returned",
          };
        },
      };
      clients.push(client);
      return client;
    },
  });
  return { storage, requests, clients };
};

test("source listing sends bounded prefix and resume parameters via the isolated TEST client", async () => {
  const { storage, requests, clients } = makeStorage();
  const page = await storage.listSourcePage({
    bucket: "wasabi-test-source",
    region: "ap-southeast-2",
    prefix: "pilot/nested/",
    maxKeys: 4,
    startAfter: "pilot/nested/previous.jpg",
  });

  assert.equal(requests.length, 1);
  assert.ok(requests[0].command instanceof ListObjectsV2Command);
  assert.deepEqual(requests[0].command.input, {
    Bucket: "wasabi-test-source",
    Prefix: "pilot/nested/",
    MaxKeys: 4,
    StartAfter: "pilot/nested/previous.jpg",
  });
  assert.equal(Object.hasOwn(requests[0].command.input, "Delimiter"), false);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].options.region, "ap-southeast-2");
  assert.equal(clients[0].options.endpoint, "https://s3.ap-southeast-2.wasabisys.com");
  assert.equal(clients[0].options.credentials.accessKeyId, "test-access");
  assert.deepEqual(page, {
    IsTruncated: false,
    Contents: [{ Key: "pilot/nested/item.jpg", Size: 20, ETag: '"test-etag"' }],
  });
});

test("invalid source listing parameters fail closed without sending an S3 command", async (t) => {
  const { storage, requests } = makeStorage();
  const base = {
    bucket: "wasabi-test-source",
    region: "ap-southeast-2",
    prefix: "pilot/",
    maxKeys: 1,
  };
  const invalid = [
    { prefix: undefined },
    { prefix: "" },
    { prefix: "private/" },
    { prefix: "pilot/../" },
    { prefix: "pilot//nested/" },
    { prefix: "pilot\\nested\\" },
    { maxKeys: 0 },
    { maxKeys: -1 },
    { maxKeys: 11 },
    { maxKeys: 1.5 },
    { maxKeys: undefined },
    { startAfter: "" },
    { startAfter: "outside/key.jpg" },
    { startAfter: 4 },
  ];
  for (const overrides of invalid) {
    await t.test(JSON.stringify(overrides), async () => {
      await assert.rejects(
        storage.listSourcePage({ ...base, ...overrides }),
        (error) => error.name === "ThumbnailStorageError",
      );
      assert.equal(requests.length, 0);
    });
  }
});

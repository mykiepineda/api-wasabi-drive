const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const {
  MAX_SOURCE_BYTES,
  ThumbnailStorageError,
  createThumbnailWasabiStorage,
  endpointForRegion,
  validateWasabiRegion,
} = require("../src/storage/thumbnail-wasabi");

const makeStorage = (handler) => {
  const clients = [];
  const requests = [];
  const storage = createThumbnailWasabiStorage({
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    createClient: (options) => {
      const client = {
        options,
        async send(command) {
          requests.push({ client, command });
          return handler(command, client);
        },
      };
      clients.push(client);
      return client;
    },
  });
  return { storage, clients, requests };
};

const providerError = (name, status) => Object.assign(new Error("private provider detail"), {
  name,
  $metadata: { httpStatusCode: status },
});

test("storage clients are isolated by validated source and destination regions", async () => {
  const { storage, clients } = makeStorage(() => ({ ETag: '"test-etag"', ContentLength: 17 }));

  await storage.headSource({ bucket: "test-source", key: "image.jpg", region: "ap-southeast-2" });
  await storage.headDerived({ bucket: "test-derived", key: "v1/ab/hash.webp", region: "eu-west-1" });

  assert.equal(clients.length, 2);
  assert.deepEqual(clients.map(({ options }) => options.region), ["ap-southeast-2", "eu-west-1"]);
  assert.deepEqual(clients.map(({ options }) => options.endpoint), [
    endpointForRegion("ap-southeast-2"),
    endpointForRegion("eu-west-1"),
  ]);
  assert.equal(clients[0].options.credentials.accessKeyId, "test-access-key");
  assert.throws(() => validateWasabiRegion("prd"), { code: "invalid-region" });
});

test("source HEAD returns only ETag and size; malformed source metadata is not normalized away", async () => {
  const { storage } = makeStorage(() => ({ ETag: '"not-analyzed"', ContentLength: 0 }));
  assert.deepEqual(await storage.headSource({
    bucket: "test-source",
    key: "zero.jpg",
    region: "ap-southeast-2",
  }), { etag: '"not-analyzed"', size: 0 });
});

test("derived HEAD treats explicit missing keys as absent but never hides forbidden or ambiguous 404", async () => {
  let currentError = providerError("NotFound", 404);
  const { storage } = makeStorage(() => {
    if (currentError) {
      throw currentError;
    }
    return {};
  });

  assert.equal(await storage.headDerived({
    bucket: "test-derived",
    key: "v1/ab/hash.webp",
    region: "ap-southeast-2",
  }), false);

  currentError = providerError("AccessDenied", 403);
  await assert.rejects(
    storage.headDerived({ bucket: "test-derived", key: "key", region: "ap-southeast-2" }),
    { code: "provider-failure" },
  );
  currentError = providerError("InternalServerError", 404);
  await assert.rejects(
    storage.headDerived({ bucket: "test-derived", key: "key", region: "ap-southeast-2" }),
    { code: "provider-failure" },
  );

  currentError = Object.assign(new Error("timeout detail"), { code: "ETIMEDOUT" });
  await assert.rejects(
    storage.headDerived({ bucket: "test-derived", key: "key", region: "ap-southeast-2" }),
    { code: "provider-failure" },
  );
});

test("conditional source GET sends IfMatch and validates response identity and size", async () => {
  const input = Buffer.from("image source");
  const { storage, requests } = makeStorage((command) => {
    if (command instanceof GetObjectCommand) {
      return {
        ETag: '"etag-a"',
        ContentLength: input.length,
        Body: Readable.from([input.subarray(0, 4), input.subarray(4)]),
      };
    }
    throw new Error("unexpected command");
  });

  const bytes = await storage.getSourceBuffer({
    bucket: "test-source",
    key: "photo.jpg",
    region: "ap-southeast-2",
    etag: '"etag-a"',
    size: input.length,
  });

  assert.deepEqual(bytes, input);
  assert.deepEqual(requests[0].command.input, {
    Bucket: "test-source",
    Key: "photo.jpg",
    IfMatch: '"etag-a"',
  });
});

test("conditional source GET rejects ETag mismatch and unsupported conditions without falling back", async () => {
  let bodyRead = false;
  let currentError;
  const { storage, requests } = makeStorage((command) => {
    if (currentError) {
      throw currentError;
    }
    return {
      ETag: '"different"',
      ContentLength: 3,
      Body: Readable.from((async function* body() {
        bodyRead = true;
        yield Buffer.from("old");
      }())),
    };
  });
  const params = {
    bucket: "test-source",
    key: "photo.jpg",
    region: "ap-southeast-2",
    etag: '"expected"',
    size: 3,
  };

  await assert.rejects(storage.getSourceBuffer(params), { code: "etag-mismatch" });
  assert.equal(bodyRead, false);

  currentError = providerError("NotImplemented", 501);
  await assert.rejects(storage.getSourceBuffer(params), { code: "precondition-unsupported" });
  currentError = providerError("InvalidRequest", 400);
  await assert.rejects(storage.getSourceBuffer(params), { code: "precondition-unsupported" });
  assert.equal(requests.every(({ command }) => command.input.IfMatch === '"expected"'), true);
});

test("bounded streaming read stops and destroys the response when actual bytes exceed the cap", async () => {
  for (const contentLength of [undefined, MAX_SOURCE_BYTES]) {
    let destroyed = false;
    let chunksEmitted = 0;
    const body = new Readable({
      read() {
        if (chunksEmitted < 2) {
          chunksEmitted += 1;
          this.push(Buffer.alloc(chunksEmitted === 1 ? MAX_SOURCE_BYTES : 1));
        } else {
          this.push(null);
        }
      },
      destroy(error, callback) {
        destroyed = true;
        callback(error);
      },
    });
    const { storage } = makeStorage(() => ({
      ETag: '"etag-a"',
      ContentLength: contentLength,
      Body: body,
    }));

    await assert.rejects(storage.getSourceBuffer({
      bucket: "test-source",
      key: "photo.jpg",
      region: "ap-southeast-2",
      etag: '"etag-a"',
      size: MAX_SOURCE_BYTES,
    }), { code: "source-too-large" });
    assert.equal(destroyed, true);
  }
});

test("derived PUT is conditional, writes only WebP to the destination, and never mutates sources", async () => {
  const image = Buffer.from("webp output");
  const { storage, requests } = makeStorage(() => ({}));

  await storage.putDerived({
    bucket: "test-derived",
    key: "v1/ab/hashed.webp",
    region: "eu-west-1",
    body: image,
  });

  const [{ command }] = requests;
  assert.ok(command instanceof PutObjectCommand);
  assert.deepEqual(command.input, {
    Bucket: "test-derived",
    Key: "v1/ab/hashed.webp",
    Body: image,
    ContentType: "image/webp",
    IfNoneMatch: "*",
  });
  assert.equal(requests.some(({ command: item }) =>
    item instanceof PutObjectCommand && item.input.Bucket === "test-source"), false);
  assert.equal(requests.some(({ command: item }) =>
    item.constructor.name.includes("Delete") || item.constructor.name.includes("Copy")), false);
});

test("conditional create classifies already-exists races and unsupported preconditions distinctly", async () => {
  let currentError = providerError("PreconditionFailed", 412);
  const { storage } = makeStorage(() => {
    throw currentError;
  });
  const params = {
    bucket: "test-derived",
    key: "v1/ab/hashed.webp",
    region: "eu-west-1",
    body: Buffer.from("webp"),
  };

  await assert.rejects(storage.putDerived(params), { code: "already-exists" });
  currentError = providerError("NotImplemented", 501);
  await assert.rejects(storage.putDerived(params), { code: "precondition-unsupported" });
  currentError = providerError("InvalidRequest", 400);
  await assert.rejects(storage.putDerived(params), { code: "precondition-unsupported" });
});

test("source metadata length mismatch and provider timeouts fail without exposing provider errors", async () => {
  let currentError;
  let responseLength = 2;
  let includeLength = true;
  const { storage } = makeStorage(() => {
    if (currentError) {
      throw currentError;
    }
    return {
      ETag: '"etag-a"',
      ...(includeLength ? { ContentLength: responseLength } : {}),
      Body: Readable.from([Buffer.from("ab")]),
    };
  });
  const params = {
    bucket: "test-source",
    key: "photo.jpg",
    region: "ap-southeast-2",
    etag: '"etag-a"',
    size: 3,
  };

  await assert.rejects(storage.getSourceBuffer(params), { code: "source-size-mismatch" });
  responseLength = undefined;
  includeLength = false;
  await assert.rejects(storage.getSourceBuffer(params), { code: "source-size-mismatch" });
  currentError = Object.assign(new Error("secret provider detail"), { code: "ETIMEDOUT" });
  await assert.rejects(storage.headSource({
    bucket: "test-source",
    key: "photo.jpg",
    region: "ap-southeast-2",
  }), (error) => {
    assert.equal(error.code, "provider-failure");
    assert.equal(error.message.includes("secret provider detail"), false);
    return true;
  });
});

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const http = require("node:http");
const express = require("express");
const { StorageProviderError } = require("../src/errors");

const wasabiPath = require.resolve("../src/storage/wasabi");
const originalLoad = Module._load;
const responses = [];
const locationResponses = [];
const requests = [];
const signedUrlRequests = [];
const commandFailures = new Map();
let signingFailure;

class ListBucketsCommand {
  constructor(input) {
    this.input = input;
  }
}

class GetObjectCommand {
  constructor(input) {
    this.input = input;
  }
}

class GetBucketLocationCommand {
  constructor(input) {
    this.input = input;
  }
}

class ListObjectsV2Command {
  constructor(input) {
    this.input = input;
  }
}

class S3ServiceException extends Error {}

class S3Client {
  constructor(options) {
    this.options = options;
  }

  send(command) {
    requests.push({ client: this, command });
    if (commandFailures.has(command.constructor)) {
      const failure = commandFailures.get(command.constructor);
      commandFailures.delete(command.constructor);
      return Promise.reject(failure);
    }
    if (command instanceof ListBucketsCommand) {
      return Promise.resolve({ Buckets: [] });
    }
    if (command instanceof GetBucketLocationCommand) {
      const response = locationResponses.shift();
      return response ? response() : Promise.resolve({ LocationConstraint: "us-east-2" });
    }
    return Promise.resolve(responses.shift());
  }
}

const getSignedUrl = (client, command, options) => {
  signedUrlRequests.push({ client, command, options });
  if (signingFailure) {
    const failure = signingFailure;
    signingFailure = undefined;
    return Promise.reject(failure);
  }
  return Promise.resolve("https://example.test/fake-signed-object-url");
};

Module._load = function (request, parent, isMain) {
  if (request === "@aws-sdk/client-s3") {
    return {
      GetObjectCommand,
      GetBucketLocationCommand,
      ListBucketsCommand,
      ListObjectsV2Command,
      S3ServiceException,
      S3Client,
    };
  }
  if (request === "@aws-sdk/s3-request-presigner") {
    return { getSignedUrl };
  }
  if (request.endsWith("/config")) {
    return {
      wasabi: {
        serviceUrl: "https://example.test",
        region: "us-east-2",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        objectAccessUrlExpiresIn: 3600,
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const wasabi = require(wasabiPath);
Module._load = originalLoad;
const storageRouter = require("../src/api/buckets");
const errorHandler = require("../src/api/errorHandler");

test.after(() => {
  delete require.cache[wasabiPath];
});

test.beforeEach(() => {
  responses.length = 0;
  locationResponses.length = 0;
  requests.length = 0;
  signedUrlRequests.length = 0;
  commandFailures.clear();
  signingFailure = undefined;
});

const requestThroughStorageRoute = (path) => {
  const app = express();
  app.use("/buckets", storageRouter);
  app.use(errorHandler);

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      http.get({
        hostname: "127.0.0.1",
        port: server.address().port,
        path,
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          server.close((error) => {
            if (error) return reject(error);
            resolve({
              status: response.statusCode,
              body: Buffer.concat(chunks).toString(),
            });
          });
        });
      }).on("error", reject);
    });
    server.on("error", reject);
  });
};

test("getListObjects maps request parameters for S3", async () => {
  responses.push({ KeyCount: 0 });

  await wasabi.getListObjects({
    Bucket: "same-region-documents",
    Prefix: "reports/",
    MaxKeys: 25,
    ContinuationToken: "token",
  });

  const listRequest = requests.find(({ command }) => command instanceof ListObjectsV2Command);
  assert.deepEqual(listRequest.command.input, {
    Bucket: "same-region-documents",
    Delimiter: "/",
    Prefix: "reports/",
    MaxKeys: 25,
    ContinuationToken: "token",
  });
  assert.equal(listRequest.client.options.region, "us-east-2");
  assert.equal(listRequest.client.options.endpoint, "https://example.test");
});

test("getBucketRegion returns the region descriptions", async () => {
  assert.deepEqual(await wasabi.getBucketRegion("documents"), {
    region: "us-east-2",
    longDescription: "Wasabi US East 1 (N. Virginia)",
    shortDescription: "N. Virginia",
  });
});

test("getListBuckets delegates to the v3 client", async () => {
  assert.deepEqual(await wasabi.getListBuckets(), { Buckets: [] });
  assert.deepEqual(requests.map(({ command }) => command.input), [{}]);
});

test("getObjectAccessUrl signs a same-region object with the configured client", async () => {
  const result = await wasabi.getObjectAccessUrl({
    Bucket: "same-region-signed-documents",
    Key: "reports/file.txt",
  });

  assert.equal(result, "https://example.test/fake-signed-object-url");
  assert.equal(signedUrlRequests.length, 1);
  assert.ok(signedUrlRequests[0].command instanceof GetObjectCommand);
  assert.deepEqual(signedUrlRequests[0].command.input, {
    Bucket: "same-region-signed-documents",
    Key: "reports/file.txt",
  });
  assert.deepEqual(signedUrlRequests[0].options, { expiresIn: 3600 });
  assert.ok(signedUrlRequests[0].client instanceof S3Client);
  assert.equal(signedUrlRequests[0].client.options.region, "us-east-2");
  assert.equal(signedUrlRequests[0].client.options.endpoint, "https://example.test");
});

test("getBucketRegion maps null, undefined, and empty locations to us-east-1", async (t) => {
  for (const [index, locationConstraint] of [null, undefined, ""].entries()) {
    await t.test(`empty location ${index + 1}`, async () => {
      locationResponses.push(() => Promise.resolve({ LocationConstraint: locationConstraint }));
      assert.deepEqual(await wasabi.getBucketRegion(`empty-location-bucket-${index}`), {
        region: "us-east-1",
      });
    });
  }
});

test("getBucketRegion maps the legacy EU constraint and preserves explicit regions", async () => {
  locationResponses.push(
    () => Promise.resolve({ LocationConstraint: "EU" }),
    () => Promise.resolve({ LocationConstraint: "ap-southeast-2" }),
  );

  assert.deepEqual(await wasabi.getBucketRegion("legacy-eu-bucket"), {
    region: "eu-west-1",
    longDescription: "Wasabi EU West 1 (London)",
    shortDescription: "London",
  });
  assert.deepEqual(await wasabi.getBucketRegion("explicit-region-bucket"), {
    region: "ap-southeast-2",
    longDescription: "Wasabi AP Southeast 2 (Sydney)",
    shortDescription: "Sydney",
  });
});

test("Wasabi 307 redirect resolves the regional client for listing and signed URLs, then reuses it", async () => {
  const redirect = Object.assign(new Error("Temporary redirect"), {
    name: "Error",
    Code: "TemporaryRedirect",
    $metadata: { httpStatusCode: 307 },
    Endpoint: "klaris-icloud.s3.ap-southeast-2.wasabisys.com",
  });
  locationResponses.push(() => Promise.reject(redirect));
  responses.push({ KeyCount: 0 });

  assert.deepEqual(await wasabi.getBucketRegion("klaris-icloud"), {
    region: "ap-southeast-2",
    longDescription: "Wasabi AP Southeast 2 (Sydney)",
    shortDescription: "Sydney",
  });
  await wasabi.getListObjects({ Bucket: "klaris-icloud" });
  await wasabi.getObjectAccessUrl({ Bucket: "klaris-icloud", Key: "photo.jpg" });

  const listRequest = requests.find(({ command }) => command instanceof ListObjectsV2Command);
  const regionalClient = listRequest.client;
  assert.deepEqual(regionalClient.options, {
    endpoint: "https://s3.ap-southeast-2.wasabisys.com",
    region: "ap-southeast-2",
    credentials: { accessKeyId: "access-key", secretAccessKey: "secret-key" },
  });
  assert.equal(signedUrlRequests[0].client, regionalClient);
  assert.equal(requests.filter(({ command }) => command instanceof GetBucketLocationCommand).length, 1);
});

test("getListObjects handles the first-operation Sydney redirect", async () => {
  const bucket = "first-list-klaris";
  const redirect = Object.assign(new Error("Temporary redirect"), {
    name: "TemporaryRedirect",
    $metadata: { httpStatusCode: 307 },
    Endpoint: `${bucket}.s3.ap-southeast-2.wasabisys.com`,
  });
  locationResponses.push(() => Promise.reject(redirect));
  responses.push({ KeyCount: 0 });

  assert.deepEqual(await wasabi.getListObjects({ Bucket: bucket }), { KeyCount: 0 });

  assert.deepEqual(requests.map(({ command }) => command.constructor), [
    GetBucketLocationCommand,
    ListObjectsV2Command,
  ]);
  const listRequest = requests.find(({ command }) => command instanceof ListObjectsV2Command);
  assert.equal(listRequest.client.options.region, "ap-southeast-2");
  assert.equal(listRequest.client.options.endpoint, "https://s3.ap-southeast-2.wasabisys.com");
});

test("US East 1 Wasabi redirect host forms resolve to the canonical regional client", async (t) => {
  const endpointForms = [
    (bucket) => `${bucket}.s3.us-east-1.wasabisys.com`,
    (bucket) => `${bucket}.s3.wasabisys.com`,
  ];

  for (const [index, endpointForBucket] of endpointForms.entries()) {
    await t.test(`endpoint form ${index + 1}`, async () => {
      const bucket = `us-east-one-bucket-${index}`;
      const redirect = Object.assign(new Error("Temporary redirect"), {
        name: "TemporaryRedirect",
        $metadata: { httpStatusCode: 307 },
        Endpoint: endpointForBucket(bucket),
      });
      locationResponses.push(() => Promise.reject(redirect));
      responses.push({ KeyCount: 0 });

      assert.deepEqual(await wasabi.getBucketRegion(bucket), { region: "us-east-1" });
      await wasabi.getListObjects({ Bucket: bucket });

      const listRequest = requests.find(({ command }) => command instanceof ListObjectsV2Command);
      assert.equal(listRequest.client.options.region, "us-east-1");
      assert.equal(listRequest.client.options.endpoint, "https://s3.us-east-1.wasabisys.com");
    });
  }
});

test("failed bucket-region lookup is retryable", async () => {
  const error = Object.assign(new Error("Storage unavailable"), {
    name: "ServiceUnavailable",
    $metadata: { httpStatusCode: 503 },
  });
  locationResponses.push(
    () => Promise.reject(error),
    () => Promise.resolve({ LocationConstraint: "ap-southeast-2" }),
  );

  await assert.rejects(
    wasabi.getBucketRegion("retryable-bucket"),
    (received) => received instanceof StorageProviderError && received.cause === error,
  );
  assert.deepEqual(await wasabi.getBucketRegion("retryable-bucket"), {
    region: "ap-southeast-2",
    longDescription: "Wasabi AP Southeast 2 (Sydney)",
    shortDescription: "Sydney",
  });
  assert.equal(requests.filter(({ command }) => command instanceof GetBucketLocationCommand).length, 2);
});

test("malformed and unrelated redirect errors are propagated", async (t) => {
  const errors = [
    Object.assign(new Error("Foreign endpoint"), {
      name: "TemporaryRedirect",
      $metadata: { httpStatusCode: 307 },
      Endpoint: "evil.example.test",
    }),
    Object.assign(new Error("Wrong status"), {
      name: "TemporaryRedirect",
      $metadata: { httpStatusCode: 301 },
      Endpoint: "documents.s3.ap-southeast-2.wasabisys.com",
    }),
  ];

  for (const [index, error] of errors.entries()) {
    await t.test(`error ${index + 1}`, async () => {
      locationResponses.push(() => Promise.reject(error));
      await assert.rejects(
        wasabi.getBucketRegion(`invalid-redirect-${index}`),
        (received) => received instanceof StorageProviderError && received.cause === error,
      );
    });
  }
});

test("SDK service failures retain their cause and fixed operation", async () => {
  const cause = Object.assign(new S3ServiceException("provider sentinel"), {
    $metadata: { httpStatusCode: 403 },
    status: 403,
    endpoint: "https://private-endpoint.test",
  });
  commandFailures.set(ListBucketsCommand, cause);

  await assert.rejects(wasabi.getListBuckets(), (error) => {
    assert.ok(error instanceof StorageProviderError);
    assert.equal(error.operation, "ListBuckets");
    assert.equal(error.cause, cause);
    assert.equal(error.status, undefined);
    assert.equal(error.endpoint, undefined);
    return true;
  });
});

test("GetBucketLocation and ListObjectsV2 terminal failures are wrapped at their SDK boundaries", async () => {
  const locationFailure = Object.assign(new Error("location secret"), {
    $metadata: { httpStatusCode: 503 },
  });
  commandFailures.set(GetBucketLocationCommand, locationFailure);
  await assert.rejects(
    wasabi.getBucketRegion("wrapped-location-failure"),
    (error) => error instanceof StorageProviderError &&
      error.operation === "GetBucketLocation" && error.cause === locationFailure,
  );

  locationResponses.push(() => Promise.resolve({ LocationConstraint: "us-east-2" }));
  const listFailure = Object.assign(new Error("list secret"), { code: "ECONNRESET" });
  commandFailures.set(ListObjectsV2Command, listFailure);
  await assert.rejects(
    wasabi.getListObjects({ Bucket: "wrapped-list-failure" }),
    (error) => error instanceof StorageProviderError &&
      error.operation === "ListObjectsV2" && error.cause === listFailure,
  );
});

test("known timeout, network, and DNS failures are wrapped but unknown errors are preserved", async () => {
  const failures = [
    Object.assign(new Error("timeout sentinel"), { name: "TimeoutError" }),
    Object.assign(new Error("connection sentinel"), { code: "ECONNREFUSED" }),
    Object.assign(new Error("DNS sentinel"), { code: "ENOTFOUND" }),
    Object.assign(new Error("retry sentinel"), { code: "EAI_AGAIN" }),
  ];
  for (const cause of failures) {
    commandFailures.set(ListBucketsCommand, cause);
    await assert.rejects(
      wasabi.getListBuckets(),
      (error) => error instanceof StorageProviderError && error.cause === cause,
    );
  }

  const unknownFailures = [
    Object.assign(new TypeError("programming sentinel"), { status: 503 }),
    Object.assign(new Error("configuration sentinel"), { statusCode: 502 }),
    Object.assign(new Error("metadata sentinel"), { $metadata: {} }),
  ];
  for (const failure of unknownFailures) {
    commandFailures.set(ListBucketsCommand, failure);
    await assert.rejects(wasabi.getListBuckets(), (received) => received === failure);
  }
});

test("provider failures map to safe 502 responses through the real route and handler", async () => {
  const secret = "storage-private-sentinel";
  const cause = Object.assign(new S3ServiceException(secret), {
    $metadata: { httpStatusCode: 403 },
    Endpoint: `https://${secret}.wasabisys.com`,
  });
  cause.stack += `\n${secret}`;
  commandFailures.set(ListBucketsCommand, cause);

  const logRecords = [];
  const originalConsoleError = console.error;
  console.error = (record) => logRecords.push(record);
  let response;
  try {
    response = await requestThroughStorageRoute("/buckets/");
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(response.body), { error: "Bad Gateway" });
  assert.equal(response.body.includes(secret), false);
  assert.deepEqual(logRecords.map((record) => JSON.parse(record)), [{
    category: "storage",
    status: 502,
    operation: "ListBuckets",
    providerStatus: 403,
  }]);
  assert.equal(logRecords.join(" ").includes(secret), false);
});

test("local signing failures remain safe 500 responses through the real route", async () => {
  const secret = "signed-url-private-sentinel";
  locationResponses.push(() => Promise.resolve({ LocationConstraint: "us-east-2" }));
  responses.push({ Contents: [{ Key: secret }], KeyCount: 1 });
  signingFailure = Object.assign(new TypeError(secret), {
    status: 403,
    statusCode: 403,
    endpoint: `https://${secret}.wasabisys.com`,
  });

  const logRecords = [];
  const originalConsoleError = console.error;
  console.error = (record) => logRecords.push(record);
  let response;
  try {
    response = await requestThroughStorageRoute("/buckets/signing-failure/objects/reports");
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.body), { error: "Internal Server Error" });
  assert.equal(response.body.includes(secret), false);
  assert.deepEqual(logRecords.map((record) => JSON.parse(record)), [
    { category: "application", status: 500 },
  ]);
  assert.equal(logRecords.join(" ").includes(secret), false);
});
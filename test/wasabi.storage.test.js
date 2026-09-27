const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const wasabiPath = require.resolve("../src/storage/wasabi");
const originalLoad = Module._load;
const responses = [];
const locationResponses = [];
const requests = [];
const signedUrlRequests = [];

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

class S3Client {
  constructor(options) {
    this.options = options;
  }

  send(command) {
    requests.push({ client: this, command });
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
  return Promise.resolve("https://example.test/fake-signed-object-url");
};

Module._load = function (request, parent, isMain) {
  if (request === "@aws-sdk/client-s3") {
    return {
      GetObjectCommand,
      GetBucketLocationCommand,
      ListBucketsCommand,
      ListObjectsV2Command,
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

test.after(() => {
  delete require.cache[wasabiPath];
});

test.beforeEach(() => {
  responses.length = 0;
  locationResponses.length = 0;
  requests.length = 0;
  signedUrlRequests.length = 0;
});

test("getListObjects maps request parameters for S3", async () => {
  responses.push({ KeyCount: 0 });

  await wasabi.getListObjects({
    Bucket: "same-region-documents",
    Prefix: "reports/",
    MaxKeys: "25",
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

  await assert.rejects(wasabi.getBucketRegion("retryable-bucket"), (received) => received === error);
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
      await assert.rejects(wasabi.getBucketRegion(`invalid-redirect-${index}`), (received) => received === error);
    });
  }
});
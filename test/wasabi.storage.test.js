const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const wasabiPath = require.resolve("../src/storage/wasabi");
const originalLoad = Module._load;
const responses = [];
const requests = [];

class ListBucketsCommand {
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
    requests.push(command.input);
    if (command instanceof ListBucketsCommand) {
      return Promise.resolve({ Buckets: [] });
    }
    if (command instanceof GetBucketLocationCommand) {
      return Promise.resolve({ LocationConstraint: "us-east-2" });
    }
    return Promise.resolve(responses.shift());
  }
}

Module._load = function (request, parent, isMain) {
  if (request === "@aws-sdk/client-s3") {
    return {
      GetBucketLocationCommand,
      ListBucketsCommand,
      ListObjectsV2Command,
      S3Client,
    };
  }
  if (request.endsWith("/config")) {
    return {
      wasabi: {
        serviceUrl: "https://example.test",
        region: "us-east-2",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
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
  requests.length = 0;
});

test("getListObjects maps request parameters for S3", async () => {
  responses.push({ KeyCount: 0 });

  await wasabi.getListObjects({
    Bucket: "documents",
    Prefix: "reports/",
    MaxKeys: "25",
    ContinuationToken: "token",
  });

  assert.deepEqual(requests, [{
    Bucket: "documents",
    Delimiter: "/",
    Prefix: "reports/",
    MaxKeys: 25,
    ContinuationToken: "token",
  }]);
});

test("getBucketRegion returns the region descriptions", async () => {
  assert.deepEqual(await wasabi.getBucketRegion("documents"), {
    region: "us-east-2",
    longDescription: "Wasabi US East 1 (N. Virginia)",
    shortDescription: "N. Virginia",
  });
});

test("getTotalKeyCount sums paginated responses", async () => {
  responses.push(
    { IsTruncated: true, KeyCount: 2, NextContinuationToken: "next" },
    { IsTruncated: false, KeyCount: 3 },
  );

  assert.equal(await wasabi.getTotalKeyCount({
    Bucket: "documents",
    Prefix: "reports/",
  }), 5);
  assert.deepEqual(requests, [
    { Bucket: "documents", Delimiter: "/", Prefix: "reports/" },
    { Bucket: "documents", Delimiter: "/", ContinuationToken: "next" },
  ]);
});

test("getListBuckets delegates to the v3 client", async () => {
  assert.deepEqual(await wasabi.getListBuckets(), { Buckets: [] });
  assert.deepEqual(requests, [{}]);
});
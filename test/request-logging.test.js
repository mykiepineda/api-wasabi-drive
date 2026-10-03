const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const appPath = require.resolve("../src/app");
const configPath = require.resolve("../src/config");
const authPath = require.resolve("../src/authentication/requireEntraAccessToken");
const trustedPath = require.resolve("../src/authentication/requireTrustedUser");
const bucketsPath = require.resolve("../src/api/buckets");
const servicePath = require.resolve("../src/service/buckets");
const requestLoggerPath = require.resolve("../src/observability/requestLogger");
const { StorageProviderError } = require("../src/errors");

const originalEnvironment = { ...process.env };
const trustedUserObjectId = "11111111-2222-4222-8aaa-555555666666";

const clearModules = () => {
  for (const modulePath of [
    appPath,
    configPath,
    authPath,
    trustedPath,
    bucketsPath,
    servicePath,
    requestLoggerPath,
  ]) {
    delete require.cache[modulePath];
  }
};

const installStubs = ({
  bucketRouter,
  authStatus = 200,
  allowTrustedUser = true,
  bucketResponse = { Buckets: [] },
  serviceFailure,
} = {}) => {
  const bucketsService = {
    getListBuckets: async () => {
      if (serviceFailure) {
        throw serviceFailure;
      }
      return bucketResponse;
    },
    getBucketRegion: async (name) => ({ name, region: "us-east-1" }),
    getListObjects: async (params) => ({
      Name: params.Bucket,
      Prefix: params.Prefix,
      KeyCount: 0,
      Contents: [],
      CommonPrefixes: [],
      IsTruncated: false,
    }),
  };

  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: bucketsService,
  };

  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      createRequireEntraAccessToken: () => (req, res, next) => {
        const authorization = req.headers.authorization;
        if (authorization === "Bearer trusted-token") {
          req.auth = { oid: trustedUserObjectId, tid: "tenant-id" };
          return next();
        }

        if (authorization && authStatus === 200) {
          req.auth = { oid: "not-trusted-object-id", tid: "tenant-id" };
          return next();
        }

        if (authStatus === 401) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        if (authStatus === 403) {
          return res.status(403).json({ error: "Forbidden" });
        }

        return res.status(401).json({ error: "Unauthorized" });
      },
    },
  };

  require.cache[trustedPath] = {
    id: trustedPath,
    filename: trustedPath,
    loaded: true,
    exports: {
      createRequireTrustedUser: () => (req, res, next) => {
        const ok = allowTrustedUser && req.auth?.oid === trustedUserObjectId;
        return ok ? next() : res.status(403).json({ error: "Forbidden" });
      },
    },
  };

  if (bucketRouter) {
    require.cache[bucketsPath] = {
      id: bucketsPath,
      filename: bucketsPath,
      loaded: true,
      exports: bucketRouter,
    };
  }
};

const request = (app, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const requestBody = http.get(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path,
          headers,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            server.close((closeError) => {
              if (closeError) {
                reject(closeError);
                return;
              }
              resolve({
                statusCode: response.statusCode,
                body: Buffer.concat(chunks).toString(),
              });
            });
          });
        },
      );
      requestBody.on("error", reject);
    });
    server.on("error", reject);
  });

const captureLogs = async (callback) => {
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  const records = [];

  console.log = (value) => records.push(value);
  console.warn = (value) => records.push(value);
  console.error = (value) => records.push(value);

  try {
    const result = await callback();
    return { result, records };
  } finally {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  }
};

const parseRecords = (records) =>
  records
    .filter((value) => typeof value === "string")
    .map((value) => JSON.parse(value));

const loadApp = (override = undefined) => {
  Object.assign(process.env, {
    ENTRA_TENANT_ID: "tenant-id",
    ENTRA_API_CLIENT_ID: "api-client-id",
    ENTRA_REQUIRED_SCOPE: "WasabiDrive.Access",
    ENTRA_TRUSTED_USER_OBJECT_IDS: trustedUserObjectId,
  });
  clearModules();
  if (override) {
    installStubs(override);
  }
  return require(appPath);
};

test.afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnvironment);
  clearModules();
});

test("successful request emits a single structured completion record", async () => {
  process.env.DEPLOYMENT_STAGE = "test";
  process.env.RELEASE_SHA = "0123456789abcdef0123456789abcdef01234567";

  const express = require("express");
  const bucketRouter = express.Router();
  bucketRouter.get("/", (req, res) => res.json({ Buckets: [] }));
  const app = loadApp({ bucketRouter, authStatus: 200, allowTrustedUser: true });

  const { records } = await captureLogs(async () => {
    const response = await request(app, "/buckets", {
      Authorization: "Bearer trusted-token",
    });
    assert.equal(response.statusCode, 200);
  });

  const payload = parseRecords(records).at(-1);
  assert.equal(payload.level, "info");
  assert.equal(payload.method, "GET");
  assert.equal(payload.route, "/buckets");
  assert.equal(payload.operation, "listBuckets");
  assert.equal(payload.status, 200);
  assert.ok(Number.isInteger(payload.durationMs) && payload.durationMs >= 0);
  assert.equal(payload.stage, "test");
  assert.equal(payload.releaseSha, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(payload.requestId, undefined);
  assert.equal(parseRecords(records).length, 1);
});

test("Lambda requestId is forwarded through the serverless request hook", async () => {
  process.env.DEPLOYMENT_STAGE = "prd";
  process.env.RELEASE_SHA = "fedcba9876543210fedcba9876543210fedcba98";

  const express = require("express");
  const bucketRouter = express.Router();
  bucketRouter.get("/", (req, res) => res.json({ Buckets: [] }));
  const app = loadApp({ bucketRouter, authStatus: 200, allowTrustedUser: true });

  const { handler } = app;
  const records = [];
  const originalLog = console.log;
  console.log = (value) => records.push(value);

  try {
    const response = await handler(
      {
        path: "/buckets",
        httpMethod: "GET",
        headers: { authorization: "Bearer trusted-token" },
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        body: null,
        isBase64Encoded: false,
        requestContext: { identity: { sourceIp: "127.0.0.1" } },
      },
      { awsRequestId: "lambda-request-123" },
    );
    assert.equal(response.statusCode, 200);
  } finally {
    console.log = originalLog;
  }

  const payload = JSON.parse(records.at(-1));
  assert.equal(payload.requestId, "lambda-request-123");
  assert.equal(payload.route, "/buckets");
  assert.equal(payload.operation, "listBuckets");
});

test("auth failures and storage failures keep the correct safe categories and metadata", async () => {
  process.env.DEPLOYMENT_STAGE = "test";
  process.env.RELEASE_SHA = "abcdef0123456789abcdef0123456789abcdef01";

  const express = require("express");
  const bucketRouter401 = express.Router();
  bucketRouter401.get("/", (req, res) => res.json({ Buckets: [] }));
  const appWith401 = loadApp({ bucketRouter: bucketRouter401, authStatus: 401, allowTrustedUser: true });

  const record401 = await captureLogs(async () => {
    const response = await request(appWith401, "/buckets");
    assert.equal(response.statusCode, 401);
  });

  const bucketRouter403 = express.Router();
  bucketRouter403.get("/", (req, res) => res.json({ Buckets: [] }));
  const appWith403 = loadApp({ bucketRouter: bucketRouter403, authStatus: 200, allowTrustedUser: false });

  const record403 = await captureLogs(async () => {
    const response = await request(appWith403, "/buckets", {
      Authorization: "Bearer untrusted-token",
    });
    assert.equal(response.statusCode, 403);
  });

  const bucketRouter502 = express.Router();
  bucketRouter502.get("/", (req, res, next) => {
    next(
      new StorageProviderError("ListBuckets", {
        $metadata: { httpStatusCode: 403 },
      }),
    );
  });
  const appWith502 = loadApp({ bucketRouter: bucketRouter502, authStatus: 200, allowTrustedUser: true });

  const record502 = await captureLogs(async () => {
    const response = await request(appWith502, "/buckets", {
      Authorization: "Bearer trusted-token",
    });
    assert.equal(response.statusCode, 502);
  });

  const authRecord = JSON.parse(record401.records.at(-1));
  const authzRecord = JSON.parse(record403.records.at(-1));
  const storageRecord = JSON.parse(record502.records.at(-1));

  assert.equal(authRecord.errorCategory, "authentication");
  assert.equal(authzRecord.errorCategory, "authorization");
  assert.equal(storageRecord.errorCategory, "storage");
  assert.equal(storageRecord.storageOperation, "ListBuckets");
  assert.equal(storageRecord.providerStatus, 403);
});

test("missing metadata does not break requests and the log omits raw values", async () => {
  delete process.env.DEPLOYMENT_STAGE;
  delete process.env.RELEASE_SHA;
  const express = require("express");
  const bucketRouter = express.Router();
  bucketRouter.get("/:Bucket/objects/:Prefix(*)", (req, res) => {
    res.json({ Name: req.params.Bucket, Prefix: req.params.Prefix, Contents: [] });
  });
  const app = loadApp({ bucketRouter, authStatus: 200, allowTrustedUser: true });

  const { records } = await captureLogs(async () => {
    const response = await request(app, "/buckets/documents/objects/reports?ContinuationToken=abc123&MaxKeys=10", {
      Authorization: "Bearer trusted-token",
    });
    assert.equal(response.statusCode, 200);
  });

  const payload = JSON.parse(records.at(-1));
  assert.equal(payload.route, "/buckets/:Bucket/objects/:Prefix(*)");
  assert.equal(payload.operation, "listObjects");
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("documents"), false);
  assert.equal(serialized.includes("reports"), false);
  assert.equal(serialized.includes("ContinuationToken"), false);
  assert.equal(serialized.includes("trusted-token"), false);
  assert.equal(serialized.includes("Authorization"), false);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("abc123"), false);
  assert.equal(payload.stage, undefined);
  assert.equal(payload.releaseSha, undefined);
});

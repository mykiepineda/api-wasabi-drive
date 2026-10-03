const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const appPath = require.resolve("../src/app");
const configPath = require.resolve("../src/config");
const bucketsApiPath = require.resolve("../src/api/buckets");
const servicePath = require.resolve("../src/service/buckets");
const accessTokenPath = require.resolve("../src/authentication/requireEntraAccessToken");
const trustedUserPath = require.resolve("../src/authentication/requireTrustedUser");
const parseMaxKeys = require("../src/api/parseMaxKeys");
const { InputValidationError } = require("../src/errors");
const originalEnvironment = { ...process.env };
const trustedObjectId = "11111111-2222-4222-8aaa-555555666666";

let serviceCalls;
let serviceFailure;
let receivedParams;

const clearModules = () => {
  for (const modulePath of [
    appPath,
    configPath,
    bucketsApiPath,
    servicePath,
    accessTokenPath,
    trustedUserPath,
  ]) {
    delete require.cache[modulePath];
  }
};

const loadApp = () => {
  Object.assign(process.env, {
    ENTRA_TENANT_ID: "tenant-id",
    ENTRA_API_CLIENT_ID: "api-client-id",
    ENTRA_REQUIRED_SCOPE: "WasabiDrive.Access",
    ENTRA_TRUSTED_USER_OBJECT_IDS: trustedObjectId,
  });
  clearModules();
  serviceCalls = 0;
  serviceFailure = undefined;
  receivedParams = undefined;

  const service = {
    getListBuckets: async () => {
      serviceCalls += 1;
      if (serviceFailure) throw serviceFailure;
      return { Buckets: [] };
    },
    getBucketRegion: async () => {
      serviceCalls += 1;
      if (serviceFailure) throw serviceFailure;
      return { region: "us-east-1" };
    },
    getListObjects: async (params) => {
      serviceCalls += 1;
      receivedParams = params;
      if (serviceFailure) throw serviceFailure;
      return {
        Name: params.Bucket,
        Prefix: params.Prefix,
        KeyCount: 0,
        Contents: [],
        CommonPrefixes: [],
        IsTruncated: false,
      };
    },
  };
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: service,
  };
  require.cache[accessTokenPath] = {
    id: accessTokenPath,
    filename: accessTokenPath,
    loaded: true,
    exports: {
      createRequireEntraAccessToken: () => (req, res, next) => {
        const authorization = req.headers.authorization;
        if (authorization === "Bearer verifier-failure") {
          return next(new Error("verifier private detail"));
        }
        if (authorization === "Bearer missing-scope") {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (authorization === "Bearer valid" || authorization === "Bearer untrusted") {
          req.auth = {
            oid: authorization === "Bearer valid" ? trustedObjectId : "untrusted",
            tid: "tenant-id",
          };
          return next();
        }
        return res.status(401).json({ error: "Unauthorized" });
      },
    },
  };
  require.cache[trustedUserPath] = {
    id: trustedUserPath,
    filename: trustedUserPath,
    loaded: true,
    exports: {
      createRequireTrustedUser: () => (req, res, next) =>
        req.auth?.oid === trustedObjectId
          ? next()
          : res.status(403).json({ error: "Forbidden" }),
    },
  };

  return require(appPath);
};

const request = (app, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const requestBody = body === undefined ? undefined : Buffer.from(body);
      const clientRequest = http.request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path,
          method,
          headers: {
            ...(requestBody ? { "Content-Length": requestBody.length } : {}),
            ...headers,
          },
        },
        (response) => {
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
        },
      );
      clientRequest.on("error", reject);
      if (requestBody) clientRequest.write(requestBody);
      clientRequest.end();
    });
    server.on("error", reject);
  });

const assertJsonResponse = (response, status, body) => {
  assert.equal(response.status, status);
  assert.deepEqual(JSON.parse(response.body), body);
};

test.afterEach(() => {
  for (const name of Object.keys(process.env)) {
    if (!(name in originalEnvironment)) delete process.env[name];
  }
  Object.assign(process.env, originalEnvironment);
  clearModules();
});

test("MaxKeys omission and supported values reach the real bucket router as numbers", async () => {
  const app = loadApp();
  const cases = [
    ["", undefined],
    ["1", 1],
    ["10", 10],
    ["25", 25],
    ["50", 50],
    ["100", 100],
    ["025", 25],
    ["1000", 1000],
  ];
  let expectedCalls = 0;

  for (const [query, expected] of cases) {
    const path = `/buckets/documents/objects/reports${query ? `?MaxKeys=${query}` : ""}`;
    const response = await request(app, path, { headers: { Authorization: "Bearer valid" } });
    expectedCalls += 1;
    assert.equal(response.status, 200);
    assert.equal(serviceCalls, expectedCalls);
    assert.equal(receivedParams.MaxKeys, expected);
    assert.deepEqual(JSON.parse(response.body), {
      Name: "documents",
      Prefix: "reports",
      KeyCount: 0,
      Contents: [],
      CommonPrefixes: [],
      IsTruncated: false,
    });
  }
});

test("invalid MaxKeys forms return the fixed 400 before service invocation", async () => {
  const app = loadApp();
  const invalidQueries = [
    "MaxKeys=",
    "MaxKeys=0",
    "MaxKeys=-1",
    "MaxKeys=1.5",
    "MaxKeys=1e2",
    "MaxKeys=0x10",
    "MaxKeys=25abc",
    "MaxKeys=1001",
    "MaxKeys=%20",
    "MaxKeys=%2025",
    "MaxKeys=25%20",
    "MaxKeys=%2B25",
    "MaxKeys=25.0",
    "MaxKeys=999999999999999999999999999999999999",
    "MaxKeys=10&MaxKeys=25",
    "MaxKeys%5B%5D=25",
    "MaxKeys%5Bvalue%5D=25",
  ];

  for (const query of invalidQueries) {
    const response = await request(app, `/buckets/documents/objects/reports?${query}`, {
      headers: { Authorization: "Bearer valid" },
    });
    assertJsonResponse(response, 400, {
      error: "MaxKeys must be an integer between 1 and 1000.",
    });
  }
  assert.equal(serviceCalls, 0);
});

test("authentication and authorization responses precede MaxKeys validation", async () => {
  const app = loadApp();
  for (const [authorization, expectedStatus, expectedBody] of [
    [undefined, 401, { error: "Unauthorized" }],
    ["Bearer missing-scope", 403, { error: "Forbidden" }],
    ["Bearer untrusted", 403, { error: "Forbidden" }],
  ]) {
    const response = await request(app, "/buckets/documents/objects/reports?MaxKeys=0", {
      headers: authorization ? { Authorization: authorization } : {},
    });
    assertJsonResponse(response, expectedStatus, expectedBody);
  }
  assert.equal(serviceCalls, 0);
});

test("unexpected errors and verifier failures are fixed 500 responses without leakage", async () => {
  const app = loadApp();
  const secret = "sentinel-private-error-value";
  serviceFailure = Object.assign(new Error(secret), {
    status: 400,
    statusCode: 403,
    endpoint: `https://${secret}.example.test`,
    body: secret,
  });
  serviceFailure.stack += `\n${secret}`;

  const captured = [];
  const originalConsoleError = console.error;
  console.error = (record) => captured.push(record);
  try {
    process.env.NODE_ENV = "development";
    const serviceResponse = await request(app, "/buckets", {
      headers: { Authorization: "Bearer valid" },
    });
    assertJsonResponse(serviceResponse, 500, { error: "Internal Server Error" });
    const verifierResponse = await request(app, "/buckets", {
      headers: { Authorization: "Bearer verifier-failure" },
    });
    assertJsonResponse(verifierResponse, 500, { error: "Internal Server Error" });
  } finally {
    console.error = originalConsoleError;
    if (originalEnvironment.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment.NODE_ENV;
  }

  assert.equal(captured.length, 2);
  const records = captured.map((record) => JSON.parse(record));
  assert.deepEqual(records.map(({ status, errorCategory, route, operation }) => ({ status, errorCategory, route, operation })), [
    { status: 500, errorCategory: "application", route: "/buckets", operation: "listBuckets" },
    { status: 500, errorCategory: "application", route: "/buckets", operation: "request" },
  ]);
  assert.equal(captured.join(" ").includes(secret), false);
});

test("parser errors, encoded route errors, health and unmatched routes retain safe contracts", async () => {
  const app = loadApp();
  const malformedJson = await request(app, "/health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assertJsonResponse(malformedJson, 400, { error: "Bad Request" });

  const oversizedBody = await request(app, "/health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "x".repeat(1024 * 1024),
  });
  assertJsonResponse(oversizedBody, 413, { error: "Payload Too Large" });

  const encodedRoute = await request(app, "/buckets/documents/objects/%E0%A4%A", {
    headers: { Authorization: "Bearer valid" },
  });
  assertJsonResponse(encodedRoute, 400, { error: "Bad Request" });

  const health = await request(app, "/health");
  assertJsonResponse(health, 200, { status: "ok" });
  const unmatched = await request(app, "/not-a-route");
  assert.equal(unmatched.status, 404);
});

test("final error handler delegates when headers have already been sent", () => {
  const errorHandler = require("../src/api/errorHandler");
  const error = new Error("private");
  let delegated;
  let sent = false;
  const response = {
    headersSent: true,
    status() {
      sent = true;
      return this;
    },
    json() {
      sent = true;
    },
  };

  errorHandler(error, {}, response, (received) => {
    delegated = received;
  });
  assert.equal(delegated, error);
  assert.equal(sent, false);
});

test("MaxKeys helper rejects every non-string query value shape", () => {
  for (const value of [null, true, false, 25, [], ["25"], {}, { value: "25" }]) {
    assert.throws(() => parseMaxKeys(value), InputValidationError);
  }
  assert.equal(parseMaxKeys(undefined), undefined);
});

test("framework parser compatibility is limited to the explicit type/status allowlist", () => {
  const errorHandler = require("../src/api/errorHandler");
  const cases = [
    ["entity.parse.failed", 400, 400, "Bad Request"],
    ["request.aborted", 400, 400, "Bad Request"],
    ["request.size.invalid", 400, 400, "Bad Request"],
    ["entity.too.large", 413, 413, "Payload Too Large"],
    ["parameters.too.many", 413, 413, "Payload Too Large"],
    ["charset.unsupported", 415, 415, "Unsupported Media Type"],
    ["encoding.unsupported", 415, 415, "Unsupported Media Type"],
  ];

  for (const [type, sourceStatus, expectedStatus, expectedMessage] of cases) {
    let actualStatus;
    let actualBody;
    const response = {
      headersSent: false,
      status(status) {
        actualStatus = status;
        return this;
      },
      json(body) {
        actualBody = body;
        return this;
      },
    };
    errorHandler(Object.assign(new Error("raw parser detail"), {
      type,
      status: sourceStatus,
    }), {}, response, assert.fail);
    assert.equal(actualStatus, expectedStatus);
    assert.deepEqual(actualBody, { error: expectedMessage });
  }

  for (const error of [
    Object.assign(new Error("spoofed"), { status: 400 }),
    Object.assign(new Error("wrong parser status"), {
      type: "entity.parse.failed",
      status: 403,
    }),
  ]) {
    let actualStatus;
    const response = {
      headersSent: false,
      status(status) {
        actualStatus = status;
        return this;
      },
      json() {
        return this;
      },
    };
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      errorHandler(error, {}, response, assert.fail);
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(actualStatus, 500);
  }
});
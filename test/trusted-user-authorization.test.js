const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const trustedUserObjectId = "11111111-2222-4222-8aaa-555555666666";
const alternateTrustedUserObjectId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const originalEnvironment = { ...process.env };

Object.assign(process.env, {
  ENTRA_TENANT_ID: "tenant-id",
  ENTRA_API_CLIENT_ID: "api-client-id",
  ENTRA_REQUIRED_SCOPE: "WasabiDrive.Access",
  ENTRA_TRUSTED_USER_OBJECT_IDS: trustedUserObjectId,
});

const configPath = require.resolve("../src/config");
const { createRequireTrustedUser } = require("../src/authentication/requireTrustedUser");
const { createRequireEntraAccessToken } = require("../src/authentication/requireEntraAccessToken");

const createResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const parseTrustedIds = (value, strict = false) => {
  const config = require(configPath);
  return config.parseTrustedUserObjectIds(value, { strict });
};

test("trusted authenticated user is allowed to continue", async () => {
  const middleware = createRequireTrustedUser([trustedUserObjectId], "tenant-id");
  const req = {
    auth: {
      oid: trustedUserObjectId,
      tid: "tenant-id",
    },
  };
  const res = createResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
});

test("authenticated but untrusted user receives 403", async () => {
  const middleware = createRequireTrustedUser([trustedUserObjectId], "tenant-id");
  const req = {
    auth: {
      oid: "33333333-4444-4aaa-8bbb-777777777777",
      tid: "tenant-id",
    },
  };
  const res = createResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Forbidden" });
  assert.equal(nextCalled, false);
});

test("authenticated token missing oid receives 403", async () => {
  const middleware = createRequireTrustedUser([trustedUserObjectId], "tenant-id");
  const req = {
    auth: {
      tid: "tenant-id",
    },
  };
  const res = createResponse();

  await middleware(req, res, () => {
    throw new Error("next was called");
  });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Forbidden" });
});

test("tenant mismatch or missing tenant identity is forbidden", async () => {
  const middleware = createRequireTrustedUser([trustedUserObjectId], "tenant-id");

  for (const auth of [
    { oid: trustedUserObjectId },
    { oid: trustedUserObjectId, tid: "other-tenant" },
  ]) {
    const res = createResponse();

    await middleware({ auth }, res, () => {
      throw new Error("next was called");
    });

    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "Forbidden" });
  }
});

test("multiple comma-separated trusted Object IDs are parsed correctly", () => {
  assert.deepEqual(
    parseTrustedIds(`${trustedUserObjectId}, ${alternateTrustedUserObjectId}, ${trustedUserObjectId.toUpperCase()}`),
    [trustedUserObjectId, alternateTrustedUserObjectId],
  );
});

test("whitespace and case normalization works", () => {
  assert.deepEqual(
    parseTrustedIds(
      `  ${trustedUserObjectId.toUpperCase()} , \n${alternateTrustedUserObjectId} , ${trustedUserObjectId} `,
    ),
    [trustedUserObjectId, alternateTrustedUserObjectId],
  );
});

test("missing trusted-user allow-list fails closed", () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [
        "-e",
        "process.env.ENTRA_TENANT_ID = 'tenant-id'; process.env.ENTRA_API_CLIENT_ID = 'api-client-id'; process.env.ENTRA_REQUIRED_SCOPE = 'WasabiDrive.Access'; delete process.env.ENTRA_TRUSTED_USER_OBJECT_IDS; require('./src/config');",
      ], {
        cwd: require("node:process").cwd(),
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
      }),
    /Missing ENTRA_TRUSTED_USER_OBJECT_IDS configuration/,
  );
});

test("empty trusted-user allow-list fails closed", () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [
        "-e",
        "process.env.ENTRA_TENANT_ID = 'tenant-id'; process.env.ENTRA_API_CLIENT_ID = 'api-client-id'; process.env.ENTRA_REQUIRED_SCOPE = 'WasabiDrive.Access'; process.env.ENTRA_TRUSTED_USER_OBJECT_IDS = ' ,  '; require('./src/config');",
      ], {
        cwd: require("node:process").cwd(),
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
      }),
    /Missing ENTRA_TRUSTED_USER_OBJECT_IDS configuration/,
  );
});

test("malformed trusted-user allow-list fails closed", () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [
        "-e",
        "process.env.ENTRA_TENANT_ID = 'tenant-id'; process.env.ENTRA_API_CLIENT_ID = 'api-client-id'; process.env.ENTRA_REQUIRED_SCOPE = 'WasabiDrive.Access'; process.env.ENTRA_TRUSTED_USER_OBJECT_IDS = 'not-a-guid, valid-guid'; require('./src/config');",
      ], {
        cwd: require("node:process").cwd(),
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
      }),
    /Invalid ENTRA_TRUSTED_USER_OBJECT_IDS value/,
  );
});

test("authentication executes before authorization", async () => {
  const authMiddleware = createRequireEntraAccessToken(async () => ({
    oid: trustedUserObjectId,
    tid: "tenant-id",
    scp: "WasabiDrive.Access",
  }));
  const trustedUserMiddleware = createRequireTrustedUser([trustedUserObjectId], "tenant-id");
  const req = { headers: { authorization: "Bearer valid-token" } };
  const res = createResponse();

  let authRan = false;
  let authzRan = false;

  await authMiddleware(req, res, async () => {
    authRan = true;
    await trustedUserMiddleware(req, res, () => {
      authzRan = true;
    });
  });

  assert.equal(authRan, true);
  assert.equal(authzRan, true);
  assert.equal(req.auth.oid, trustedUserObjectId);
  assert.equal(res.statusCode, 200);
});

test("parseTrustedUserObjectIds ignores malformed values when strict is false", () => {
  assert.deepEqual(
    parseTrustedIds(`not-a-guid, ${trustedUserObjectId}, BAD , ${alternateTrustedUserObjectId}`),
    [trustedUserObjectId, alternateTrustedUserObjectId],
  );
});

test("strict parsing rejects malformed values", () => {
  assert.throws(
    () => parseTrustedIds(`not-a-guid, ${trustedUserObjectId}`, true),
    /Invalid ENTRA_TRUSTED_USER_OBJECT_IDS value/,
  );
});


test.after(() => {
  for (const name of Object.keys(process.env)) {
    if (!(name in originalEnvironment)) {
      delete process.env[name];
    }
  }

  Object.assign(process.env, originalEnvironment);
  delete require.cache[configPath];
});

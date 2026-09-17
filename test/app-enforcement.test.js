const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const configPath = require.resolve("../src/config");
const appPath = require.resolve("../src/app");
const bucketsApiPath = require.resolve("../src/api/buckets");
const requireEntraAccessTokenPath = require.resolve(
  "../src/authentication/requireEntraAccessToken",
);
const requireTrustedUserPath = require.resolve(
  "../src/authentication/requireTrustedUser",
);

const originalEnvironment = { ...process.env };
const trustedUserObjectId = "11111111-2222-4222-8aaa-555555666666";
const untrustedUserObjectId = "33333333-4444-4aaa-8bbb-777777777777";
const tenantId = "tenant-id";

const setRequiredEntraEnvironment = () => {
  Object.assign(process.env, {
    ENTRA_TENANT_ID: tenantId,
    ENTRA_API_CLIENT_ID: "api-client-id",
    ENTRA_REQUIRED_SCOPE: "WasabiDrive.Access",
    ENTRA_TRUSTED_USER_OBJECT_IDS: trustedUserObjectId,
  });
};

const clearApplicationModules = () => {
  delete require.cache[appPath];
  delete require.cache[configPath];
  delete require.cache[requireEntraAccessTokenPath];
  delete require.cache[requireTrustedUserPath];
};

const clearRouterModules = () => {
  delete require.cache[bucketsApiPath];
};

const installRouterStubs = () => {
  const express = require("express");
  const bucketRouter = express.Router();
  require.cache[bucketsApiPath] = {
    id: bucketsApiPath,
    filename: bucketsApiPath,
    loaded: true,
    exports: bucketRouter,
  };

  return { bucketRouter };
};

const installAccessTokenStub = () => {
  require.cache[requireEntraAccessTokenPath] = {
    id: requireEntraAccessTokenPath,
    filename: requireEntraAccessTokenPath,
    loaded: true,
    exports: {
      createRequireEntraAccessToken: () => (req, res, next) => {
        const authorization = req.headers?.authorization;
        if (authorization === "Bearer trusted-token") {
          req.auth = { oid: trustedUserObjectId, tid: tenantId };
          return next();
        }

        if (authorization === "Bearer untrusted-token") {
          req.auth = { oid: untrustedUserObjectId, tid: tenantId };
          return next();
        }

        return res.status(401).json({ error: "Unauthorized" });
      },
    },
  };
};

const restoreEnvironment = () => {
  for (const name of Object.keys(process.env)) {
    if (!(name in originalEnvironment)) {
      delete process.env[name];
    }
  }

  Object.assign(process.env, originalEnvironment);
  clearApplicationModules();
  clearRouterModules();
};

const requestStatus = (app, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const request = require("node:http").get(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path,
          headers,
        },
        (response) => {
          response.resume();
          response.on("end", () => {
            server.close();
            resolve(response.statusCode);
          });
        },
      );
      request.on("error", reject);
    });
    server.on("error", reject);
  });

test.afterEach(restoreEnvironment);

for (const [name, environmentValue] of [
  ["absent", undefined],
  ["false", "false"],
  ["invalid legacy value", "enabled"],
]) {
  test(`legacy ENTRA_AUTH_ENABLED ${name} cannot disable bucket authentication`, async () => {
    setRequiredEntraEnvironment();
    if (environmentValue === undefined) {
      delete process.env.ENTRA_AUTH_ENABLED;
    } else {
      process.env.ENTRA_AUTH_ENABLED = environmentValue;
    }
    clearApplicationModules();
    clearRouterModules();
    installAccessTokenStub();

    const { bucketRouter } = installRouterStubs();
    let storageCalled = false;
    bucketRouter.get("/", (req, res) => {
      storageCalled = true;
      res.json({ buckets: [] });
    });

    const response = await requestStatus(require(appPath), "/buckets");

    assert.equal(response, 401);
    assert.equal(storageCalled, false);
  });
}

test("valid trusted bearer token reaches the bucket route", async () => {
  setRequiredEntraEnvironment();
  clearApplicationModules();
  clearRouterModules();
  installAccessTokenStub();

  const { bucketRouter } = installRouterStubs();
  let storageCalled = false;
  bucketRouter.get("/", (req, res) => {
    storageCalled = true;
    res.json({ buckets: [] });
  });

  const response = await requestStatus(require(appPath), "/buckets", {
    Authorization: "Bearer trusted-token",
  });

  assert.equal(response, 200);
  assert.equal(storageCalled, true);
});

test("authenticated but untrusted bearer token is rejected before storage", async () => {
  setRequiredEntraEnvironment();
  clearApplicationModules();
  clearRouterModules();
  installAccessTokenStub();

  const { bucketRouter } = installRouterStubs();
  let storageCalled = false;
  bucketRouter.get("/", (req, res) => {
    storageCalled = true;
    res.json({ buckets: [] });
  });

  const response = await requestStatus(require(appPath), "/buckets", {
    Authorization: "Bearer untrusted-token",
  });

  assert.equal(response, 403);
  assert.equal(storageCalled, false);
});

test("legacy auth router has no application mount path", async () => {
  setRequiredEntraEnvironment();
  clearApplicationModules();
  clearRouterModules();
  installAccessTokenStub();

  installRouterStubs();

  const response = await requestStatus(require(appPath), "/auth/probe");

  assert.equal(response, 404);
});

test("missing required Entra verifier configuration fails closed", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          "-e",
          `process.env.ENTRA_TRUSTED_USER_OBJECT_IDS = '${trustedUserObjectId}'; delete process.env.ENTRA_TENANT_ID; delete process.env.ENTRA_API_CLIENT_ID; delete process.env.ENTRA_REQUIRED_SCOPE; require('./src/authentication/entraTokenVerifier').createConfiguredEntraTokenVerifier();`,
        ],
        {
          cwd: require("node:process").cwd(),
          encoding: "utf8",
          stdio: ["ignore", "ignore", "pipe"],
        },
      ),
    /Missing Entra token-verification configuration/,
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const configPath = require.resolve("../src/config");
const appPath = require.resolve("../src/app");
const bucketsApiPath = require.resolve("../src/api/buckets");
const authApiPath = require.resolve("../src/api/auth");

const originalEnvironment = { ...process.env };

const clearApplicationModules = () => {
  delete require.cache[appPath];
  delete require.cache[configPath];
};

const clearRouterModules = () => {
  delete require.cache[bucketsApiPath];
  delete require.cache[authApiPath];
};

const installRouterStubs = () => {
  const express = require("express");
  const bucketRouter = express.Router();
  const authRouter = express.Router();
  require.cache[bucketsApiPath] = {
    id: bucketsApiPath,
    filename: bucketsApiPath,
    loaded: true,
    exports: bucketRouter,
  };
  require.cache[authApiPath] = {
    id: authApiPath,
    filename: authApiPath,
    loaded: true,
    exports: authRouter,
  };

  return { bucketRouter, authRouter };
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

const requestStatus = (app, path) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const request = require("node:http").get(
        `http://127.0.0.1:${server.address().port}${path}`,
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

test.after(restoreEnvironment);

test("Entra enforcement defaults to disabled", () => {
  delete process.env.ENTRA_AUTH_ENABLED;
  clearApplicationModules();
  installRouterStubs();

  assert.equal(require(configPath).entra.authEnabled, false);
  assert.doesNotThrow(() => require(appPath));
});

test("explicit false keeps Entra enforcement disabled", () => {
  process.env.ENTRA_AUTH_ENABLED = "false";
  clearApplicationModules();

  assert.equal(require(configPath).entra.authEnabled, false);
});

test("invalid Entra enforcement value fails configuration", () => {
  process.env.ENTRA_AUTH_ENABLED = "enabled";
  clearApplicationModules();

  assert.throws(
    () => require(configPath),
    /Invalid ENTRA_AUTH_ENABLED value/,
  );
});

test("explicit true enables Entra enforcement", () => {
  process.env.ENTRA_AUTH_ENABLED = "true";
  process.env.ENTRA_TRUSTED_USER_OBJECT_IDS =
    "11111111-2222-4222-8aaa-555555666666";
  clearApplicationModules();

  assert.equal(require(configPath).entra.authEnabled, true);
});

test("enabled enforcement rejects an unauthenticated bucket request before storage", async () => {
  Object.assign(process.env, {
    ENTRA_AUTH_ENABLED: "true",
    ENTRA_TENANT_ID: "tenant-id",
    ENTRA_API_CLIENT_ID: "api-client-id",
    ENTRA_REQUIRED_SCOPE: "WasabiDrive.Access",
    ENTRA_TRUSTED_USER_OBJECT_IDS: "11111111-2222-4222-8aaa-555555666666",
  });
  clearApplicationModules();
  clearRouterModules();

  const { bucketRouter } = installRouterStubs();
  let storageCalled = false;
  bucketRouter.get("/", (req, res) => {
    storageCalled = true;
    res.json({ buckets: [] });
  });

  const app = require(appPath);
  const response = await requestStatus(app, "/buckets");

  assert.equal(response, 401);
  assert.equal(storageCalled, false);
});

for (const [name, environmentValue] of [
  ["absent", undefined],
  ["false", "false"],
]) {
  test(`disabled enforcement (${name}) allows an unauthenticated bucket request`, async () => {
    if (environmentValue === undefined) {
      delete process.env.ENTRA_AUTH_ENABLED;
    } else {
      process.env.ENTRA_AUTH_ENABLED = environmentValue;
    }
    clearApplicationModules();
    clearRouterModules();

    const { bucketRouter, authRouter } = installRouterStubs();
    let storageCalled = false;
    bucketRouter.get("/", (req, res) => {
      storageCalled = true;
      res.json({ buckets: [] });
    });
    authRouter.get("/probe", (req, res) => {
      res.sendStatus(204);
    });

    const app = require(appPath);
    const bucketResponse = await requestStatus(app, "/buckets");
    const authResponse = await requestStatus(app, "/auth/probe");

    assert.equal(bucketResponse, 200);
    assert.equal(storageCalled, true);
    assert.equal(authResponse, 204);
  });
}

test("enabled enforcement does not mount the legacy auth router", async () => {
  Object.assign(process.env, {
    ENTRA_AUTH_ENABLED: "true",
    ENTRA_TENANT_ID: "tenant-id",
    ENTRA_API_CLIENT_ID: "api-client-id",
    ENTRA_REQUIRED_SCOPE: "WasabiDrive.Access",
    ENTRA_TRUSTED_USER_OBJECT_IDS: "11111111-2222-4222-8aaa-555555666666",
  });
  clearApplicationModules();
  clearRouterModules();

  const { authRouter } = installRouterStubs();
  let legacyAuthCalled = false;
  authRouter.get("/probe", (req, res) => {
    legacyAuthCalled = true;
    res.sendStatus(204);
  });

  const response = await requestStatus(require(appPath), "/auth/probe");

  assert.equal(response, 404);
  assert.equal(legacyAuthCalled, false);
});

test("enabled enforcement fails closed when verifier configuration is missing", () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [
        "-e",
        "process.env.ENTRA_AUTH_ENABLED = 'true'; process.env.ENTRA_TRUSTED_USER_OBJECT_IDS = '11111111-2222-4222-8aaa-555555666666'; delete process.env.ENTRA_TENANT_ID; delete process.env.ENTRA_API_CLIENT_ID; delete process.env.ENTRA_REQUIRED_SCOPE; require('./src/app');",
      ], {
        cwd: require("node:process").cwd(),
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
      }),
    /Missing Entra token-verification configuration/,
  );
});
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

  return bucketRouter;
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

test("explicit true enables Entra enforcement", () => {
  process.env.ENTRA_AUTH_ENABLED = "true";
  clearApplicationModules();

  assert.equal(require(configPath).entra.authEnabled, true);
});

test("enabled enforcement rejects an unauthenticated bucket request before storage", async () => {
  Object.assign(process.env, {
    ENTRA_AUTH_ENABLED: "true",
    ENTRA_TENANT_ID: "tenant-id",
    ENTRA_API_CLIENT_ID: "api-client-id",
    ENTRA_REQUIRED_SCOPE: "WasabiDrive.Access",
  });
  clearApplicationModules();
  clearRouterModules();

  const bucketRouter = installRouterStubs();
  let storageCalled = false;
  bucketRouter.get("/", (req, res) => {
    storageCalled = true;
    res.json({ buckets: [] });
  });

  const app = require(appPath);
  const response = await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const request = require("node:http").get(
        `http://127.0.0.1:${server.address().port}/buckets`,
        (result) => {
          result.resume();
          result.on("end", () => {
            server.close();
            resolve(result.statusCode);
          });
        },
      );
      request.on("error", reject);
    });
    server.on("error", reject);
  });

  assert.equal(response, 401);
  assert.equal(storageCalled, false);
});

test("enabled enforcement fails closed when verifier configuration is missing", () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [
        "-e",
        "process.env.ENTRA_AUTH_ENABLED = 'true'; delete process.env.ENTRA_TENANT_ID; delete process.env.ENTRA_API_CLIENT_ID; delete process.env.ENTRA_REQUIRED_SCOPE; require('./src/app');",
      ], {
        cwd: require("node:process").cwd(),
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
      }),
    /Missing Entra token-verification configuration/,
  );
});
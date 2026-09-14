const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EntraAuthenticationError,
  EntraAuthorizationError,
  createEntraTokenVerifier,
} = require("../src/authentication/entraTokenVerifier");
const {
  createRequireEntraAccessToken,
} = require("../src/authentication/requireEntraAccessToken");

const verifierConfig = {
  issuer: "https://login.microsoftonline.com/tenant-id/v2.0",
  audience: "api-client-id",
  requiredScope: "WasabiDrive.Access",
  jwksUri:
    "https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys",
};

const validPayload = {
  aud: verifierConfig.audience,
  iss: verifierConfig.issuer,
  exp: Math.floor(Date.now() / 1000) + 300,
  scp: `profile ${verifierConfig.requiredScope}`,
  sub: "user-id",
};

const createJoseStub = ({ payload = validPayload, error } = {}) => {
  const jwks = { type: "test-jwks" };
  const calls = {};

  return {
    calls,
    jose: {
      createRemoteJWKSet(url) {
        calls.jwksUrl = url.toString();
        return jwks;
      },
      async jwtVerify(token, receivedJwks, options) {
        calls.token = token;
        calls.jwks = receivedJwks;
        calls.options = options;

        if (error) {
          throw error;
        }

        return { payload };
      },
    },
  };
};

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

const tokenValidationFailures = [
  ["malformed token", "ERR_JWS_INVALID"],
  ["invalid signature", "ERR_JWS_SIGNATURE_VERIFICATION_FAILED"],
  ["wrong issuer", "ERR_JWT_CLAIM_VALIDATION_FAILED"],
  ["wrong audience", "ERR_JWT_CLAIM_VALIDATION_FAILED"],
  ["expired token", "ERR_JWT_EXPIRED"],
];

for (const [name, code] of tokenValidationFailures) {
  test(`${name} is rejected as unauthenticated`, async () => {
    const joseError = Object.assign(new Error(name), { code });
    const { jose } = createJoseStub({ error: joseError });
    const verifyToken = createEntraTokenVerifier(verifierConfig, { jose });

    await assert.rejects(
      () => verifyToken(name === "malformed token" ? "not-a-jwt" : "token"),
      (error) => {
        assert.equal(error instanceof EntraAuthenticationError, true);
        assert.equal(error.statusCode, 401);
        assert.equal(error.cause, joseError);
        return true;
      },
    );
  });
}

test("missing required scope is rejected as forbidden", async () => {
  const { jose } = createJoseStub({
    payload: {
      ...validPayload,
      scp: "profile User.Read",
    },
  });
  const verifyToken = createEntraTokenVerifier(verifierConfig, { jose });

  await assert.rejects(
    () => verifyToken("token"),
    (error) => {
      assert.equal(error instanceof EntraAuthorizationError, true);
      assert.equal(error.statusCode, 403);
      return true;
    },
  );
});

test("valid token returns claims and configures jose validation", async () => {
  const { jose, calls } = createJoseStub();
  const verifyToken = createEntraTokenVerifier(verifierConfig, { jose });

  const payload = await verifyToken("valid-token");

  assert.equal(payload, validPayload);
  assert.equal(calls.token, "valid-token");
  assert.equal(calls.jwksUrl, verifierConfig.jwksUri);
  assert.deepEqual(calls.options, {
    issuer: verifierConfig.issuer,
    audience: verifierConfig.audience,
    algorithms: ["RS256"],
  });
});

test("token without an expiry is rejected", async () => {
  const { exp, ...payloadWithoutExpiry } = validPayload;
  const { jose } = createJoseStub({ payload: payloadWithoutExpiry });
  const verifyToken = createEntraTokenVerifier(verifierConfig, { jose });

  await assert.rejects(
    () => verifyToken("token"),
    (error) => error instanceof EntraAuthenticationError,
  );
});

test("missing bearer token returns 401 without invoking verifier", async () => {
  let verifyCalled = false;
  const middleware = createRequireEntraAccessToken(async () => {
    verifyCalled = true;
    return validPayload;
  });
  const req = { headers: {} };
  const res = createResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "Unauthorized" });
  assert.equal(verifyCalled, false);
  assert.equal(nextCalled, false);
});

test("valid bearer token attaches claims and continues", async () => {
  const middleware = createRequireEntraAccessToken(async (token) => {
    assert.equal(token, "valid-token");
    return validPayload;
  });
  const req = { headers: { authorization: "Bearer valid-token" } };
  const res = createResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(req.auth, validPayload);
  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
});

test("invalid token from verifier returns 401", async () => {
  const middleware = createRequireEntraAccessToken(async () => {
    throw new EntraAuthenticationError();
  });
  const req = { headers: { authorization: "Bearer invalid-token" } };
  const res = createResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "Unauthorized" });
  assert.equal(nextCalled, false);
});

test("missing scope from verifier returns 403", async () => {
  const middleware = createRequireEntraAccessToken(async () => {
    throw new EntraAuthorizationError();
  });
  const req = { headers: { authorization: "Bearer token" } };
  const res = createResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Forbidden" });
  assert.equal(nextCalled, false);
});

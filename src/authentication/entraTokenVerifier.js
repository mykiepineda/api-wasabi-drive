const TOKEN_VALIDATION_ERROR_CODES = new Set([
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWS_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWT_EXPIRED",
  "ERR_JWT_INVALID",
]);

class EntraAuthenticationError extends Error {
  constructor(message = "Invalid access token.", options) {
    super(message, options);
    this.name = "EntraAuthenticationError";
    this.statusCode = 401;
  }
}

class EntraAuthorizationError extends Error {
  constructor(message = "Required API scope is missing.", options) {
    super(message, options);
    this.name = "EntraAuthorizationError";
    this.statusCode = 403;
  }
}

const assertRequiredConfiguration = ({
  issuer,
  audience,
  requiredScope,
  jwksUri,
}) => {
  const missing = Object.entries({
    issuer,
    audience,
    requiredScope,
    jwksUri,
  })
    .filter(([, value]) => typeof value !== "string" || value.trim() === "")
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Missing Entra token-verification configuration: ${missing.join(", ")}`,
    );
  }
};

const hasRequiredScope = (scopeClaim, requiredScope) => {
  if (typeof scopeClaim !== "string") {
    return false;
  }

  return scopeClaim.split(/\s+/).includes(requiredScope);
};

const isTokenValidationError = (error) =>
  Boolean(error && TOKEN_VALIDATION_ERROR_CODES.has(error.code));

const loadJose = (dependencies) =>
  dependencies.jose ? Promise.resolve(dependencies.jose) : import("jose");

const createEntraTokenVerifier = (
  { issuer, audience, requiredScope, jwksUri },
  dependencies = {},
) => {
  assertRequiredConfiguration({ issuer, audience, requiredScope, jwksUri });

  const josePromise = loadJose(dependencies);
  const keySetPromise = josePromise.then((jose) =>
    jose.createRemoteJWKSet(new URL(jwksUri)),
  );

  return async (token) => {
    if (typeof token !== "string" || token.trim() === "") {
      throw new EntraAuthenticationError();
    }

    let payload;

    try {
      const [jose, keySet] = await Promise.all([josePromise, keySetPromise]);
      ({ payload } = await jose.jwtVerify(token, keySet, {
        issuer,
        audience,
        algorithms: ["RS256"],
      }));
    } catch (error) {
      if (isTokenValidationError(error)) {
        throw new EntraAuthenticationError("Invalid access token.", {
          cause: error,
        });
      }

      // Do not misreport JWKS/network/configuration failures as bad credentials.
      throw error;
    }

    // jwtVerify validates exp when present. Requiring it as well ensures that an
    // otherwise valid signed token without an expiry is not accepted by this API.
    if (typeof payload.exp !== "number") {
      throw new EntraAuthenticationError("Access token has no expiry.");
    }

    if (!hasRequiredScope(payload.scp, requiredScope)) {
      throw new EntraAuthorizationError();
    }

    return payload;
  };
};

const createConfiguredEntraTokenVerifier = () => {
  const { entra } = require("../config");

  return createEntraTokenVerifier({
    issuer: entra.issuer,
    audience: entra.apiClientId,
    requiredScope: entra.requiredScope,
    jwksUri: entra.jwksUri,
  });
};

module.exports = {
  EntraAuthenticationError,
  EntraAuthorizationError,
  createConfiguredEntraTokenVerifier,
  createEntraTokenVerifier,
};

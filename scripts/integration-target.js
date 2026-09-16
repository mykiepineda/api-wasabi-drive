const apiGatewayHostPattern = /^[a-z0-9-]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/i;
const localHosts = new Set(["localhost", "127.0.0.1"]);
const allowedTargets = new Set(["local", "development", "test"]);
const mutationScopes = new Set(["full", "known-defects"]);

function parseBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new Error("BASE_URL must be a non-blank absolute HTTP(S) URL.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("BASE_URL must be a non-blank absolute HTTP(S) URL.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("BASE_URL must use HTTP or HTTPS.");
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("BASE_URL must not contain credentials.");
  }

  return parsedUrl;
}

function isLocalUrl(parsedUrl) {
  return localHosts.has(parsedUrl.hostname);
}

function isTestApiGatewayUrl(parsedUrl) {
  const [stage] = parsedUrl.pathname.split("/").filter(Boolean);
  return (
    parsedUrl.protocol === "https:" &&
    apiGatewayHostPattern.test(parsedUrl.hostname) &&
    stage === "test"
  );
}

function validateIntegrationTarget({ target, baseUrl, scope = "regression" }) {
  if (!allowedTargets.has(target)) {
    throw new Error(
      "Integration tests require INTEGRATION_TARGET=local, development, or test."
    );
  }

  const parsedUrl = parseBaseUrl(baseUrl);
  const localUrl = isLocalUrl(parsedUrl);

  if ((target === "local" || target === "development") && !localUrl) {
    throw new Error(
      `INTEGRATION_TARGET=${target} requires BASE_URL to use localhost or 127.0.0.1.`
    );
  }

  if (target === "test" && !isTestApiGatewayUrl(parsedUrl)) {
    throw new Error(
      "INTEGRATION_TARGET=test requires an HTTPS API Gateway URL with /test as its stage path."
    );
  }

  if (mutationScopes.has(scope) && !localUrl) {
    throw new Error(
      `${scope} integration tests may target only a local development URL.`
    );
  }

  return parsedUrl;
}

module.exports = { parseBaseUrl, validateIntegrationTarget };
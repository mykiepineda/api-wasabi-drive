const test = require("node:test");
const assert = require("node:assert/strict");
const { validateIntegrationTarget } = require("../scripts/integration-target");

const validate = (target, baseUrl, scope = "regression") =>
  validateIntegrationTarget({ target, baseUrl, scope });

test("accepts localhost for the local target", () => {
  assert.doesNotThrow(() => validate("local", "http://localhost:8080"));
  assert.doesNotThrow(() => validate("local", "https://127.0.0.1:8443/api"));
});

test("accepts a real-shaped test API Gateway URL", () => {
  assert.doesNotThrow(() =>
    validate("test", "https://abc123.execute-api.ap-southeast-2.amazonaws.com/test")
  );
});

test("rejects production stage URLs for the test target", () => {
  assert.throws(
    () =>
      validate(
        "test",
        "https://abc123.execute-api.ap-southeast-2.amazonaws.com/prd"
      ),
    /requires an HTTPS API Gateway URL/
  );
});

test("rejects mismatched target and URL", () => {
  assert.throws(
    () => validate("local", "https://abc123.execute-api.ap-southeast-2.amazonaws.com/test"),
    /requires BASE_URL to use localhost or 127\.0\.0\.1/
  );
  assert.throws(
    () => validate("test", "http://localhost:8080"),
    /requires an HTTPS API Gateway URL/
  );
});

test("rejects malformed and missing BASE_URL values", () => {
  assert.throws(() => validate("local", "not a URL"), /BASE_URL must be/);
  assert.throws(() => validate("local", ""), /BASE_URL must be/);
  assert.throws(() => validate("local"), /BASE_URL must be/);
});

test("keeps mutation scopes on local development URLs", () => {
  assert.doesNotThrow(() => validate("development", "http://127.0.0.1:8080", "full"));
  assert.doesNotThrow(() => validate("local", "http://localhost:8080", "known-defects"));
  assert.throws(
    () =>
      validate(
        "test",
        "https://abc123.execute-api.ap-southeast-2.amazonaws.com/test",
        "full"
      ),
    /may target only a local development URL/
  );
});
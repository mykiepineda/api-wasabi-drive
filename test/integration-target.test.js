const test = require("node:test");
const assert = require("node:assert/strict");
const { validateIntegrationTarget } = require("../scripts/integration-target");

const validate = (target, baseUrl, scope = "regression") =>
  validateIntegrationTarget({ target, baseUrl, scope });

test("accepts localhost for the local target", () => {
  assert.doesNotThrow(() => validate("local", "http://localhost:8080"));
  assert.doesNotThrow(() => validate("local", "https://127.0.0.1:8443/api"));
});

test("accepts a test API Gateway URL for regression", () => {
  assert.doesNotThrow(() =>
    validate("test", "https://abc123.execute-api.ap-southeast-2.amazonaws.com/test")
  );
});

test("rejects production target for regression", () => {
  assert.throws(
    () =>
      validate(
        "prd",
        "https://abc123.execute-api.ap-southeast-2.amazonaws.com/prd"
      ),
    /does not allow INTEGRATION_TARGET=prd/
  );
});

test("accepts matching test and production URLs for deployment smoke", () => {
  assert.doesNotThrow(() =>
    validate(
      "test",
      "https://abc123.execute-api.ap-southeast-2.amazonaws.com/test",
      "deployment-smoke"
    )
  );
  assert.doesNotThrow(() =>
    validate(
      "prd",
      "https://abc123.execute-api.ap-southeast-2.amazonaws.com/prd",
      "deployment-smoke"
    )
  );
});

test("deployment smoke rejects stage URLs that do not match the target", () => {
  assert.throws(
    () =>
      validate(
        "prd",
        "https://abc123.execute-api.ap-southeast-2.amazonaws.com/test",
        "deployment-smoke"
      ),
    /requires an HTTPS API Gateway URL/
  );
  assert.throws(
    () =>
      validate(
        "test",
        "https://abc123.execute-api.ap-southeast-2.amazonaws.com/prd",
        "deployment-smoke"
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

test("rejects unsupported integration scopes", () => {
  assert.throws(
    () => validate("local", "http://localhost:8080", "unknown"),
    /Unknown integration scope/
  );
});

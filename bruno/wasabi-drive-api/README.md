# Wasabi Drive API Bruno Collection

Use the project-local Bruno CLI through the npm scripts. Every automated scope requires an explicitly non-production target: `local`, `development`, or `test`.

## Normal regression

```powershell
$env:INTEGRATION_TARGET = "local"
$env:BASE_URL = "http://localhost:8080"
$env:INTEGRATION_BUCKET_NAME = "..."
$env:INTEGRATION_CONTINUATION_TOKEN = "..."
npm run test:integration
```

This is the expected-to-pass, read-only scope. It excludes user creation, user update, dependent user-flow requests, and known defects. The `ci` environment reads the variables above and writes `bruno-results.xml`. Report request/response bodies and all headers are intentionally suppressed.

## Full coverage

Set `INTEGRATION_USER_NAME` and `INTEGRATION_USER_PASSWORD` to unique disposable values, then explicitly allow mutations:

```powershell
$env:INTEGRATION_TARGET = "development"
$env:INTEGRATION_ALLOW_MUTATIONS = "true"
npm run test:integration:full
```

This scope provides broader disposable-data coverage while excluding known defects. `Create user` and `Update user` mutate MongoDB, and there is no delete-user endpoint. Never use production for automated integration tests.

## Known defects

```powershell
$env:INTEGRATION_TARGET = "development"
$env:INTEGRATION_ALLOW_MUTATIONS = "true"
npm run test:integration:known-defects
```

The `known-defect-flow` tag selects the ordered create-user, validate-credentials, get-user, and update-user requests needed to reproduce the MongoDB `_id` update defect. Its HTTP 200 expectation is unchanged. A failure is expected until the defect is intentionally fixed; this command is not part of the green regression gate.
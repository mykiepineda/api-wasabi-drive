# Wasabi Drive API Bruno Collection

Use the project-local Bruno CLI through the npm scripts. Every automated scope requires an explicitly non-production target: `local`, `development`, or `test`.

## Normal regression

```powershell
$env:INTEGRATION_TARGET = "local"
$env:BASE_URL = "http://localhost:8080"
$env:INTEGRATION_BUCKET_NAME = "..."
$env:INTEGRATION_CONTINUATION_TOKEN = "..."
$env:INTEGRATION_ACCESS_TOKEN = "<short-lived Entra access token>"
npm run test:integration
```

This is the expected-to-pass, read-only scope. For `INTEGRATION_TARGET=test`, the token is required and is read only at runtime; never put a real token in Bruno files, reports, logs, or source. The scope excludes legacy authentication requests, user creation, user update, dependent user-flow requests, and known defects. The `ci` environment reads the variables above and writes `bruno-results.xml`. Report request/response bodies and all headers are intentionally suppressed.

To obtain a short-lived token with an existing interactive Azure CLI login, set the non-secret Entra configuration and dot-source the helper from the repository root:

```powershell
$env:ENTRA_TENANT_ID = "<tenant-id>"
$env:ENTRA_API_CLIENT_ID = "<API client ID>"
$env:ENTRA_REQUIRED_SCOPE = "<scope-name>"
az login --tenant $env:ENTRA_TENANT_ID
. .\scripts\get-integration-token.ps1
```

The helper sets `INTEGRATION_ACCESS_TOKEN` in the current PowerShell process without printing or persisting its value. It does not automate username/password authentication or use a client secret.

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
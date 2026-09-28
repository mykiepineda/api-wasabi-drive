# Wasabi Drive API Bruno Collection

Use the project-local Bruno CLI through the npm scripts. The supported scopes are `regression` and `deployment-smoke`; target and base URL must match the scope-aware validation rules.

## Full regression

```bash
npm run test:integration
npm run test:integration -- regression
```

This read-only authenticated scope is allowed only for `local`, `development`, or `test`, never `prd`. Testing `test` requires a short-lived delegated Entra access token. Full regression remains the manual authenticated test-stage promotion gate.

```powershell
$env:INTEGRATION_TARGET = "local"
$env:BASE_URL = "http://localhost:8080"
$env:INTEGRATION_BUCKET_NAME = "..."
$env:INTEGRATION_CONTINUATION_TOKEN = "..."
$env:INTEGRATION_ACCESS_TOKEN = "<short-lived Entra access token>"
npm run test:integration
```

For `INTEGRATION_TARGET=test`, the token is required and is read only at runtime; never put a real token in Bruno files, reports, logs, or source. The scope excludes legacy authentication requests, user creation, user update, dependent user-flow requests, and known defects. The `ci` environment reads the variables above and writes `bruno-results.xml`. Report request/response bodies and all headers are intentionally suppressed.

## Deployment smoke

```bash
npm run test:integration -- deployment-smoke
```

This unauthenticated scope checks only `/health` for HTTP 200 and `/buckets/` for HTTP 401. It requires no access token and performs no Wasabi read or write. It is permitted for `local`, `development`, `test`, and `prd` only when `INTEGRATION_TARGET` and `BASE_URL` match the required host and stage rules. CI runs it after successful test and production deployments.

To obtain a short-lived token with an existing interactive Azure CLI login, set the non-secret Entra configuration and dot-source the helper from the repository root:

```powershell
$env:ENTRA_TENANT_ID = "<tenant-id>"
$env:ENTRA_API_CLIENT_ID = "<API client ID>"
$env:ENTRA_REQUIRED_SCOPE = "<scope-name>"
$env:ENTRA_API_IDENTIFIER_URI = "<Application ID URI>"
az login --tenant $env:ENTRA_TENANT_ID
. .\scripts\get-integration-token.ps1
```

`ENTRA_API_IDENTIFIER_URI` must match the API app registration's **Application ID URI** in Entra, for example `api://<API-client-ID>` or a custom URI. If it is omitted, the helper uses `api://<API-client-ID>`. The helper sets `INTEGRATION_ACCESS_TOKEN` in the current PowerShell process without printing or persisting its value. It does not automate username/password authentication or use a client secret.

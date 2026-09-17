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
$env:ENTRA_API_IDENTIFIER_URI = "<Application ID URI>"
az login --tenant $env:ENTRA_TENANT_ID
. .\scripts\get-integration-token.ps1
```

`ENTRA_API_IDENTIFIER_URI` must match the API app registration's **Application ID URI** in Entra, for example `api://<API-client-ID>` or a custom URI. If it is omitted, the helper uses `api://<API-client-ID>`. The helper sets `INTEGRATION_ACCESS_TOKEN` in the current PowerShell process without printing or persisting its value. It does not automate username/password authentication or use a client secret.

param(
  [string]$TenantId = $env:ENTRA_TENANT_ID,
  [string]$ApiClientId = $env:ENTRA_API_CLIENT_ID,
  [string]$RequiredScope = $env:ENTRA_REQUIRED_SCOPE,
  [string]$ApiIdentifierUri = $env:ENTRA_API_IDENTIFIER_URI
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI (az) is required. Install it before generating an integration token."
}

if ([string]::IsNullOrWhiteSpace($TenantId)) {
  throw "Provide the Entra tenant ID through ENTRA_TENANT_ID or -TenantId."
}

if ([string]::IsNullOrWhiteSpace($ApiClientId)) {
  throw "Provide the API client ID through ENTRA_API_CLIENT_ID or -ApiClientId."
}

if ([string]::IsNullOrWhiteSpace($RequiredScope)) {
  throw "Provide the delegated API scope through ENTRA_REQUIRED_SCOPE or -RequiredScope."
}

if ([string]::IsNullOrWhiteSpace($ApiIdentifierUri)) {
  $ApiIdentifierUri = "api://$ApiClientId"
}

$scope = "$($ApiIdentifierUri.TrimEnd('/'))/$RequiredScope"
$token = az account get-access-token `
  --tenant $TenantId `
  --scope $scope `
  --query accessToken `
  --output tsv

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
  throw "Azure CLI could not obtain an access token. Run 'az login --tenant <tenant-id>' and retry."
}

$env:INTEGRATION_ACCESS_TOKEN = $token.Trim()
Write-Output "INTEGRATION_ACCESS_TOKEN was set for this PowerShell session."
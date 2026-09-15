const dotenv = require("dotenv");

dotenv.config();

const parseEntraAuthEnabled = (value) => {
  if (value === undefined) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === "true") {
    return true;
  }

  if (normalizedValue === "false") {
    return false;
  }

  throw new Error(
    'Invalid ENTRA_AUTH_ENABLED value. Expected "true" or "false".',
  );
};

const entraTenantId = process.env.ENTRA_TENANT_ID?.trim();
const entraAuthEnabled = parseEntraAuthEnabled(process.env.ENTRA_AUTH_ENABLED);

const config = {
  port: process.env.PORT || 8080,
  wasabi: {
    serviceUrl: process.env.WASABI_SERVICE_URL,
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID,
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY,
  },
  entra: {
    authEnabled: entraAuthEnabled,
    tenantId: entraTenantId,
    apiClientId: process.env.ENTRA_API_CLIENT_ID?.trim(),
    requiredScope: process.env.ENTRA_REQUIRED_SCOPE?.trim(),
    issuer: entraTenantId
      ? `https://login.microsoftonline.com/${entraTenantId}/v2.0`
      : undefined,
    jwksUri: entraTenantId
      ? `https://login.microsoftonline.com/${entraTenantId}/discovery/v2.0/keys`
      : undefined,
  },
  mongodb: {
    atlasUri: process.env.MONGODB_ATLAS_URI,
    dnsServers: process.env.MONGODB_DNS_SERVERS?.split(",")
      .map((server) => server.trim())
      .filter(Boolean),
  },
};

module.exports = config;
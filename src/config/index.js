const dotenv = require("dotenv");

dotenv.config();

const entraTenantId = process.env.ENTRA_TENANT_ID?.trim();

const config = {
  port: process.env.PORT || 8080,
  wasabi: {
    serviceUrl: process.env.WASABI_SERVICE_URL,
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID,
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY,
  },
  entra: {
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
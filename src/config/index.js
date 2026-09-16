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

const isValidTrustedUserObjectId = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
};

const parseTrustedUserObjectIds = (value, { strict = false } = {}) => {
  if (value === undefined || value === null) {
    return Object.freeze([]);
  }

  const entries = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return Object.freeze([]);
  }

  const normalizedEntries = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!isValidTrustedUserObjectId(entry)) {
      if (strict) {
        throw new Error(
          "Invalid ENTRA_TRUSTED_USER_OBJECT_IDS value. Provide valid Entra user Object IDs separated by commas.",
        );
      }
      continue;
    }

    const normalizedEntry = entry.toLowerCase();
    if (!seen.has(normalizedEntry)) {
      seen.add(normalizedEntry);
      normalizedEntries.push(normalizedEntry);
    }
  }

  return Object.freeze(normalizedEntries);
};

const entraTenantId = process.env.ENTRA_TENANT_ID?.trim();
const entraAuthEnabled = parseEntraAuthEnabled(process.env.ENTRA_AUTH_ENABLED);
const trustedUserObjectIds = parseTrustedUserObjectIds(
  process.env.ENTRA_TRUSTED_USER_OBJECT_IDS,
  { strict: entraAuthEnabled },
);

if (entraAuthEnabled && trustedUserObjectIds.length === 0) {
  throw new Error(
    "Missing ENTRA_TRUSTED_USER_OBJECT_IDS configuration when ENTRA_AUTH_ENABLED is true.",
  );
}

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
    trustedUserObjectIds,
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
module.exports.parseEntraAuthEnabled = parseEntraAuthEnabled;
module.exports.parseTrustedUserObjectIds = parseTrustedUserObjectIds;
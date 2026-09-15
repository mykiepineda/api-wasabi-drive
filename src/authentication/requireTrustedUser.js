const config = require("../config");

const normalizeObjectId = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
};

const createRequireTrustedUser = (
  trustedUserObjectIds = config.entra.trustedUserObjectIds,
  expectedTenantId = config.entra.tenantId,
) => (req, res, next) => {
  if (!req?.auth || typeof req.auth !== "object") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const currentTenantId = normalizeObjectId(req.auth.tid);
  const expectedTenantValue = normalizeObjectId(expectedTenantId);
  if (expectedTenantValue && currentTenantId !== expectedTenantValue) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const objectId = normalizeObjectId(req.auth.oid);
  if (!objectId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!trustedUserObjectIds || !Array.isArray(trustedUserObjectIds)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const trustedIds = trustedUserObjectIds.map((trustedId) =>
    normalizeObjectId(trustedId),
  );
  if (!trustedIds.includes(objectId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return next();
};

module.exports = {
  createRequireTrustedUser,
};

const {
  EntraAuthenticationError,
  EntraAuthorizationError,
  createConfiguredEntraTokenVerifier,
} = require("./entraTokenVerifier");

const extractBearerToken = (authorizationHeader) => {
  if (typeof authorizationHeader !== "string") {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : null;
};

const createRequireEntraAccessToken = (
  verifyToken = createConfiguredEntraTokenVerifier(),
) => async (req, res, next) => {
  const token = extractBearerToken(req.headers?.authorization);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.auth = await verifyToken(token);
    return next();
  } catch (error) {
    if (error instanceof EntraAuthorizationError) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (error instanceof EntraAuthenticationError) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return next(error);
  }
};

module.exports = {
  createRequireEntraAccessToken,
  extractBearerToken,
};

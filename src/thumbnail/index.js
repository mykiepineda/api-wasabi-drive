const { createThumbnailKey, normalizeEtag, sanitizeVersion } = require("./key");
const { evaluateThumbnailEligibility, normalizeExtension } = require("./eligibility");

module.exports = {
  createThumbnailKey,
  normalizeEtag,
  sanitizeVersion,
  evaluateThumbnailEligibility,
  normalizeExtension,
};

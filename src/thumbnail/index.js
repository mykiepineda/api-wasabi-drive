const { createThumbnailKey, normalizeEtag } = require("./key");
const { evaluateThumbnailEligibility } = require("./eligibility");
const { transformToWebp } = require("./transform");
const { applyThumbnailPolicy } = require("./service");
const { extractCR2EmbeddedPreview } = require("./cr2");

module.exports = {
  createThumbnailKey,
  evaluateThumbnailEligibility,
  extractCR2EmbeddedPreview,
  normalizeEtag,
  transformToWebp,
  applyThumbnailPolicy,
};

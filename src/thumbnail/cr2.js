const { extractThumbnail } = require("extract-raw-preview");

const normalizePreviewCandidate = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (value.found === false) {
    return null;
  }

  if (!value.data || !(value.data instanceof Uint8Array)) {
    return null;
  }

  const width = Number(value.width);
  const height = Number(value.height);
  const byteLength = Number(value.byteLength ?? value.data.length ?? 0);
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : "application/octet-stream";

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || !Number.isFinite(byteLength) || byteLength <= 0) {
    return null;
  }

  return {
    buffer: Buffer.from(value.data),
    width,
    height,
    mimeType,
    byteLength,
  };
};

const extractCR2EmbeddedPreview = async ({ input, filePath } = {}) => {
  const sourceBuffer = Buffer.isBuffer(input)
    ? input
    : typeof filePath === "string"
      ? null
      : null;

  if (!sourceBuffer || sourceBuffer.length === 0) {
    return {
      eligible: false,
      reason: "missing-cr2-preview-input",
      extractor: "extract-raw-preview",
      buffer: null,
    };
  }

  try {
    const extracted = await extractThumbnail(sourceBuffer, { maxBytes: 8 * 1024 * 1024 });
    const preview = normalizePreviewCandidate(extracted);
    if (!preview) {
      return {
        eligible: false,
        reason: "portable-cr2-preview-empty",
        extractor: "extract-raw-preview",
        buffer: null,
      };
    }

    if (preview.byteLength < 32 * 1024) {
      return {
        eligible: false,
        reason: "portable-cr2-preview-low-quality",
        extractor: "extract-raw-preview",
        buffer: null,
      };
    }

    return {
      eligible: true,
      reason: "portable-cr2-preview-ready",
      extractor: "extract-raw-preview",
      buffer: preview.buffer,
      width: preview.width,
      height: preview.height,
      format: preview.mimeType,
      byteLength: preview.byteLength,
    };
  } catch (error) {
    return {
      eligible: false,
      reason: "portable-cr2-preview-failed",
      extractor: "extract-raw-preview",
      buffer: null,
    };
  }
};

module.exports = {
  extractCR2EmbeddedPreview,
  normalizePreviewCandidate,
};

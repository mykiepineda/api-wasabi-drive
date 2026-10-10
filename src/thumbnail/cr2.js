const loadExtractorModule = async () => {
  try {
    const module = await import("extract-raw-preview");
    return module.default ?? module;
  } catch (error) {
    return null;
  }
};

const normalizePreviewCandidate = (value) => {
  if (Buffer.isBuffer(value)) {
    return { buffer: value, width: null, height: null, format: "jpeg" };
  }

  if (value && typeof value === "object") {
    const buffer = value.buffer ?? value.preview ?? value.data ?? value.jpeg ?? value.jpegBuffer;
    if (Buffer.isBuffer(buffer)) {
      return {
        buffer,
        width: value.width ?? null,
        height: value.height ?? null,
        format: value.format ?? "jpeg",
      };
    }
  }

  return null;
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

  const extractorModule = await loadExtractorModule();
  if (!extractorModule) {
    return {
      eligible: false,
      reason: "portable-cr2-preview-extractor-unavailable",
      extractor: "extract-raw-preview",
      buffer: null,
    };
  }

  const extractor =
    typeof extractorModule === "function"
      ? extractorModule
      : extractorModule.extractRawPreview
        ?? extractorModule.extractPreviewImage
        ?? extractorModule.extractPreview
        ?? extractorModule.default;

  if (typeof extractor !== "function") {
    return {
      eligible: false,
      reason: "portable-cr2-preview-extractor-invalid",
      extractor: "extract-raw-preview",
      buffer: null,
    };
  }

  try {
    const candidate = await extractor(sourceBuffer);
    const preview = normalizePreviewCandidate(candidate);
    if (!preview) {
      return {
        eligible: false,
        reason: "portable-cr2-preview-empty",
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
      format: preview.format,
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
  loadExtractorModule,
};

const { extractThumbnail } = require("extract-raw-preview");
const sharp = require("sharp");

const TIFF_HEADER_LENGTH = 8;
const TIFF_IFD_ENTRY_LENGTH = 12;
const TIFF_MAX_IFD_ENTRIES = 4096;
const SUPPORTED_ROTATION_ORIENTATIONS = new Set([1, 3, 6, 8]);

const readCR2Orientation = (input) => {
  if (!Buffer.isBuffer(input) || input.length < TIFF_HEADER_LENGTH) {
    return { status: "malformed", orientation: null };
  }

  const isLittleEndian = input[0] === 0x49 && input[1] === 0x49;
  const isBigEndian = input[0] === 0x4d && input[1] === 0x4d;
  if (!isLittleEndian && !isBigEndian) {
    return { status: "malformed", orientation: null };
  }

  const readUInt16 = (offset) => (isLittleEndian
    ? input.readUInt16LE(offset)
    : input.readUInt16BE(offset));
  const readUInt32 = (offset) => (isLittleEndian
    ? input.readUInt32LE(offset)
    : input.readUInt32BE(offset));

  if (readUInt16(2) !== 42) {
    return { status: "malformed", orientation: null };
  }

  const ifdOffset = readUInt32(4);
  if (
    ifdOffset < TIFF_HEADER_LENGTH
    || ifdOffset > input.length - 2
  ) {
    return { status: "malformed", orientation: null };
  }

  const entryCount = readUInt16(ifdOffset);
  if (entryCount > TIFF_MAX_IFD_ENTRIES) {
    return { status: "malformed", orientation: null };
  }

  const entriesStart = ifdOffset + 2;
  const nextIfdOffsetPosition = entriesStart + (entryCount * TIFF_IFD_ENTRY_LENGTH);
  if (nextIfdOffsetPosition + 4 > input.length) {
    return { status: "malformed", orientation: null };
  }

  let orientation = null;
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = entriesStart + (index * TIFF_IFD_ENTRY_LENGTH);
    if (readUInt16(entryOffset) !== 0x0112) {
      continue;
    }

    if (orientation !== null || readUInt16(entryOffset + 2) !== 3 || readUInt32(entryOffset + 4) !== 1) {
      return { status: "malformed", orientation: null };
    }

    const value = readUInt16(entryOffset + 8);
    if (value < 1 || value > 8) {
      return { status: "malformed", orientation: null };
    }
    orientation = value;
  }

  return orientation === null
    ? { status: "absent", orientation: null }
    : { status: "orientation", orientation };
};

const resolveCR2PreviewOrientation = ({ sourceOrientation, previewOrientation } = {}) => {
  let orientation;
  let orientationSource;
  let fallbackOrientation;

  if (previewOrientation !== undefined && previewOrientation !== null) {
    if (!Number.isInteger(previewOrientation) || previewOrientation < 1 || previewOrientation > 8) {
      return { eligible: false, reason: "cr2-preview-orientation-unsupported" };
    }
    orientation = previewOrientation;
    orientationSource = "preview-exif";
  } else if (sourceOrientation?.status === "malformed") {
    return { eligible: false, reason: "cr2-source-orientation-invalid" };
  } else if (sourceOrientation?.status === "orientation") {
    orientation = sourceOrientation.orientation;
    orientationSource = "cr2-ifd0";
    fallbackOrientation = orientation;
  } else {
    orientation = 1;
    orientationSource = "none";
  }

  if (!SUPPORTED_ROTATION_ORIENTATIONS.has(orientation)) {
    return { eligible: false, reason: "cr2-orientation-unsupported" };
  }

  return {
    eligible: true,
    reason: "cr2-orientation-ready",
    sourceOrientation: sourceOrientation?.status === "orientation" ? sourceOrientation.orientation : null,
    orientationSource,
    orientationApplied: orientation !== 1,
    fallbackOrientation,
  };
};

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

    const sourceOrientation = readCR2Orientation(sourceBuffer);
    const previewMetadata = await sharp(preview.buffer).metadata();
    const orientation = resolveCR2PreviewOrientation({
      sourceOrientation,
      previewOrientation: previewMetadata.orientation,
    });
    if (!orientation.eligible) {
      return {
        eligible: false,
        reason: orientation.reason,
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
      sourceOrientation: orientation.sourceOrientation,
      orientationSource: orientation.orientationSource,
      orientationApplied: orientation.orientationApplied,
      fallbackOrientation: orientation.fallbackOrientation,
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
  readCR2Orientation,
  resolveCR2PreviewOrientation,
};

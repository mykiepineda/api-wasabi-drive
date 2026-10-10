const fs = require("node:fs/promises");
const path = require("node:path");
const { extractCR2EmbeddedPreview } = require("../src/thumbnail/cr2");
const { transformToWebp } = require("../src/thumbnail/transform");

const USAGE = "Usage: node scripts/thumbnail-cr2-probe.js <local-cr2-file> [--webp <output-webp-file>]";

const parseArguments = (args) => {
  if (
    !Array.isArray(args)
    || (args.length !== 1 && args.length !== 3)
    || typeof args[0] !== "string"
    || !args[0].trim()
    || args[0] === "--webp"
    || (args.length === 3 && (
      args[1] !== "--webp"
      || typeof args[2] !== "string"
      || !args[2].trim()
      || path.extname(args[2]).toLowerCase() !== ".webp"
    ))
  ) {
    throw new Error(USAGE);
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = args.length === 3 ? path.resolve(args[2]) : null;

  if (outputPath && inputPath.toLowerCase() === outputPath.toLowerCase()) {
    throw new Error(USAGE);
  }
  return { inputPath, outputPath };
};

const sanitizeResult = (result) => ({
  eligible: result.eligible,
  reason: result.reason,
  mimeType: result.mimeType,
  width: result.width,
  height: result.height,
  byteLength: result.byteLength,
  sourceOrientation: result.sourceOrientation,
  orientationSource: result.orientationSource,
  orientationApplied: result.orientationApplied,
  webp: result.webp
    ? {
        width: result.webp.width,
        height: result.webp.height,
        byteLength: result.webp.byteLength,
      }
    : null,
});

const main = async (args) => {
  let options;
  try {
    options = parseArguments(args);
  } catch {
    console.error(USAGE);
    return 2;
  }

  try {
    const bytes = await fs.readFile(options.inputPath);
    const preview = await extractCR2EmbeddedPreview({ input: bytes });

    if (!preview.eligible || !preview.buffer) {
      console.log(JSON.stringify({
        eligible: false,
        reason: preview.reason ?? "no-embedded-preview-found",
        mimeType: null,
        width: null,
        height: null,
        byteLength: null,
        sourceOrientation: null,
        orientationSource: null,
        orientationApplied: false,
        webp: null,
      }, null, 2));
      return 1;
    }

    const webp = await transformToWebp({
      input: preview.buffer,
      maxEdge: 512,
      quality: 80,
      fallbackOrientation: preview.fallbackOrientation,
    });
    if (options.outputPath) {
      await fs.writeFile(options.outputPath, webp.buffer, { flag: "wx" });
    }

    console.log(JSON.stringify(sanitizeResult({
      eligible: true,
      reason: preview.reason ?? "embedded-preview-ready",
      mimeType: preview.format ?? null,
      width: preview.width ?? null,
      height: preview.height ?? null,
      byteLength: preview.byteLength ?? null,
      sourceOrientation: preview.sourceOrientation ?? null,
      orientationSource: preview.orientationSource ?? "none",
      orientationApplied: preview.orientationApplied ?? false,
      webp: {
        width: webp.width,
        height: webp.height,
        byteLength: webp.bytes,
      },
    }), null, 2));
    return 0;
  } catch {
    console.log(JSON.stringify({
      eligible: false,
      reason: "probe-failed",
      mimeType: null,
      width: null,
      height: null,
      byteLength: null,
      sourceOrientation: null,
      orientationSource: null,
      orientationApplied: false,
      webp: null,
    }, null, 2));
    return 1;
  }
};

if (require.main === module) {
  main(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = { main, parseArguments };

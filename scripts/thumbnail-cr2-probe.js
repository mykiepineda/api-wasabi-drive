const fs = require("node:fs/promises");
const path = require("node:path");
const { extractCR2EmbeddedPreview } = require("../src/thumbnail/cr2");
const { transformToWebp } = require("../src/thumbnail/transform");

const parseArguments = (args) => {
  if (args.length < 1 || args.length > 2) {
    throw new Error("Usage: node scripts/thumbnail-cr2-probe.js <local-cr2-file> [--webp <output-path>]");
  }

  const inputPath = path.resolve(args[0]);
  const outputFlagIndex = args.indexOf("--webp");
  const outputPath = outputFlagIndex !== -1 && args[outputFlagIndex + 1]
    ? path.resolve(args[outputFlagIndex + 1])
    : null;

  return { inputPath, outputPath };
};

const sanitizeResult = (result) => ({
  eligible: result.eligible,
  reason: result.reason,
  mimeType: result.mimeType,
  width: result.width,
  height: result.height,
  byteLength: result.byteLength,
  webp: result.webp
    ? {
        width: result.webp.width,
        height: result.webp.height,
        byteLength: result.webp.byteLength,
      }
    : null,
});

const main = async (args) => {
  try {
    const options = parseArguments(args);
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
        webp: null,
      }, null, 2));
      return;
    }

    const webp = await transformToWebp({ input: preview.buffer, maxEdge: 512, quality: 80 });
    if (options.outputPath) {
      await fs.writeFile(options.outputPath, webp.buffer);
    }

    console.log(JSON.stringify(sanitizeResult({
      eligible: true,
      reason: preview.reason ?? "embedded-preview-ready",
      mimeType: preview.format ?? null,
      width: preview.width ?? null,
      height: preview.height ?? null,
      byteLength: preview.byteLength ?? null,
      webp: {
        width: webp.width,
        height: webp.height,
        byteLength: webp.bytes,
      },
    }), null, 2));
  } catch (error) {
    console.log(JSON.stringify({ eligible: false, reason: "probe-failed", mimeType: null, width: null, height: null, byteLength: null, webp: null }, null, 2));
  }
};

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArguments };

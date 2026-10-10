const fs = require("node:fs/promises");
const path = require("node:path");
const { extractThumbnail } = require("extract-raw-preview");
const { transformToWebp } = require("../src/thumbnail/transform");

const parseArguments = (args) => {
  if (args.length !== 1) {
    throw new Error("Usage: node scripts/thumbnail-cr2-probe.js <local-cr2-file>");
  }

  const inputPath = path.resolve(args[0]);
  return { inputPath };
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
    const extracted = await extractThumbnail(bytes, { maxBytes: 8 * 1024 * 1024 });

    if (!extracted || extracted.found === false) {
      console.log(JSON.stringify({ eligible: false, reason: extracted?.reason ?? "no-embedded-preview-found", mimeType: null, width: null, height: null, byteLength: null, webp: null }, null, 2));
      return;
    }

    if (extracted.byteLength < 32 * 1024) {
      console.log(JSON.stringify({ eligible: false, reason: "low-quality-preview", mimeType: extracted.mimeType ?? null, width: extracted.width ?? null, height: extracted.height ?? null, byteLength: extracted.byteLength ?? null, webp: null }, null, 2));
      return;
    }

    const webp = await transformToWebp({ input: Buffer.from(extracted.data), maxEdge: 512, quality: 80 });
    console.log(JSON.stringify(sanitizeResult({
      eligible: true,
      reason: "embedded-preview-ready",
      mimeType: extracted.mimeType ?? null,
      width: extracted.width ?? null,
      height: extracted.height ?? null,
      byteLength: extracted.byteLength ?? null,
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

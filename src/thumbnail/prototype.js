const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const prototypeThumbnail = async ({ inputPath, outputPath, maxEdge = 512, quality = 80 }) => {
  if (!Number.isInteger(maxEdge) || maxEdge < 1) {
    throw new RangeError("Maximum edge must be a positive integer.");
  }
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new RangeError("WebP quality must be an integer from 1 to 100.");
  }
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new Error("Input and output paths must be different.");
  }

  const source = sharp(inputPath);
  const [metadata, inputStats] = await Promise.all([
    source.metadata(),
    fs.stat(inputPath),
  ]);
  const outputInfo = await source
    .rotate()
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toFile(outputPath);

  return {
    sourceFormat: metadata.format,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    outputWidth: outputInfo.width,
    outputHeight: outputInfo.height,
    inputBytes: inputStats.size,
    outputBytes: outputInfo.size,
    reductionPercent: inputStats.size === 0
      ? 0
      : ((inputStats.size - outputInfo.size) / inputStats.size) * 100,
  };
};

module.exports = { prototypeThumbnail };
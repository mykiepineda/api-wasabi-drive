const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const MAX_CROP_DIMENSION = 10000;

const pathsReferToSameFile = async (inputPath, outputPath) => {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  if (
    resolvedInput === resolvedOutput
    || (process.platform === "win32" && resolvedInput.toLowerCase() === resolvedOutput.toLowerCase())
  ) {
    return true;
  }

  const [inputStats, outputStats] = await Promise.all([
    fs.stat(inputPath),
    fs.stat(outputPath).catch((error) => {
      if (error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }),
  ]);
  return outputStats !== undefined
    && inputStats.dev === outputStats.dev
    && inputStats.ino === outputStats.ino;
};

const prototypeThumbnail = async (options) => {
  const {
    inputPath,
    outputPath,
    maxEdge = 512,
    quality = 80,
    cropWidth,
    cropHeight,
  } = options;
  const hasCropWidth = cropWidth !== undefined;
  const hasCropHeight = cropHeight !== undefined;
  if (hasCropWidth !== hasCropHeight) {
    throw new TypeError("Crop width and height must be provided together.");
  }
  if (hasCropWidth && Object.hasOwn(options, "maxEdge")) {
    throw new TypeError("Maximum edge cannot be combined with crop dimensions.");
  }
  if (hasCropWidth) {
    if (
      !Number.isSafeInteger(cropWidth)
      || cropWidth < 1
      || cropWidth > MAX_CROP_DIMENSION
      || !Number.isSafeInteger(cropHeight)
      || cropHeight < 1
      || cropHeight > MAX_CROP_DIMENSION
    ) {
      throw new RangeError(`Crop dimensions must be positive integers no greater than ${MAX_CROP_DIMENSION}.`);
    }
  } else if (!Number.isInteger(maxEdge) || maxEdge < 1) {
    throw new RangeError("Maximum edge must be a positive integer.");
  }
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new RangeError("WebP quality must be an integer from 1 to 100.");
  }
  if (await pathsReferToSameFile(inputPath, outputPath)) {
    throw new Error("Input and output paths must be different.");
  }

  const source = sharp(inputPath);
  const [metadata, inputStats] = await Promise.all([
    source.metadata(),
    fs.stat(inputPath),
  ]);
  let pipeline = source.rotate();
  pipeline = hasCropWidth
    ? pipeline.resize(cropWidth, cropHeight, {
      fit: "cover",
      position: "centre",
      withoutEnlargement: true,
    })
    : pipeline.resize(maxEdge, maxEdge, {
      fit: "inside",
      withoutEnlargement: true,
    });
  const outputInfo = await pipeline.webp({ quality }).toFile(outputPath);

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
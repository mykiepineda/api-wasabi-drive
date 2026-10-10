const sharp = require("sharp");

const DEFAULT_MAX_EDGE = 512;
const DEFAULT_QUALITY = 80;

const transformToWebp = async ({
  input,
  maxEdge = DEFAULT_MAX_EDGE,
  quality = DEFAULT_QUALITY,
}) => {
  if (!Buffer.isBuffer(input)) {
    throw new TypeError("Thumbnail transform requires a buffer of source image bytes.");
  }
  if (input.length === 0) {
    throw new Error("Thumbnail transform requires non-empty source bytes.");
  }
  if (!Number.isInteger(maxEdge) || maxEdge < 1) {
    throw new RangeError("Thumbnail maxEdge must be a positive integer.");
  }
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new RangeError("Thumbnail quality must be an integer from 1 through 100.");
  }

  const pipeline = sharp(input)
    .rotate()
    .resize(maxEdge, maxEdge, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    format: info.format,
    contentType: "image/webp",
    bytes: data.length,
    buffer: data,
  };
};

module.exports = {
  DEFAULT_MAX_EDGE,
  DEFAULT_QUALITY,
  transformToWebp,
};

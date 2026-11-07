const sharp = require("sharp");

const DEFAULT_MAX_EDGE = 512;
const DEFAULT_QUALITY = 80;
const DEFAULT_THUMBNAIL_RECIPE_ID = "v1";
const V2_THUMBNAIL_WIDTH = 200;
const V2_THUMBNAIL_HEIGHT = 190;
const THUMBNAIL_RECIPES = Object.freeze({
  v1: Object.freeze({
    width: DEFAULT_MAX_EDGE,
    height: DEFAULT_MAX_EDGE,
    fit: "inside",
    quality: DEFAULT_QUALITY,
    withoutEnlargement: true,
  }),
  v2: Object.freeze({
    width: V2_THUMBNAIL_WIDTH,
    height: V2_THUMBNAIL_HEIGHT,
    fit: "cover",
    position: "centre",
    quality: DEFAULT_QUALITY,
    withoutEnlargement: true,
  }),
});
const ORIENTATION_ROTATION_DEGREES = new Map([
  [1, 0],
  [3, 180],
  [6, 90],
  [8, 270],
]);

class ThumbnailSourceTooSmallError extends Error {
  constructor() {
    super("Thumbnail source is too small for the fixed v2 crop without enlargement.");
    this.name = "ThumbnailSourceTooSmallError";
    this.code = "thumbnail-source-too-small";
  }
}

const isSupportedThumbnailRecipe = (recipeId) =>
  typeof recipeId === "string" && Object.hasOwn(THUMBNAIL_RECIPES, recipeId);

const transformToWebp = async (options = {}) => {
  const { input, recipeId = DEFAULT_THUMBNAIL_RECIPE_ID, fallbackOrientation } = options;
  if (Object.keys(options).some((key) => !["input", "recipeId", "fallbackOrientation"].includes(key))) {
    throw new TypeError("Custom thumbnail transform options are unsupported.");
  }
  if (!Buffer.isBuffer(input)) {
    throw new TypeError("Thumbnail transform requires a buffer of source image bytes.");
  }
  if (input.length === 0) {
    throw new Error("Thumbnail transform requires non-empty source bytes.");
  }
  if (!isSupportedThumbnailRecipe(recipeId)) {
    throw new RangeError("Thumbnail recipe must be one of the fixed supported versions.");
  }

  if (fallbackOrientation !== undefined && !ORIENTATION_ROTATION_DEGREES.has(fallbackOrientation)) {
    throw new RangeError("Thumbnail fallback orientation is unsupported.");
  }

  const recipe = THUMBNAIL_RECIPES[recipeId];
  if (recipeId === "v2") {
    const metadata = await sharp(input).metadata();
    const orientation = fallbackOrientation ?? metadata.orientation;
    const swapsDimensions = orientation >= 5 && orientation <= 8;
    const orientedWidth = swapsDimensions ? metadata.height : metadata.width;
    const orientedHeight = swapsDimensions ? metadata.width : metadata.height;
    if (orientedWidth < recipe.width || orientedHeight < recipe.height) {
      throw new ThumbnailSourceTooSmallError();
    }
  }

  let pipeline = sharp(input);
  pipeline = fallbackOrientation === undefined
    ? pipeline.rotate()
    : pipeline.rotate(ORIENTATION_ROTATION_DEGREES.get(fallbackOrientation));

  const { data, info } = await pipeline
    .resize(recipe.width, recipe.height, {
      fit: recipe.fit,
      ...(recipe.position === undefined ? {} : { position: recipe.position }),
      withoutEnlargement: recipe.withoutEnlargement,
    })
    .webp({ quality: recipe.quality })
    .toBuffer({ resolveWithObject: true });

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
  DEFAULT_THUMBNAIL_RECIPE_ID,
  V2_THUMBNAIL_HEIGHT,
  V2_THUMBNAIL_WIDTH,
  isSupportedThumbnailRecipe,
  transformToWebp,
};

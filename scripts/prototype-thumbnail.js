const fs = require("node:fs/promises");
const path = require("node:path");
const { prototypeThumbnail } = require("../src/thumbnail/prototype");

const parseArguments = (args) => {
  if (args.length < 2) {
    throw new Error("Usage: thumbnail:prototype -- <input-image> <output.webp|directory> [--max-edge <pixels>] [--crop-width <pixels> --crop-height <pixels>] [--quality <1-100>]");
  }

  const [inputPath, outputArgument, ...options] = args;
  const parsed = {
    inputPath,
    outputArgument,
    maxEdge: 512,
    quality: 80,
    maxEdgeSpecified: false,
  };
  const seenOptions = new Set();
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = options[index + 1];
    if (!["--max-edge", "--crop-width", "--crop-height", "--quality"].includes(option)) {
      throw new Error(`Unknown argument: ${option}`);
    }
    if (seenOptions.has(option)) {
      throw new Error(`${option} may only be specified once.`);
    }
    seenOptions.add(option);
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a numeric value.`);
    }
    const numericValue = Number(value);
    if (!Number.isSafeInteger(numericValue)) {
      throw new Error(`${option} requires an integer.`);
    }
    if (option === "--max-edge") {
      parsed.maxEdge = numericValue;
      parsed.maxEdgeSpecified = true;
    } else if (option === "--quality") {
      parsed.quality = numericValue;
    } else {
      if (!/^\d+$/.test(value)) {
        throw new Error(`${option} requires a positive integer.`);
      }
      parsed[option === "--crop-width" ? "cropWidth" : "cropHeight"] = numericValue;
    }
    index += 1;
  }

  const hasCropWidth = parsed.cropWidth !== undefined;
  const hasCropHeight = parsed.cropHeight !== undefined;
  if (hasCropWidth !== hasCropHeight) {
    throw new Error("--crop-width and --crop-height must be specified together.");
  }
  if (hasCropWidth && parsed.maxEdgeSpecified) {
    throw new Error("--max-edge cannot be combined with crop dimensions.");
  }
  if (parsed.maxEdge < 1) {
    throw new Error("Maximum edge must be a positive integer.");
  }
  if (parsed.quality < 1 || parsed.quality > 100) {
    throw new Error("Quality must be from 1 to 100.");
  }
  if (
    hasCropWidth
    && (parsed.cropWidth < 1 || parsed.cropWidth > 10000
      || parsed.cropHeight < 1 || parsed.cropHeight > 10000)
  ) {
    throw new Error("Crop dimensions must be positive integers no greater than 10000.");
  }
  return parsed;
};

const resolveOutputPath = async (inputPath, outputArgument) => {
  const absoluteOutput = path.resolve(outputArgument);
  let outputStats;
  try {
    outputStats = await fs.stat(absoluteOutput);
  } catch {
    outputStats = undefined;
  }

  if (outputStats?.isDirectory() || (!outputStats && !absoluteOutput.toLowerCase().endsWith(".webp"))) {
    await fs.mkdir(absoluteOutput, { recursive: true });
    return path.join(absoluteOutput, `${path.basename(inputPath, path.extname(inputPath))}.webp`);
  }
  if (!absoluteOutput.toLowerCase().endsWith(".webp")) {
    throw new Error("An output file must use the .webp extension.");
  }

  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  return absoluteOutput;
};

const main = async (args) => {
  let options;
  try {
    options = parseArguments(args);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  try {
    const outputPath = await resolveOutputPath(options.inputPath, options.outputArgument);
    const prototypeOptions = {
      inputPath: options.inputPath,
      outputPath,
      quality: options.quality,
    };
    if (options.cropWidth !== undefined) {
      prototypeOptions.cropWidth = options.cropWidth;
      prototypeOptions.cropHeight = options.cropHeight;
    } else if (options.maxEdgeSpecified) {
      prototypeOptions.maxEdge = options.maxEdge;
    }
    const result = await prototypeThumbnail(prototypeOptions);
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error("Thumbnail prototype failed. Check that the input is a supported, decodable image and the output path is writable.");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArguments, resolveOutputPath };
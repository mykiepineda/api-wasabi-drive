const fs = require("node:fs/promises");
const path = require("node:path");
const { prototypeThumbnail } = require("../src/thumbnail/prototype");

const parseArguments = (args) => {
  if (args.length < 2) {
    throw new Error("Usage: thumbnail:prototype -- <input-image> <output.webp|directory> [--max-edge <pixels>] [--quality <1-100>]");
  }

  const [inputPath, outputArgument, ...options] = args;
  const parsed = { inputPath, outputArgument, maxEdge: 512, quality: 80 };
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = options[index + 1];
    if (option !== "--max-edge" && option !== "--quality") {
      throw new Error(`Unknown argument: ${option}`);
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a numeric value.`);
    }
    const numericValue = Number(value);
    if (!Number.isInteger(numericValue)) {
      throw new Error(`${option} requires an integer.`);
    }
    parsed[option === "--max-edge" ? "maxEdge" : "quality"] = numericValue;
    index += 1;
  }

  if (parsed.maxEdge < 1 || parsed.quality < 1 || parsed.quality > 100) {
    throw new Error("Maximum edge must be positive and quality must be from 1 to 100.");
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
    const result = await prototypeThumbnail({ ...options, outputPath });
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
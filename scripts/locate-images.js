require("dotenv").config();

const {
  locateByExtensions,
  locateLargestImages,
} = require("../src/thumbnail/locate");

const parsePositiveInteger = (value, option) => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${option} must be a positive integer.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return number;
};

const parseArguments = (args) => {
  const buckets = [];
  const extensions = [];
  let prefix;
  let largest;
  let limit;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--bucket", "--prefix", "--extension", "--limit", "--largest"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === "--bucket") {
        buckets.push(value.trim());
      } else if (argument === "--prefix") {
        if (prefix !== undefined) {
          throw new Error("--prefix may only be supplied once.");
        }
        prefix = value;
      } else if (argument === "--extension") {
        extensions.push(value);
      } else if (argument === "--limit") {
        if (limit !== undefined) {
          throw new Error("--limit may only be supplied once.");
        }
        limit = parsePositiveInteger(value, "--limit");
      } else {
        if (largest !== undefined) {
          throw new Error("--largest may only be supplied once.");
        }
        largest = parsePositiveInteger(value, "--largest");
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (buckets.length === 0 || buckets.some((bucket) => !bucket)) {
    throw new Error("At least one non-empty --bucket <name> is required.");
  }
  if (largest !== undefined && extensions.length > 0) {
    throw new Error("Use either --largest or --extension, not both.");
  }
  if (largest !== undefined && limit !== undefined) {
    throw new Error("Use --largest <count> instead of combining --largest and --limit.");
  }
  if (largest === undefined && extensions.length === 0) {
    throw new Error("Specify --extension <name> or --largest <count>.");
  }

  return largest !== undefined
    ? { mode: "largest", buckets, prefix, limit: largest }
    : { mode: "extension", buckets, prefix, extensions, limit: limit ?? 20 };
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
    const storage = require("../src/storage/wasabi");
    const result = options.mode === "largest"
      ? await locateLargestImages({ ...options, listPage: storage.getObjectMetadataPage })
      : await locateByExtensions({ ...options, listPage: storage.getObjectMetadataPage });
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error("Image location failed. Verify local configuration, bucket access, and network connectivity.");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArguments, parsePositiveInteger };
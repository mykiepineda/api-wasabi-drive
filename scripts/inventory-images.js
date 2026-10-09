require("dotenv").config();

const { collectInventory } = require("../src/thumbnail/inventory");

const parseArguments = (args) => {
  const buckets = [];
  let prefix;
  let prefixProvided = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--bucket") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--bucket requires a bucket name.");
      }
      buckets.push(value.trim());
      index += 1;
    } else if (argument === "--prefix") {
      const value = args[index + 1];
      if (prefixProvided || !value || value.startsWith("--")) {
        throw new Error("--prefix requires one non-empty prefix.");
      }
      prefix = value;
      prefixProvided = true;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (buckets.length === 0 || buckets.some((bucket) => !bucket)) {
    throw new Error("At least one non-empty --bucket <name> is required.");
  }

  return { buckets, prefix };
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
    const summary = await collectInventory({
      ...options,
      listPage: storage.getObjectMetadataPage,
    });
    console.log(JSON.stringify(summary, null, 2));
  } catch {
    console.error("Inventory failed. Verify local configuration, bucket access, and network connectivity.");
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArguments };
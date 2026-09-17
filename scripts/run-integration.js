const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateIntegrationTarget } = require("./integration-target");

const brunoCommand = process.execPath;
const brunoEntryPoint = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "@usebruno",
  "cli",
  "bin",
  "bru.js"
);
const collectionPath = path.resolve(__dirname, "..", "bruno", "wasabi-drive-api");
const resultPath = path.resolve(__dirname, "..", "bruno-results.xml");
const scope = process.argv[2] ?? "regression";

const scopeOptions = {
  regression: ["--tags", "regression"],
};

if (!scopeOptions[scope]) {
  console.error(`Unknown integration scope: ${scope}`);
  process.exit(1);
}

const target = process.env.INTEGRATION_TARGET;
if (!target || !["local", "development", "test"].includes(target)) {
  console.error(
    "Integration tests require INTEGRATION_TARGET=local, development, or test."
  );
  process.exit(1);
}

try {
  validateIntegrationTarget({
    target,
    baseUrl: process.env.BASE_URL,
    scope,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (target === "test" && !process.env.INTEGRATION_ACCESS_TOKEN?.trim()) {
  console.error(
    "Integration tests targeting test require a non-blank INTEGRATION_ACCESS_TOKEN."
  );
  process.exit(1);
}

const result = spawnSync(
  brunoCommand,
  [
    brunoEntryPoint,
    "run",
    ".",
    "-r",
    "--env",
    "ci",
    ...scopeOptions[scope],
    "--reporter-junit",
    resultPath,
    "--reporter-skip-body",
    "--reporter-skip-all-headers",
  ],
  { cwd: collectionPath, stdio: "inherit" }
);

if (result.error) {
  console.error(`Unable to start Bruno CLI: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
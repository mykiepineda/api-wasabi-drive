const path = require("node:path");
const { spawnSync } = require("node:child_process");

const brunoCommand = process.platform === "win32" ? "bru.cmd" : "bru";
const collectionPath = path.resolve(__dirname, "..", "bruno", "wasabi-drive-api");
const resultPath = path.resolve(__dirname, "..", "bruno-results.xml");

const result = spawnSync(
  brunoCommand,
  ["run", ".", "-r", "--env", "ci", "--output", resultPath, "--format", "junit"],
  { cwd: collectionPath, stdio: "inherit" }
);

if (result.error) {
  console.error(`Unable to start Bruno CLI: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
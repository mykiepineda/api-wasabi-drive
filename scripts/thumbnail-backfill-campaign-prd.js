#!/usr/bin/env node
const { main: runCampaign } = require("../src/thumbnail/production-backfill-campaign");

const main = async (args = process.argv.slice(2)) => {
  let stopRequested = false;
  const requestStop = () => {
    stopRequested = true;
  };
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);
  try {
    return await runCampaign(args, { stopRequested: () => stopRequested });
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
  }
};

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = { main };

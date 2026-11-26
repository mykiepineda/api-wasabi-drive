const fs = require("node:fs");
const path = require("node:path");
const {
  loadProductionBackfillConfig,
  maxObjectsForRecipe,
  parseAuditRecords,
  processingFingerprint,
  readCheckpoint,
  recipeStatePaths,
  validateBucket,
  validatePrivateFilePath,
  validateSourceScope,
  validateStatePaths,
} = require("./production-backfill");

const COUNT_FIELDS = Object.freeze([
  "examined",
  "generated",
  "alreadyPresent",
  "unsupported",
  "oversize",
  "failed",
]);
const SUCCESS_CATEGORIES = new Set(["completed", "paused-cap"]);
const SAFE_CODES = new Set([
  "configuration-rejected",
  "scope-rejected",
  "provider-denied",
  "provider-failure",
  "invalid-state",
  "unknown-write-outcome",
  "state-complete",
  "empty-scope",
]);
const JOB_REQUIRED_KEYS = [
  "sourceBucket",
  "sourceRegion",
  "checkpointPath",
  "auditPath",
  "checkpointBackupPath",
  "auditBackupPath",
  "batchLimit",
];
const JOB_OPTIONAL_KEYS = ["prefix", "wholeBucket", "pageSize"];
const PLAN_KEYS = ["version", "stage", "recipe", "maxSlices", "jobs"];
const CAMPAIGN_MAX_SLICES = 1000;
const DEFAULT_PAGE_SIZE = 5;

const hasExactKeys = (value, required, optional = []) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
};

const isContainedPath = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
};

const pathKey = (target) => process.platform === "win32"
  ? path.resolve(target).toLowerCase()
  : path.resolve(target);

const existingFile = (target, lstatImpl = fs.lstatSync) => {
  try {
    const metadata = lstatImpl(target);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
      throw new Error("invalid-local-state-path");
    }
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const verifyStateBackup = (job, { lstatImpl = fs.lstatSync, readFileImpl = fs.readFileSync } = {}) => {
  const checkpointExists = existingFile(job.paths.checkpointPath, lstatImpl);
  const auditExists = existingFile(job.paths.auditPath, lstatImpl);
  const checkpointBackupExists = existingFile(job.backupPaths.checkpointPath, lstatImpl);
  const auditBackupExists = existingFile(job.backupPaths.auditPath, lstatImpl);
  if (!checkpointExists && auditExists) throw new Error("invalid-state");
  if (checkpointExists !== checkpointBackupExists || auditExists !== auditBackupExists) {
    throw new Error("backup-required");
  }
  if (
    (checkpointExists
      && !readFileImpl(job.paths.checkpointPath).equals(readFileImpl(job.backupPaths.checkpointPath)))
    || (auditExists
      && !readFileImpl(job.paths.auditPath).equals(readFileImpl(job.backupPaths.auditPath)))
  ) {
    throw new Error("backup-mismatch");
  }
};

const parsePlan = (plan) => {
  if (!hasExactKeys(plan, PLAN_KEYS)) throw new Error("invalid-plan");
  if (
    plan.version !== 1
    || plan.stage !== "prd"
    || plan.recipe !== "v2"
    || !Number.isSafeInteger(plan.maxSlices)
    || plan.maxSlices < 1
    || plan.maxSlices > CAMPAIGN_MAX_SLICES
    || !Array.isArray(plan.jobs)
    || plan.jobs.length === 0
  ) {
    throw new Error("invalid-plan");
  }
};

const validateCampaignPlan = ({
  plan,
  planPath,
  env = process.env,
  stateRoot = path.join(path.sep, "state"),
  validatePlanFile = validatePrivateFilePath,
  validatePaths = validateStatePaths,
  lstatImpl = fs.lstatSync,
  readFileImpl = fs.readFileSync,
}) => {
  parsePlan(plan);
  const root = path.resolve(stateRoot);
  if (!path.isAbsolute(stateRoot)) throw new Error("invalid-state-root");
  const realRoot = fs.realpathSync(root);
  if (pathKey(root) !== pathKey(realRoot) || !fs.statSync(realRoot).isDirectory()) {
    throw new Error("invalid-state-root");
  }
  const canonicalPlanPath = validatePlanFile(planPath);
  if (!isContainedPath(realRoot, canonicalPlanPath)) throw new Error("invalid-plan-path");

  const config = loadProductionBackfillConfig(env, "v2");
  if (!config._prdV2) throw new Error("source-enrollment-required");
  const statePathKeys = new Set([pathKey(canonicalPlanPath)]);
  const jobs = [];
  const scopeSelectors = [];

  for (const [index, rawJob] of plan.jobs.entries()) {
    if (!hasExactKeys(rawJob, JOB_REQUIRED_KEYS, JOB_OPTIONAL_KEYS)) {
      throw new Error("invalid-job");
    }
    const hasPrefix = Object.hasOwn(rawJob, "prefix");
    const hasWholeBucket = rawJob.wholeBucket === true;
    if (
      hasPrefix === hasWholeBucket
      || (Object.hasOwn(rawJob, "wholeBucket") && rawJob.wholeBucket !== true)
      || (
        hasPrefix
        && (
          typeof rawJob.prefix !== "string"
          || rawJob.prefix.length === 0
          || /[*?\[\]]/.test(rawJob.prefix)
        )
      )
    ) {
      throw new Error("invalid-selector");
    }
    validateBucket(rawJob.sourceBucket);
    const selector = {
      sourceBucket: rawJob.sourceBucket,
      sourceRegion: rawJob.sourceRegion,
      prefix: hasPrefix ? rawJob.prefix : "",
      wholeBucket: hasWholeBucket,
    };
    validateSourceScope(selector, config, "v2");
    const duplicateOrOverlapping = scopeSelectors.some((previous) =>
      previous.sourceBucket === selector.sourceBucket
      && previous.sourceRegion === selector.sourceRegion
      && (
        previous.prefix === selector.prefix
        || previous.prefix === ""
        || selector.prefix === ""
        || previous.prefix.startsWith(selector.prefix)
        || selector.prefix.startsWith(previous.prefix)
      ));
    if (duplicateOrOverlapping) throw new Error("duplicate-job-scope");
    scopeSelectors.push(selector);

    if (
      !Number.isSafeInteger(rawJob.batchLimit)
      || rawJob.batchLimit < 1
      || rawJob.batchLimit > maxObjectsForRecipe("v2")
      || (
        Object.hasOwn(rawJob, "pageSize")
        && (
          !Number.isSafeInteger(rawJob.pageSize)
          || rawJob.pageSize < 1
          || rawJob.pageSize > 10
        )
      )
    ) {
      throw new Error("invalid-job-limit");
    }
    const pageSize = rawJob.pageSize ?? DEFAULT_PAGE_SIZE;
    const basePaths = {
      checkpointPath: rawJob.checkpointPath,
      auditPath: rawJob.auditPath,
    };
    const backupBasePaths = {
      checkpointPath: rawJob.checkpointBackupPath,
      auditPath: rawJob.auditBackupPath,
    };
    const effectivePaths = recipeStatePaths({ recipeId: "v2", ...basePaths });
    const effectiveBackupPaths = recipeStatePaths({ recipeId: "v2", ...backupBasePaths });
    const paths = validatePaths(effectivePaths);
    const backupPaths = validatePaths(effectiveBackupPaths);
    for (const candidate of [
      paths.checkpointPath,
      paths.auditPath,
      backupPaths.checkpointPath,
      backupPaths.auditPath,
    ]) {
      if (!isContainedPath(realRoot, candidate)) throw new Error("state-path-outside-volume");
      const key = pathKey(candidate);
      if (statePathKeys.has(key)) throw new Error("state-path-collision");
      statePathKeys.add(key);
    }
    const scope = {
      sourceBucket: selector.sourceBucket,
      sourceRegion: selector.sourceRegion,
      prefix: selector.prefix,
      wholeBucket: selector.wholeBucket,
      destinationBucket: config.destinationBucket,
      destinationRegion: config.destinationRegion,
      prdV2: true,
      sourceEnrollment: config._prdV2.enrollment,
    };
    jobs.push({
      index: index + 1,
      scope,
      batchLimit: rawJob.batchLimit,
      pageSize,
      basePaths,
      backupBasePaths,
      paths,
      backupPaths,
      scopeId: processingFingerprint(scope, "v2"),
    });
  }

  const validated = {
    config,
    jobs,
    maxSlices: plan.maxSlices,
    planPath: canonicalPlanPath,
  };
  for (const job of jobs) {
    verifyStateBackup(job, { lstatImpl, readFileImpl });
  }
  return validated;
};

const readCursor = (job, { lstatImpl = fs.lstatSync, assertPrivatePathImpl } = {}) => {
  const checkpointExists = existingFile(job.paths.checkpointPath, lstatImpl);
  const auditExists = existingFile(job.paths.auditPath, lstatImpl);
  if (!checkpointExists && auditExists) throw new Error("invalid-state");
  if (!checkpointExists) return null;
  const checkpoint = readCheckpoint(
    job.paths.checkpointPath,
    job.scope,
    assertPrivatePathImpl,
    "v2",
  );
  return checkpoint.lastCompletedKey;
};

const verifyInitialJobState = (job, { assertPrivatePathImpl, lstatImpl = fs.lstatSync } = {}) => {
  const cursor = readCursor(job, { assertPrivatePathImpl, lstatImpl });
  const audit = parseAuditRecords(
    job.paths.auditPath,
    job.scopeId,
    assertPrivatePathImpl,
    "v2",
  );
  if ([...audit.intents.values()].some((intent) =>
    intent.outcome === null || intent.outcome === "unknown")) {
    throw new Error("unknown-write-outcome");
  }
  return { cursor, resumed: existingFile(job.paths.checkpointPath, lstatImpl) };
};

const parseSliceSummary = (lines, maxObjects) => {
  if (!Array.isArray(lines) || lines.length !== 1 || typeof lines[0] !== "string") {
    throw new Error("unexpected-cli-output");
  }
  let summary;
  try {
    summary = JSON.parse(lines[0]);
  } catch {
    throw new Error("unexpected-cli-output");
  }
  const allowedKeys = ["category", ...COUNT_FIELDS, "code"].sort();
  if (
    !summary
    || typeof summary !== "object"
    || Array.isArray(summary)
    || Object.keys(summary).some((key) => !allowedKeys.includes(key))
    || !["category", ...COUNT_FIELDS].every((key) => Object.hasOwn(summary, key))
    || (summary.code !== undefined && !SAFE_CODES.has(summary.code))
    || !["completed", "paused-cap", "failed"].includes(summary.category)
    || COUNT_FIELDS.some((key) => !Number.isSafeInteger(summary[key]) || summary[key] < 0)
    || summary.examined > maxObjects
    || summary.failed > summary.examined + 1
    || summary.generated + summary.alreadyPresent + summary.unsupported + summary.oversize
      > summary.examined
  ) {
    throw new Error("invalid-cli-summary");
  }
  if (SUCCESS_CATEGORIES.has(summary.category)) {
    const reconciled = COUNT_FIELDS.slice(1).reduce((total, key) => total + summary[key], 0);
    if (
      summary.failed !== 0
      || reconciled !== summary.examined
      || (
        summary.category === "paused-cap"
        && summary.examined !== maxObjects
      )
    ) {
      throw new Error("invalid-cli-summary");
    }
  }
  return summary;
};

const cursorAdvanced = (previous, current) =>
  typeof current === "string"
  && (
    previous === null
    || Buffer.compare(Buffer.from(current, "utf8"), Buffer.from(previous, "utf8")) > 0
  );

const zeroCounts = () => Object.fromEntries(COUNT_FIELDS.map((key) => [key, 0]));
const addCounts = (target, source) => {
  for (const field of COUNT_FIELDS) target[field] += source[field];
};
const makeJobProgress = (job, scanState = "not-started") => ({
  jobIndex: job.index,
  category: "not-started",
  scanState,
  slices: 0,
  ...zeroCounts(),
});

const invokeProductionCli = async (args, { env, runCli = require("../../scripts/thumbnail-backfill-prd").main } = {}) => {
  const output = [];
  const exitCode = await runCli(args, { env, write: (line) => output.push(line) });
  return { exitCode, output };
};

const runCampaign = async ({
  campaign,
  env,
  runSlice = (args, options) => invokeProductionCli(args, { env: options.env }),
  stopRequested = () => false,
  writeProgress = () => {},
  assertPrivatePathImpl,
  lstatImpl = fs.lstatSync,
}) => {
  const jobProgress = campaign.jobs.map((job) => makeJobProgress(job));
  const totals = zeroCounts();
  let slices = 0;
  let category = "completed";
  try {
    const initialStates = [];
    for (const [index, job] of campaign.jobs.entries()) {
      try {
        initialStates.push(verifyInitialJobState(job, { assertPrivatePathImpl, lstatImpl }));
      } catch {
        jobProgress[index].category = "failed";
        return { category: "failed", slices, totals, jobs: jobProgress };
      }
    }
    for (const [jobIndex, job] of campaign.jobs.entries()) {
      const progress = jobProgress[jobIndex];
      while (progress.category !== "completed") {
        if (stopRequested()) {
          category = "stopped";
          if (progress.category === "not-started" && progress.slices > 0) {
            progress.category = "paused-cap";
          }
          return { category, slices, totals, jobs: jobProgress };
        }
        if (slices >= campaign.maxSlices) {
          category = "paused-budget";
          if (progress.slices > 0) progress.category = "paused-cap";
          return { category, slices, totals, jobs: jobProgress };
        }

        const previousCursor = readCursor(job, { lstatImpl, assertPrivatePathImpl });
        const args = [
          "--source-bucket", job.scope.sourceBucket,
          "--source-region", job.scope.sourceRegion,
          ...(job.scope.wholeBucket
            ? ["--whole-bucket"]
            : ["--prefix", job.scope.prefix]),
          "--max-objects", String(job.batchLimit),
          "--page-size", String(job.pageSize),
          "--recipe", "v2",
          "--checkpoint", job.basePaths.checkpointPath,
          "--audit", job.basePaths.auditPath,
          "--execute",
          "--confirm-prd-backfill",
        ];
        if (progress.scanState === "not-started") {
          progress.scanState = initialStates[jobIndex].resumed
            ? "resumed-existing-scan"
            : "started-new-scan";
        }
        let sliceResult;
        try {
          sliceResult = await runSlice(args, { env, jobIndex: job.index, sliceIndex: slices + 1 });
        } catch {
          progress.category = "failed";
          return { category: "failed", slices, totals, jobs: jobProgress };
        }
        let summary;
        try {
          summary = parseSliceSummary(sliceResult?.output, job.batchLimit);
        } catch {
          progress.category = "failed";
          return { category: "failed", slices, totals, jobs: jobProgress };
        }
        slices += 1;
        progress.slices += 1;
        addCounts(progress, summary);
        addCounts(totals, summary);
        if (sliceResult.exitCode !== 0 || summary.category === "failed") {
          progress.category = "failed";
          return { category: "failed", slices, totals, jobs: jobProgress };
        }

        let currentCursor;
        try {
          currentCursor = readCursor(job, { lstatImpl, assertPrivatePathImpl });
        } catch {
          progress.category = "failed";
          return { category: "failed", slices, totals, jobs: jobProgress };
        }
        if (
          (summary.examined > 0 && !cursorAdvanced(previousCursor, currentCursor))
          || (
            summary.examined === 0
            && summary.category === "completed"
            && currentCursor !== previousCursor
          )
          || (
            summary.category === "paused-cap"
            && (summary.examined === 0 || !cursorAdvanced(previousCursor, currentCursor))
          )
        ) {
          progress.category = "failed";
          return { category: "failed", slices, totals, jobs: jobProgress };
        }
        progress.category = summary.category;
        writeProgress({
          jobIndex: job.index,
          slice: progress.slices,
          category: summary.category,
          ...totals,
        });
      }
    }
  } catch {
    category = "failed";
  }
  return { category, slices, totals, jobs: jobProgress };
};

const parseArguments = (args) => {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--plan") {
      if (
        values.has(argument)
        || typeof args[index + 1] !== "string"
        || !args[index + 1]
      ) {
        throw new Error("invalid-arguments");
      }
      values.set(argument, args[index + 1]);
      index += 1;
    } else if (["--execute-campaign", "--confirm-prd-campaign", "--validate-plan"].includes(argument)) {
      if (flags.has(argument)) throw new Error("invalid-arguments");
      flags.add(argument);
    } else {
      throw new Error("invalid-arguments");
    }
  }
  if (!values.has("--plan")) throw new Error("invalid-arguments");
  const execute = flags.has("--execute-campaign");
  if (execute !== flags.has("--confirm-prd-campaign")) throw new Error("invalid-arguments");
  if (execute && flags.has("--validate-plan")) throw new Error("invalid-arguments");
  return {
    planPath: values.get("--plan"),
    execute,
  };
};

const emptySummary = (category) => ({
  category,
  slices: 0,
  jobs: [],
  ...zeroCounts(),
});

const main = async (
  args = process.argv.slice(2),
  {
    env = process.env,
    write = (message) => console.log(message),
    stateRoot = path.join(path.sep, "state"),
    validatePlanFile = validatePrivateFilePath,
    validatePaths = validateStatePaths,
    readFileImpl = fs.readFileSync,
    lstatImpl = fs.lstatSync,
    assertPrivatePathImpl,
    runSlice,
    stopRequested,
  } = {},
) => {
  let options;
  try {
    options = parseArguments(args);
    const canonicalPlanPath = validatePlanFile(options.planPath);
    const plan = JSON.parse(readFileImpl(canonicalPlanPath, "utf8"));
    const campaign = validateCampaignPlan({
      plan,
      planPath: canonicalPlanPath,
      env,
      stateRoot,
      validatePlanFile: () => canonicalPlanPath,
      validatePaths,
      lstatImpl,
      readFileImpl,
    });
    if (!options.execute) {
      write(JSON.stringify({
        category: "validated",
        jobs: campaign.jobs.length,
        maxSlices: campaign.maxSlices,
      }));
      return 0;
    }
    const result = await runCampaign({
      campaign,
      env,
      runSlice,
      stopRequested,
      writeProgress: (progress) => write(JSON.stringify({ type: "progress", ...progress })),
      assertPrivatePathImpl,
      lstatImpl,
    });
    const summary = {
      category: result.category,
      slices: result.slices,
      jobs: result.jobs,
      ...result.totals,
    };
    write(JSON.stringify(summary));
    return result.category === "completed" ? 0 : 1;
  } catch {
    write(JSON.stringify(emptySummary("failed")));
    return 1;
  }
};

module.exports = {
  CAMPAIGN_MAX_SLICES,
  DEFAULT_PAGE_SIZE,
  COUNT_FIELDS,
  main,
  parseArguments,
  parseSliceSummary,
  runCampaign,
  validateCampaignPlan,
};

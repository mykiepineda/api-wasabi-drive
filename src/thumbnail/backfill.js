const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { evaluateThumbnailEligibility } = require("./eligibility");
const { generateThumbnailForObject } = require("./generate");
const { normalizeEtag } = require("./key");
const { MAX_SOURCE_BYTES, validateWasabiRegion } = require("../storage/thumbnail-wasabi");

const DEFAULT_MAX_OBJECTS = 10;
const DEFAULT_PAGE_SIZE = 5;
const CHECKPOINT_SCHEMA_VERSION = 1;
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TERMINAL_CATEGORIES = new Set(["generated", "already-present", "unsupported", "oversize"]);
const TEST_BUCKET_PATTERN = /(^|[-_.])test([-_.]|$)/i;
const PRODUCTION_BUCKET_PATTERN = /(^|[-_.])(prod|prd|production)([-_.]|$)/i;

const normalizePrefix = (prefix) => {
  if (typeof prefix !== "string" || !prefix.trim()) {
    throw new Error("invalid-prefix");
  }
  const normalized = prefix.trim();
  if (
    !normalized.startsWith("pilot/")
    || normalized.includes("\\")
    || normalized.includes("//")
    || normalized.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("invalid-prefix");
  }
  return normalized;
};

const validateScope = ({ sourceBucket, sourceRegion, prefix, destinationBucket, destinationRegion }) => {
  if (
    typeof sourceBucket !== "string"
    || !sourceBucket.trim()
    || !TEST_BUCKET_PATTERN.test(sourceBucket)
    || PRODUCTION_BUCKET_PATTERN.test(sourceBucket)
  ) {
    throw new Error("invalid-source-bucket");
  }
  if (
    typeof destinationBucket !== "string"
    || !destinationBucket.trim()
    || !TEST_BUCKET_PATTERN.test(destinationBucket)
    || PRODUCTION_BUCKET_PATTERN.test(destinationBucket)
    || sourceBucket === destinationBucket
  ) {
    throw new Error("invalid-destination-bucket");
  }
  validateWasabiRegion(sourceRegion);
  validateWasabiRegion(destinationRegion);
  if (destinationRegion !== "ap-southeast-1") {
    throw new Error("invalid-destination-region");
  }
  return {
    sourceBucket: sourceBucket.trim(),
    sourceRegion,
    prefix: normalizePrefix(prefix),
    destinationBucket: destinationBucket.trim(),
    destinationRegion,
  };
};

const canonicalPath = (targetPath) => {
  let existingPath = path.resolve(targetPath);
  const missingParts = [];
  while (!fs.existsSync(existingPath)) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) {
      throw new Error("invalid-checkpoint-path");
    }
    missingParts.unshift(path.basename(existingPath));
    existingPath = parent;
  }
  return path.resolve(fs.realpathSync(existingPath), ...missingParts);
};

const checkpointPathIsOutsideRepo = (checkpointPath) => {
  if (typeof checkpointPath !== "string" || !checkpointPath.trim()) {
    return false;
  }
  let resolved;
  let repositoryRoot;
  try {
    resolved = canonicalPath(checkpointPath);
    repositoryRoot = fs.realpathSync(REPO_ROOT);
  } catch {
    return false;
  }
  const relative = path.relative(repositoryRoot, resolved);
  return relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
};

const buildCheckpoint = ({ scope, lastCompletedKey }) => ({
  version: CHECKPOINT_SCHEMA_VERSION,
  scope,
  lastCompletedKey: typeof lastCompletedKey === "string" ? lastCompletedKey : null,
});

const readCheckpoint = (checkpointPath, scope) => {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  } catch {
    throw new Error("invalid-checkpoint");
  }

  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(",") !== "lastCompletedKey,scope,version"
  ) {
    throw new Error("invalid-checkpoint");
  }
  if (parsed.version !== CHECKPOINT_SCHEMA_VERSION) {
    throw new Error("checkpoint-version-mismatch");
  }
  if (
    typeof parsed.lastCompletedKey !== "string" && parsed.lastCompletedKey !== null
  ) {
    throw new Error("invalid-checkpoint");
  }
  if (
    parsed.lastCompletedKey !== null
    && !parsed.lastCompletedKey.startsWith(scope.prefix)
  ) {
    throw new Error("invalid-checkpoint");
  }
  if (
    !parsed.scope
    || typeof parsed.scope !== "object"
    || Array.isArray(parsed.scope)
    || Object.keys(parsed.scope).sort().join(",")
      !== "destinationBucket,destinationRegion,prefix,sourceBucket,sourceRegion"
  ) {
    throw new Error("invalid-checkpoint");
  }
  if (Object.keys(scope).some((key) => parsed.scope[key] !== scope[key])) {
    throw new Error("checkpoint-scope-mismatch");
  }
  return parsed;
};

const checkpointFileExists = (checkpointPath) => {
  try {
    const metadata = fs.lstatSync(checkpointPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("invalid-checkpoint");
    }
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw new Error("invalid-checkpoint");
  }
};

const writeCheckpointAtomically = (checkpointPath, checkpoint) => {
  const directory = path.dirname(checkpointPath);
  let temporaryPath;
  let descriptor;
  try {
    fs.mkdirSync(directory, { recursive: true });
    temporaryPath = `${checkpointPath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, checkpointPath);
  } catch {
    if (typeof descriptor === "number") {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The write failure remains authoritative.
      }
    }
    if (temporaryPath) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw new Error("checkpoint-cleanup-failed");
        }
      }
    }
    throw new Error("checkpoint-write-failed");
  }
};

const acquireLock = (checkpointPath) => {
  const lockPath = `${checkpointPath}.lock`;
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  } catch {
    throw new Error("lock-directory-unavailable");
  }

  try {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    const identity = fs.fstatSync(fd);
    return { fd, lockPath, dev: identity.dev, ino: identity.ino };
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error("lock-already-held");
    }
    throw new Error("lock-acquisition-failed");
  }
};

const releaseLock = (lock) => {
  if (!lock || typeof lock.fd !== "number") {
    return;
  }
  fs.closeSync(lock.fd);
  try {
    const current = fs.lstatSync(lock.lockPath);
    if (current.dev !== lock.dev || current.ino !== lock.ino) {
      throw new Error("lock-ownership-lost");
    }
    fs.unlinkSync(lock.lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error("lock-release-failed");
    }
  }
};

const ensureOrderedPage = ({ page, prefix, startAfter, maxKeys }) => {
  if (!page || typeof page !== "object" || typeof page.IsTruncated !== "boolean") {
    throw new Error("invalid-list-page");
  }
  if (page.Contents !== undefined && !Array.isArray(page.Contents)) {
    throw new Error("invalid-list-page");
  }
  const contents = page.Contents ?? [];
  if (contents.length > maxKeys) {
    throw new Error("invalid-list-page");
  }
  const keys = contents.map((object) => object?.Key);
  if (keys.some((key) => typeof key !== "string" || !key.trim())) {
    throw new Error("invalid-page-contents");
  }
  for (let index = 0; index < keys.length; index += 1) {
    if (!keys[index].startsWith(prefix)) {
      throw new Error("invalid-page-key");
    }
    if (index > 0 && keys[index] <= keys[index - 1]) {
      throw new Error("page-order-mismatch");
    }
    if (typeof startAfter === "string" && keys[index] <= startAfter) {
      throw new Error("page-order-mismatch");
    }
  }
  if (page.IsTruncated && contents.length === 0) {
    throw new Error("invalid-list-page");
  }
  return contents;
};

const extensionFromKey = (key) => {
  const basename = key.slice(key.lastIndexOf("/") + 1);
  const dotIndex = basename.lastIndexOf(".");
  return dotIndex >= 0 && dotIndex < basename.length - 1
    ? basename.slice(dotIndex + 1).toLowerCase()
    : "";
};

const classifyListObject = async ({
  sourceBucket,
  sourceRegion,
  prefix,
  object,
  generate = generateThumbnailForObject,
  dryRun,
  destinationBucket,
  destinationRegion,
  storage,
}) => {
  const key = object?.Key;
  if (typeof key !== "string" || !key.trim() || !key.startsWith(prefix)) {
    return { category: "failed", count: 1, reason: "invalid-key" };
  }
  if (key.endsWith("/")) {
    return { category: "unsupported", count: 1, reason: "folder-marker" };
  }

  const size = object.Size;
  if (!Number.isSafeInteger(size) || size < 0) {
    return { category: "failed", count: 1, reason: "invalid-object-size" };
  }
  if (size === 0) {
    return { category: "unsupported", count: 1, reason: "zero-byte-object" };
  }
  if (size > MAX_SOURCE_BYTES) {
    return { category: "oversize", count: 1, reason: "source-too-large" };
  }

  const extension = extensionFromKey(key);
  const eligibility = evaluateThumbnailEligibility({
    size,
    extension,
    sourceKey: key,
    region: sourceRegion,
    bucket: sourceBucket,
    etag: '"valid-etag"',
  });
  if (!eligibility.eligible) {
    return {
      category: "unsupported",
      count: 1,
      reason: eligibility.reason || "unsupported-format",
    };
  }
  if (typeof object.ETag !== "string" || !normalizeEtag(object.ETag)) {
    return { category: "failed", count: 1, reason: "missing-source-etag" };
  }

  return generate({
    sourceBucket,
    sourceKey: key,
    sourceRegion,
    destinationBucket,
    destinationRegion,
    storage,
    dryRun,
  });
};

const emptySummary = (dryRun) => ({
  category: dryRun ? "dry-run" : "completed",
  examined: 0,
  generated: 0,
  alreadyPresent: 0,
  unsupported: 0,
  oversize: 0,
  failed: 0,
});

const failSummary = (summary) => ({
  ...summary,
  category: "failed",
  failed: summary.failed + 1,
  stopReason: "failure",
});

const runBackfillScan = async ({
  sourceBucket,
  sourceRegion,
  prefix,
  destinationBucket,
  destinationRegion,
  storage,
  maxObjects = DEFAULT_MAX_OBJECTS,
  pageSize = DEFAULT_PAGE_SIZE,
  dryRun = true,
  checkpointPath,
  generate = generateThumbnailForObject,
}) => {
  if (!Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > DEFAULT_MAX_OBJECTS) {
    throw new Error("invalid-max-objects");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10) {
    throw new Error("invalid-page-size");
  }
  if (!storage || typeof storage.listSourcePage !== "function") {
    throw new Error("missing-source-listing");
  }

  const scope = validateScope({
    sourceBucket,
    sourceRegion,
    prefix,
    destinationBucket,
    destinationRegion,
  });
  const resolvedCheckpointPath = checkpointPath ? path.resolve(checkpointPath) : undefined;
  if (!dryRun && (
    !resolvedCheckpointPath
    || !path.isAbsolute(checkpointPath)
    || !checkpointPathIsOutsideRepo(resolvedCheckpointPath)
  )) {
    throw new Error("invalid-checkpoint-path");
  }
  if (dryRun && checkpointPath && !checkpointPathIsOutsideRepo(resolvedCheckpointPath)) {
    throw new Error("invalid-checkpoint-path");
  }

  let lock;
  const summary = emptySummary(dryRun);
  try {
    let lastCompletedKey = null;
    if (!dryRun) {
      lock = acquireLock(resolvedCheckpointPath);
      if (checkpointFileExists(resolvedCheckpointPath)) {
        lastCompletedKey = readCheckpoint(resolvedCheckpointPath, scope).lastCompletedKey;
      }
    }

    let startAfter = lastCompletedKey ?? undefined;
    while (summary.examined < maxObjects) {
      const remaining = maxObjects - summary.examined;
      let page;
      try {
        page = await storage.listSourcePage({
          bucket: scope.sourceBucket,
          region: scope.sourceRegion,
          prefix: scope.prefix,
          maxKeys: Math.min(pageSize, remaining),
          startAfter,
        });
      } catch {
        return failSummary(summary);
      }

      let contents;
      try {
        contents = ensureOrderedPage({
          page,
          prefix: scope.prefix,
          startAfter,
          maxKeys: Math.min(pageSize, maxObjects - summary.examined),
        });
      } catch {
        return failSummary(summary);
      }
      if (contents.length === 0) {
        return summary;
      }

      for (const object of contents) {
        if (summary.examined >= maxObjects) {
          break;
        }
        summary.examined += 1;

        let result;
        try {
          result = await classifyListObject({
            sourceBucket: scope.sourceBucket,
            sourceRegion: scope.sourceRegion,
            prefix: scope.prefix,
            object,
            generate,
            dryRun,
            destinationBucket: scope.destinationBucket,
            destinationRegion: scope.destinationRegion,
            storage,
          });
        } catch {
          return failSummary(summary);
        }

        const category = result?.category;
        const knownTerminal = TERMINAL_CATEGORIES.has(category)
          || (dryRun && category === "dry-run");
        if (
          !result
          || typeof result !== "object"
          || Array.isArray(result)
          || result.count !== 1
          || !knownTerminal
        ) {
          return failSummary(summary);
        }
        if (dryRun && category === "generated") {
          return failSummary(summary);
        }

        if (category === "generated") {
          summary.generated += 1;
        } else if (category === "already-present") {
          summary.alreadyPresent += 1;
        } else if (category === "unsupported") {
          summary.unsupported += 1;
        } else if (category === "oversize") {
          summary.oversize += 1;
        }

        if (!dryRun) {
          try {
            lastCompletedKey = object.Key;
            writeCheckpointAtomically(resolvedCheckpointPath, buildCheckpoint({
              scope,
              lastCompletedKey,
            }));
          } catch {
            return failSummary(summary);
          }
        }
        startAfter = object.Key;
      }

      if (summary.examined >= maxObjects) {
        if (page.IsTruncated) {
          summary.category = "paused-cap";
        }
        return summary;
      }
      if (!page.IsTruncated) {
        return summary;
      }
      startAfter = lastCompletedKey ?? startAfter;
    }
    return summary;
  } catch {
    return failSummary(summary);
  } finally {
    if (lock) {
      releaseLock(lock);
    }
  }
};

module.exports = {
  CHECKPOINT_SCHEMA_VERSION,
  DEFAULT_MAX_OBJECTS,
  DEFAULT_PAGE_SIZE,
  acquireLock,
  buildCheckpoint,
  checkpointPathIsOutsideRepo,
  classifyListObject,
  ensureOrderedPage,
  normalizePrefix,
  readCheckpoint,
  releaseLock,
  runBackfillScan,
  validateScope,
  writeCheckpointAtomically,
};

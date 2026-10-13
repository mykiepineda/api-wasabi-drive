const fs = require("node:fs");
const path = require("node:path");
const { evaluateThumbnailEligibility } = require("./eligibility");
const { generateThumbnailForObject } = require("./generate");
const { normalizeEtag } = require("./key");
const { MAX_SOURCE_BYTES, validateWasabiRegion } = require("../storage/thumbnail-wasabi");

const DEFAULT_MAX_OBJECTS = 10;
const DEFAULT_PAGE_SIZE = 5;
const CHECKPOINT_SCHEMA_VERSION = 1;
const REPO_ROOT = path.resolve(__dirname, "..");

const normalizePrefix = (prefix) => {
  if (typeof prefix !== "string") {
    throw new Error("invalid-prefix");
  }
  const trimmed = prefix.trim();
  if (!trimmed) {
    throw new Error("invalid-prefix");
  }
  if (trimmed === "pilot") {
    return "pilot/";
  }
  if (!trimmed.startsWith("pilot/")) {
    throw new Error("invalid-prefix");
  }
  const normalized = trimmed.replace(/\\+/g, "/");
  if (normalized.includes("//") || normalized.includes("..")) {
    throw new Error("invalid-prefix");
  }
  return normalized;
};

const isTerminatingCategory = (category) => new Set([
  "generated",
  "already-present",
  "unsupported",
  "oversize",
  "dry-run",
]).has(category);

const validateScope = ({ sourceBucket, sourceRegion, prefix, destinationBucket, destinationRegion }) => {
  if (typeof sourceBucket !== "string" || !sourceBucket.trim()) {
    throw new Error("invalid-source-bucket");
  }
  if (typeof sourceRegion !== "string" || !sourceRegion.trim()) {
    throw new Error("invalid-source-region");
  }
  if (typeof prefix !== "string" || !prefix.trim()) {
    throw new Error("invalid-prefix");
  }
  if (typeof destinationBucket !== "string" || !destinationBucket.trim()) {
    throw new Error("invalid-destination-bucket");
  }
  if (typeof destinationRegion !== "string" || !destinationRegion.trim()) {
    throw new Error("invalid-destination-region");
  }
  validateWasabiRegion(sourceRegion);
  validateWasabiRegion(destinationRegion);
  return {
    sourceBucket: sourceBucket.trim(),
    sourceRegion: sourceRegion.trim(),
    prefix: normalizePrefix(prefix),
    destinationBucket: destinationBucket.trim(),
    destinationRegion: destinationRegion.trim(),
  };
};

const checkpointPathIsOutsideRepo = (checkpointPath) => {
  if (typeof checkpointPath !== "string" || !checkpointPath.trim()) {
    return false;
  }
  const resolved = path.resolve(checkpointPath);
  return resolved !== REPO_ROOT && !resolved.startsWith(`${REPO_ROOT}${path.sep}`);
};

const buildCheckpoint = ({ scope, lastCompletedKey }) => ({
  version: CHECKPOINT_SCHEMA_VERSION,
  scope,
  lastCompletedKey: typeof lastCompletedKey === "string" ? lastCompletedKey : null,
});

const readCheckpoint = (checkpointPath, scope) => {
  if (!checkpointPath || !fs.existsSync(checkpointPath)) {
    return null;
  }
  const raw = fs.readFileSync(checkpointPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid-checkpoint");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid-checkpoint");
  }
  if (parsed.version !== CHECKPOINT_SCHEMA_VERSION) {
    throw new Error("checkpoint-version-mismatch");
  }
  if (typeof parsed.lastCompletedKey !== "string" && parsed.lastCompletedKey !== null) {
    throw new Error("invalid-checkpoint");
  }
  if (!parsed.scope || typeof parsed.scope !== "object") {
    throw new Error("invalid-checkpoint");
  }

  if (JSON.stringify(parsed.scope) !== JSON.stringify(scope)) {
    throw new Error("checkpoint-scope-mismatch");
  }
  return parsed;
};

const writeCheckpointAtomically = (checkpointPath, checkpoint) => {
  const directory = path.dirname(checkpointPath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = `${checkpointPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, checkpointPath);
};

const acquireLock = (checkpointPath) => {
  const lockPath = `${checkpointPath}.lock`;
  try {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    return { fd, lockPath };
  } catch {
    throw new Error("lock-already-held");
  }
};

const releaseLock = (lock) => {
  if (!lock || typeof lock.fd !== "number") {
    return;
  }
  fs.closeSync(lock.fd);
  try {
    fs.unlinkSync(lock.lockPath);
  } catch {
    // Ignore stale lock cleanup errors; do not remove another process's lock.
  }
};

const ensureOrderedPage = ({ page, prefix, startAfter }) => {
  const contents = Array.isArray(page?.Contents) ? page.Contents : [];
  if (contents.some((object) => typeof object?.Key !== "string" || !object.Key.trim())) {
    throw new Error("invalid-page-contents");
  }
  const keys = contents.map((object) => object.Key);
  for (const key of keys) {
    if (!key.startsWith(prefix)) {
      throw new Error("invalid-page-key");
    }
  }
  for (let index = 1; index < keys.length; index += 1) {
    if (keys[index] <= keys[index - 1]) {
      throw new Error("page-order-mismatch");
    }
  }
  if (typeof startAfter === "string" && keys.length > 0 && keys[0] <= startAfter) {
    throw new Error("page-order-mismatch");
  }
  return contents;
};

const classifyListObject = ({
  sourceBucket,
  sourceRegion,
  prefix,
  object,
  generate,
  dryRun,
  destinationBucket,
  destinationRegion,
  storage,
}) => {
  const key = object?.Key;
  if (typeof key !== "string" || !key.trim()) {
    return { category: "failed", reason: "invalid-key" };
  }
  if (key.endsWith("/")) {
    return { category: "unsupported", reason: "folder-marker" };
  }
  if (!key.startsWith(prefix)) {
    return { category: "failed", reason: "out-of-scope-key" };
  }

  const size = Number.isFinite(object.Size) ? Number(object.Size) : NaN;
  if (!Number.isSafeInteger(size) || size < 0) {
    return { category: "failed", reason: "invalid-object-size" };
  }
  if (size === 0) {
    return { category: "unsupported", reason: "zero-byte-object" };
  }
  if (size > MAX_SOURCE_BYTES) {
    return { category: "oversize", reason: "source-too-large" };
  }

  const etag = typeof object.ETag === "string" ? object.ETag : "";
  if (!normalizeEtag(etag)) {
    return { category: "failed", reason: "missing-source-etag" };
  }

  const basename = key.slice(key.lastIndexOf("/") + 1);
  const extensionIndex = basename.lastIndexOf(".");
  const extension = extensionIndex >= 0 && extensionIndex < basename.length - 1
    ? basename.slice(extensionIndex + 1).toLowerCase()
    : "";

  const eligibility = evaluateThumbnailEligibility({
    size,
    extension,
    sourceKey: key,
    region: sourceRegion,
    bucket: sourceBucket,
    etag,
  });

  if (!eligibility.eligible) {
    return { category: "unsupported", reason: eligibility.reason || "unsupported-format" };
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

  const normalizedCheckpointPath = checkpointPath && typeof checkpointPath === "string"
    ? path.resolve(checkpointPath)
    : undefined;

  if (!dryRun && (!normalizedCheckpointPath || !checkpointPathIsOutsideRepo(normalizedCheckpointPath))) {
    throw new Error("invalid-checkpoint-path");
  }

  let checkpointState = null;
  if (!dryRun && normalizedCheckpointPath && fs.existsSync(normalizedCheckpointPath)) {
    checkpointState = readCheckpoint(normalizedCheckpointPath, scope);
  }
  if (!dryRun && checkpointState === null && normalizedCheckpointPath) {
    checkpointState = buildCheckpoint({ scope, lastCompletedKey: null });
  }

  let lastCompletedKey = checkpointState?.lastCompletedKey ?? null;
  let lockHandle = null;
  if (!dryRun && normalizedCheckpointPath) {
    lockHandle = acquireLock(normalizedCheckpointPath);
  }

  try {
    const summary = {
      category: dryRun ? "dry-run" : "completed",
      examined: 0,
      generated: 0,
      alreadyPresent: 0,
      unsupported: 0,
      oversize: 0,
      failed: 0,
      pausedCap: 0,
    };

    let startAfter = lastCompletedKey || undefined;
    let remaining = maxObjects;

    while (remaining > 0) {
      const effectivePageSize = Math.min(pageSize, remaining);
      const page = await storage.listSourcePage({
        bucket: scope.sourceBucket,
        region: scope.sourceRegion,
        prefix: scope.prefix,
        maxKeys: effectivePageSize,
        startAfter,
      });
      const contents = ensureOrderedPage({ page, prefix: scope.prefix, startAfter });

      if (contents.length === 0) {
        break;
      }

      for (const object of contents) {
        if (summary.examined >= maxObjects) {
          break;
        }

        const result = classifyListObject({
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

        summary.examined += 1;

        if (result.category === "generated") {
          summary.generated += 1;
        } else if (result.category === "already-present") {
          summary.alreadyPresent += 1;
        } else if (result.category === "unsupported") {
          summary.unsupported += 1;
        } else if (result.category === "oversize") {
          summary.oversize += 1;
        } else if (["failed", "etag-mismatch", "precondition-unsupported"].includes(result.category)) {
          summary.failed += 1;
          summary.category = "failed";
          return { ...summary, stopReason: result.reason || result.category };
        }

        if (!dryRun && isTerminatingCategory(result.category)) {
          lastCompletedKey = object.Key;
          writeCheckpointAtomically(normalizedCheckpointPath, buildCheckpoint({
            scope,
            lastCompletedKey,
          }));
        }

        if (summary.examined >= maxObjects) {
          summary.pausedCap = 1;
          summary.category = "paused-cap";
          break;
        }

        startAfter = object.Key;
        remaining -= 1;
      }

      if (summary.examined >= maxObjects) {
        break;
      }
      if (!page.IsTruncated) {
        break;
      }
      startAfter = contents[contents.length - 1].Key;
      remaining = Math.max(0, maxObjects - summary.examined);
    }

    if (!dryRun && normalizedCheckpointPath && summary.category !== "failed") {
      writeCheckpointAtomically(normalizedCheckpointPath, buildCheckpoint({
        scope,
        lastCompletedKey,
      }));
    }

    return summary;
  } finally {
    if (lockHandle) {
      releaseLock(lockHandle);
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
};

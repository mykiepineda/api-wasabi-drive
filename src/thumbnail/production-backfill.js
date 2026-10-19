const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { evaluateThumbnailEligibility } = require("./eligibility");
const { generateThumbnailForObject } = require("./generate");
const { normalizeEtag } = require("./key");
const { MAX_SOURCE_BYTES } = require("./policy");
const { SUPPORTED_WASABI_REGIONS } = require("../storage/wasabi-regions");
const { validDerivedKey } = require("../storage/thumbnail-prd-backfill-wasabi");

const MAX_OBJECTS = 10;
const DEFAULT_PAGE_SIZE = 5;
const CHECKPOINT_VERSION = 1;
const LOCK_PATH = path.join(os.homedir(), ".wasabi-drive-thumbnail-backfill-prd.lock");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEST_BUCKET_PATTERN = /(^|[-_.])test/i;
const TERMINAL_CATEGORIES = new Set(["generated", "already-present", "unsupported", "oversize"]);
const CONFIG_KEYS = {
  stage: "THUMBNAIL_PRD_BACKFILL_STAGE",
  sourceBucket: "THUMBNAIL_PRD_BACKFILL_SOURCE_BUCKET",
  sourceRegion: "THUMBNAIL_PRD_BACKFILL_SOURCE_REGION",
  prefix: "THUMBNAIL_PRD_BACKFILL_SOURCE_PREFIX",
  destinationBucket: "THUMBNAIL_PRD_BACKFILL_DERIVED_BUCKET",
  destinationRegion: "THUMBNAIL_PRD_BACKFILL_DERIVED_REGION",
  accessKeyId: "THUMBNAIL_PRD_BACKFILL_WASABI_ACCESS_KEY_ID",
  secretAccessKey: "THUMBNAIL_PRD_BACKFILL_WASABI_SECRET_ACCESS_KEY",
};
const FORBIDDEN_ENV_NAMES = new Set([
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SECURITY_TOKEN",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CONFIG_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_ENDPOINT",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
]);

const isSafeValue = (value) =>
  typeof value === "string"
  && value.length > 0
  && value === value.trim()
  && !/[\u0000-\u001f\u007f]/.test(value);

const validateBucket = (bucket) => {
  if (
    !isSafeValue(bucket)
    || bucket.length < 3
    || bucket.length > 63
    || !/^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(bucket)
    || bucket.includes("..")
    || bucket.includes(".-")
    || bucket.includes("-.")
    || TEST_BUCKET_PATTERN.test(bucket)
  ) {
    throw new Error("invalid-bucket");
  }
  return bucket;
};

const validatePrefix = (prefix) => {
  if (
    !isSafeValue(prefix)
    || !prefix.endsWith("/")
    || prefix.startsWith("/")
    || prefix.includes("\\")
    || prefix.includes("//")
    || /[\u0000-\u001f\u007f]/.test(prefix)
    || prefix.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("invalid-prefix");
  }
  return prefix;
};

const loadProductionBackfillConfig = (env) => {
  const config = Object.fromEntries(
    Object.entries(CONFIG_KEYS).map(([key, envName]) => [key, env[envName]]),
  );
  if (
    Object.values(config).some((value) => !isSafeValue(value))
    || config.stage !== "prd"
    || config.sourceRegion !== "ap-northeast-1"
    || config.destinationRegion !== "ap-southeast-1"
    || (env.DEPLOYMENT_STAGE !== undefined && env.DEPLOYMENT_STAGE !== "prd")
  ) {
    throw new Error("invalid-production-backfill-configuration");
  }

  for (const [name, value] of Object.entries(env)) {
    if (
      (name.startsWith("WASABI_")
        || name.startsWith("THUMBNAIL_TEST_")
        || name.startsWith("THUMBNAIL_PRD_PREFLIGHT_")
        || FORBIDDEN_ENV_NAMES.has(name))
      && value !== undefined
      && value !== ""
    ) {
      throw new Error("forbidden-credential-provider");
    }
  }

  validateBucket(config.sourceBucket);
  validateBucket(config.destinationBucket);
  validatePrefix(config.prefix);
  if (config.sourceBucket === config.destinationBucket) {
    throw new Error("invalid-production-backfill-scope");
  }
  if (!SUPPORTED_WASABI_REGIONS.has(config.sourceRegion)
    || !SUPPORTED_WASABI_REGIONS.has(config.destinationRegion)) {
    throw new Error("invalid-production-backfill-region");
  }
  return config;
};

const validateSourceScope = (options, config) => {
  if (
    options.sourceBucket !== config.sourceBucket
    || options.sourceRegion !== config.sourceRegion
    || options.prefix !== config.prefix
  ) {
    throw new Error("source-scope-mismatch");
  }
};

const parseArguments = (args) => {
  const valueFlags = new Set([
    "--source-bucket",
    "--source-region",
    "--prefix",
    "--max-objects",
    "--page-size",
    "--checkpoint",
    "--audit",
  ]);
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (valueFlags.has(flag)) {
      if (
        values.has(flag)
        || typeof args[index + 1] !== "string"
        || !args[index + 1]
        || args[index + 1].startsWith("--")
      ) {
        throw new Error("invalid-arguments");
      }
      values.set(flag, args[index + 1]);
      index += 1;
    } else if (flag === "--execute" || flag === "--confirm-prd-backfill") {
      if (flags.has(flag)) throw new Error("invalid-arguments");
      flags.add(flag);
    } else {
      throw new Error("invalid-arguments");
    }
  }
  for (const flag of ["--source-bucket", "--source-region", "--prefix", "--max-objects"]) {
    if (!values.has(flag)) throw new Error("invalid-arguments");
  }
  if (flags.has("--execute") !== flags.has("--confirm-prd-backfill")) {
    throw new Error("invalid-arguments");
  }
  return {
    sourceBucket: values.get("--source-bucket"),
    sourceRegion: values.get("--source-region"),
    prefix: values.get("--prefix"),
    maxObjects: values.get("--max-objects"),
    pageSize: values.get("--page-size"),
    checkpoint: values.get("--checkpoint"),
    audit: values.get("--audit"),
    execute: flags.has("--execute"),
  };
};

const parseBoundedInteger = (value, minimum, maximum, code) => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(code);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(code);
  return number;
};

const pathsEqual = (left, right) => process.platform === "win32"
  ? left.replace(/^\\\\\?\\/, "").toLowerCase()
    === right.replace(/^\\\\\?\\/, "").toLowerCase()
  : left === right;

const isOutsideRepository = (target) => {
  const root = process.platform === "win32"
    ? fs.realpathSync(REPO_ROOT).replace(/^\\\\\?\\/, "")
    : fs.realpathSync(REPO_ROOT);
  const canonical = process.platform === "win32"
    ? fs.realpathSync(path.dirname(target)).replace(/^\\\\\?\\/, "")
    : fs.realpathSync(path.dirname(target));
  const fullTarget = path.join(canonical, path.basename(target));
  const relative = path.relative(root, fullTarget);
  return relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
};

const windowsAclCache = new Map();
const assertPrivateWindowsAcl = (targetPath) => {
  const cacheKey = path.resolve(targetPath).toLowerCase();
  if (windowsAclCache.has(cacheKey)) {
    if (!windowsAclCache.get(cacheKey)) throw new Error("non-private-path");
    return;
  }
  try {
    const script = [
      "$target = [Console]::In.ReadToEnd().TrimEnd([char]10, [char]13)",
      "$acl = Get-Acl -LiteralPath $target",
      "$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      "$owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value",
      "$allow = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow } | ForEach-Object { $_.IdentityReference.Value })",
      "[Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{ identity = $identity; owner = $owner; allow = $allow }))",
    ].join("; ");
    const result = JSON.parse(execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", input: targetPath, windowsHide: true },
    ));
    const allowedSids = new Set([
      result.identity,
      "S-1-5-18",
      "S-1-5-32-544",
      "S-1-3-0",
      "S-1-3-4",
    ]);
    const ownerAllowed = [
      result.identity,
      "S-1-5-18",
      "S-1-5-32-544",
    ].includes(result.owner);
    const aclIsPrivate = ownerAllowed
      && [].concat(result.allow ?? []).every((sid) => allowedSids.has(sid));
    windowsAclCache.set(cacheKey, aclIsPrivate);
    if (!aclIsPrivate) throw new Error("non-private-path");
  } catch {
    windowsAclCache.set(cacheKey, false);
    throw new Error("non-private-path");
  }
};

const assertPrivatePath = (targetPath, metadata, expectDirectory = false) => {
  if (expectDirectory ? !metadata.isDirectory() : !metadata.isFile()) {
    throw new Error("invalid-local-state-path");
  }
  if (process.platform === "win32") {
    assertPrivateWindowsAcl(targetPath);
    return;
  }
  if ((metadata.mode & 0o077) !== 0) throw new Error("non-private-path");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("non-private-path");
  }
};

const validateStatePaths = ({ checkpointPath, auditPath, assertPrivatePathImpl = assertPrivatePath }) => {
  const validated = [];
  const existingFiles = [];
  for (const requested of [checkpointPath, auditPath]) {
    if (typeof requested !== "string" || !requested || !path.isAbsolute(requested)) {
      throw new Error("invalid-local-state-path");
    }
    const target = path.resolve(requested);
    const parent = path.dirname(target);
    const realParent = process.platform === "win32"
      ? fs.realpathSync(parent).replace(/^\\\\\?\\/, "")
      : fs.realpathSync(parent);
    if (!pathsEqual(parent, realParent) || !isOutsideRepository(target)) {
      throw new Error("invalid-local-state-path");
    }
    const parentStat = fs.statSync(parent);
    assertPrivatePathImpl(parent, parentStat, true);
    try {
      const targetStat = fs.lstatSync(target);
      if (targetStat.isSymbolicLink()) throw new Error("invalid-local-state-path");
      assertPrivatePathImpl(target, targetStat);
      if (targetStat.nlink !== 1) throw new Error("invalid-local-state-path");
      existingFiles.push(targetStat);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    validated.push(path.join(realParent, path.basename(target)));
  }
  if (pathsEqual(validated[0], validated[1])) throw new Error("invalid-local-state-path");
  if (
    existingFiles.length === 2
    && existingFiles[0].dev === existingFiles[1].dev
    && existingFiles[0].ino === existingFiles[1].ino
  ) {
    throw new Error("invalid-local-state-path");
  }
  return { checkpointPath: validated[0], auditPath: validated[1] };
};

const scopeFingerprint = (scope) =>
  crypto.createHash("sha256").update(JSON.stringify([
    scope.sourceBucket,
    scope.sourceRegion,
    scope.prefix,
    scope.destinationBucket,
    scope.destinationRegion,
  ])).digest("hex");

const buildCheckpoint = (scope, lastCompletedKey) => ({
  version: CHECKPOINT_VERSION,
  scope,
  lastCompletedKey,
});

const readCheckpoint = (checkpointPath, scope, assertPrivatePathImpl = assertPrivatePath) => {
  let parsed;
  let descriptor;
  try {
    descriptor = fs.openSync(
      checkpointPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const opened = fs.fstatSync(descriptor);
    const current = fs.lstatSync(checkpointPath);
    if (
      current.isSymbolicLink()
      || !opened.isFile()
      || opened.dev !== current.dev
      || opened.ino !== current.ino
      || opened.nlink !== 1
    ) {
      throw new Error("invalid-checkpoint");
    }
    assertPrivatePathImpl(checkpointPath, opened);
    parsed = JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } catch {
    throw new Error("invalid-checkpoint");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(",") !== "lastCompletedKey,scope,version"
    || parsed.version !== CHECKPOINT_VERSION
    || (parsed.lastCompletedKey !== null && typeof parsed.lastCompletedKey !== "string")
    || (
      parsed.lastCompletedKey !== null
      && !parsed.lastCompletedKey.startsWith(scope.prefix)
    )
    || !parsed.scope
    || typeof parsed.scope !== "object"
    || Array.isArray(parsed.scope)
    || Object.keys(parsed.scope).sort().join(",")
      !== "destinationBucket,destinationRegion,prefix,sourceBucket,sourceRegion"
    || Object.keys(scope).some((key) => parsed.scope[key] !== scope[key])
  ) {
    throw new Error("checkpoint-scope-mismatch");
  }
  return parsed;
};

const syncDirectory = (directory) => {
  if (process.platform === "win32") throw new Error("directory-sync-unsupported");
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
};

const writeCheckpointAtomically = (
  checkpointPath,
  checkpoint,
  syncDirectoryImpl = syncDirectory,
) => {
  const tempPath = `${checkpointPath}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  let descriptor;
  let renamed = false;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(checkpoint)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, checkpointPath);
    renamed = true;
    syncDirectoryImpl(path.dirname(checkpointPath));
  } catch {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (!renamed) {
      try {
        fs.unlinkSync(tempPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw new Error("checkpoint-cleanup-failed");
      }
    }
    throw new Error(renamed ? "checkpoint-durability-unknown" : "checkpoint-write-failed");
  }
};

const checkpointExists = (checkpointPath, assertPrivatePathImpl = assertPrivatePath) => {
  try {
    const metadata = fs.lstatSync(checkpointPath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
      throw new Error("invalid-checkpoint");
    }
    assertPrivatePathImpl(checkpointPath, metadata);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const acquireWriterLock = ({
  lockPath = LOCK_PATH,
  syncDirectoryImpl = syncDirectory,
  assertPrivatePathImpl = assertPrivatePath,
} = {}) => {
  let descriptor;
  try {
    const lockDirectory = path.dirname(lockPath);
    const directoryStat = fs.statSync(lockDirectory);
    if (process.platform === "win32") {
      assertPrivatePathImpl(lockDirectory, directoryStat, true);
    } else if (
      !directoryStat.isDirectory()
      || (directoryStat.mode & 0o022) !== 0
      || (typeof process.getuid === "function" && directoryStat.uid !== process.getuid())
    ) {
      throw new Error("non-private-lock-directory");
    }
    descriptor = fs.openSync(lockPath, "wx", 0o600);
    const identity = fs.fstatSync(descriptor);
    const token = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(descriptor, token, "utf8");
    fs.fsyncSync(descriptor);
    syncDirectoryImpl(path.dirname(lockPath));
    return { descriptor, dev: identity.dev, ino: identity.ino, token, path: lockPath };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error.code === "EEXIST") throw new Error("lock-already-held");
    throw new Error("lock-acquisition-failed");
  }
};

const releaseWriterLock = (lock) => {
  fs.closeSync(lock.descriptor);
  const lockPath = lock.path ?? LOCK_PATH;
  const metadata = fs.lstatSync(lockPath);
  if (
    metadata.isSymbolicLink()
    || metadata.dev !== lock.dev
    || metadata.ino !== lock.ino
    || fs.readFileSync(lockPath, "utf8") !== lock.token
  ) {
    throw new Error("lock-ownership-lost");
  }
  fs.unlinkSync(lockPath);
};

const AUDIT_VERSION = 2;
const parseAuditRecords = (auditPath, scopeId, assertPrivatePathImpl = assertPrivatePath) => {
  let descriptor;
  let text;
  try {
    descriptor = fs.openSync(
      auditPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const opened = fs.fstatSync(descriptor);
    const current = fs.lstatSync(auditPath);
    if (
      current.isSymbolicLink()
      || !opened.isFile()
      || opened.dev !== current.dev
      || opened.ino !== current.ino
      || opened.nlink !== 1
    ) throw new Error("invalid-audit-file");
    assertPrivatePathImpl(auditPath, opened);
    text = fs.readFileSync(descriptor, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { records: [], intents: new Map() };
    throw new Error("invalid-audit-file");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (text.length === 0) return { records: [], intents: new Map() };
  if (!text.endsWith("\n")) throw new Error("invalid-audit-boundary");

  const records = [];
  const intents = new Map();
  for (const line of text.slice(0, -1).split("\n")) {
    let record;
    try { record = JSON.parse(line); } catch { throw new Error("invalid-audit-record"); }
    if (
      !record
      || typeof record !== "object"
      || Array.isArray(record)
      || record.scopeId !== scopeId
      || typeof record.timestamp !== "string"
      || !Number.isFinite(Date.parse(record.timestamp))
      || new Date(record.timestamp).toISOString() !== record.timestamp
      || !validDerivedKey(record.derivedKey)
    ) throw new Error("invalid-audit-record");
    const pending = [...intents.entries()].find(([, intent]) => intent.outcome === null);
    if (
      [...intents.values()].some((intent) => intent.outcome === "unknown")
      || (pending && (record.type !== "write-outcome" || record.eventId !== pending[0]))
    ) throw new Error("invalid-audit-record");

    const keys = Object.keys(record).sort().join(",");
    if (record.version === CHECKPOINT_VERSION) {
      if (
        keys !== "derivedKey,scopeId,status,timestamp,version"
        || record.status !== "generated"
      ) throw new Error("invalid-audit-record");
    } else if (record.version === AUDIT_VERSION) {
      if (!/^[a-f0-9]{32}$/.test(record.eventId)) throw new Error("invalid-audit-record");
      if (record.type === "write-intent") {
        if (
          keys !== "derivedKey,eventId,scopeId,timestamp,type,version"
          || intents.has(record.eventId)
        ) throw new Error("invalid-audit-record");
        intents.set(record.eventId, { derivedKey: record.derivedKey, outcome: null });
      } else if (record.type === "write-outcome") {
        const previousOutcome = intents.get(record.eventId)?.outcome;
        if (
          keys !== "derivedKey,eventId,outcome,scopeId,timestamp,type,version"
          || !["generated", "not-generated", "unknown"].includes(record.outcome)
          || !intents.has(record.eventId)
          || intents.get(record.eventId).derivedKey !== record.derivedKey
          || (
            previousOutcome !== null
            && !(previousOutcome === "generated" && record.outcome === "unknown")
          )
        ) throw new Error("invalid-audit-record");
        intents.get(record.eventId).outcome = record.outcome;
      } else {
        throw new Error("invalid-audit-record");
      }
    } else {
      throw new Error("invalid-audit-record");
    }
    records.push(record);
  }
  return { records, intents };
};

const appendAuditRecord = (auditPath, record, options = {}) => {
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT
    | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    const current = parseAuditRecords(
      auditPath,
      record.scopeId,
      options.assertPrivatePath ?? assertPrivatePath,
    );
    if (
      record.version !== AUDIT_VERSION
      || !validDerivedKey(record.derivedKey)
      || typeof record.scopeId !== "string"
      || !/^[a-f0-9]{64}$/.test(record.scopeId)
      || typeof record.timestamp !== "string"
      || !Number.isFinite(Date.parse(record.timestamp))
      || new Date(record.timestamp).toISOString() !== record.timestamp
      || [...current.intents.values()].some((intent) => intent.outcome === "unknown")
    ) {
      throw new Error("invalid-audit-record");
    }
    if (record.type === "write-intent") {
      if (
        Object.keys(record).sort().join(",")
          !== "derivedKey,eventId,scopeId,timestamp,type,version"
        || !/^[a-f0-9]{32}$/.test(record.eventId)
        || current.intents.has(record.eventId)
        || [...current.intents.values()].some((intent) => intent.outcome === null)
      ) throw new Error("invalid-audit-record");
    } else if (record.type === "write-outcome") {
      const intent = current.intents.get(record.eventId);
      if (
        Object.keys(record).sort().join(",")
          !== "derivedKey,eventId,outcome,scopeId,timestamp,type,version"
        || !["generated", "not-generated", "unknown"].includes(record.outcome)
        || !intent
        || (
          intent.outcome !== null
          && !(intent.outcome === "generated" && record.outcome === "unknown")
        )
        || intent.derivedKey !== record.derivedKey
      ) throw new Error("invalid-audit-record");
    } else {
      throw new Error("invalid-audit-record");
    }
    let existed = true;
    try {
      fs.lstatSync(auditPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      existed = false;
    }
    descriptor = fs.openSync(auditPath, flags, 0o600);
    const metadata = fs.fstatSync(descriptor);
    if (process.platform !== "win32" || existed) {
      (options.assertPrivatePath ?? assertPrivatePath)(auditPath, metadata);
    } else if (!metadata.isFile()) {
      throw new Error("invalid-audit-file");
    }
    const target = fs.lstatSync(auditPath);
    if (
      target.isSymbolicLink()
      || target.dev !== metadata.dev
      || target.ino !== metadata.ino
      || metadata.nlink !== 1
    ) {
      throw new Error("invalid-audit-file");
    }
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
    let written = 0;
    while (written < bytes.length) {
      const count = (options.writeSync ?? fs.writeSync)(descriptor, bytes, written, bytes.length - written);
      if (!Number.isSafeInteger(count) || count <= 0) throw new Error("audit-write-failed");
      written += count;
    }
    (options.fsyncSync ?? fs.fsyncSync)(descriptor);
    if (!existed) (options.syncDirectory ?? syncDirectory)(path.dirname(auditPath));
  } catch {
    throw new Error("audit-write-failed");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
};

const classifyObject = async ({
  scope,
  object,
  storage,
  dryRun,
  generate = generateThumbnailForObject,
  recordWriteIntent,
  recordWriteOutcome,
}) => {
  const key = object?.Key;
  if (typeof key !== "string" || !key.startsWith(scope.prefix)) {
    return { category: "failed", count: 1 };
  }
  if (key.endsWith("/")) return { category: "unsupported", count: 1 };
  const size = object.Size;
  if (!Number.isSafeInteger(size) || size < 0) return { category: "failed", count: 1 };
  if (size === 0) return { category: "unsupported", count: 1 };
  if (size > MAX_SOURCE_BYTES) return { category: "oversize", count: 1 };
  const eligibility = evaluateThumbnailEligibility({
    size,
    extension: key.slice(key.lastIndexOf("/") + 1).split(".").pop().toLowerCase(),
    sourceKey: key,
    region: scope.sourceRegion,
    bucket: scope.sourceBucket,
    etag: '"valid-etag"',
  });
  if (!eligibility.eligible) return { category: "unsupported", count: 1 };
  if (typeof object.ETag !== "string" || !normalizeEtag(object.ETag)) {
    return { category: "failed", count: 1 };
  }
  return generate({
    sourceBucket: scope.sourceBucket,
    sourceKey: key,
    sourceRegion: scope.sourceRegion,
    destinationBucket: scope.destinationBucket,
    destinationRegion: scope.destinationRegion,
    storage,
    dryRun,
    expectedEtag: object.ETag,
    expectedSize: size,
    recordWriteIntent,
    recordWriteOutcome,
  });
};

const baseSummary = (dryRun) => ({
  category: dryRun ? "dry-run" : "completed",
  examined: 0,
  generated: 0,
  alreadyPresent: 0,
  unsupported: 0,
  oversize: 0,
  failed: 0,
});

const failSummary = (summary) => {
  summary.category = "failed";
  summary.failed += 1;
  return summary;
};

const ensureOrderedProductionPage = ({ page, prefix, startAfter, maxKeys }) => {
  if (
    !page
    || typeof page !== "object"
    || typeof page.IsTruncated !== "boolean"
    || (page.Contents !== undefined && !Array.isArray(page.Contents))
    || page.CommonPrefixes !== undefined
    || (
      page.KeyCount !== undefined
      && (!Number.isSafeInteger(page.KeyCount) || page.KeyCount !== (page.Contents ?? []).length)
    )
  ) {
    throw new Error("invalid-list-page");
  }
  const contents = page.Contents ?? [];
  if (contents.length > maxKeys || (page.IsTruncated && contents.length === 0)) {
    throw new Error("invalid-list-page");
  }
  let previousKey = startAfter;
  for (const object of contents) {
    const key = object?.Key;
    if (typeof key !== "string" || !key || !key.startsWith(prefix)) {
      throw new Error("invalid-page-key");
    }
    if (
      previousKey !== undefined
      && Buffer.compare(Buffer.from(key, "utf8"), Buffer.from(previousKey, "utf8")) <= 0
    ) {
      throw new Error("page-order-mismatch");
    }
    previousKey = key;
  }
  return contents;
};

const runProductionBackfill = async ({
  scope,
  storage,
  maxObjects,
  pageSize = DEFAULT_PAGE_SIZE,
  dryRun = true,
  checkpointPath,
  auditPath,
  generate = generateThumbnailForObject,
  saveCheckpoint = writeCheckpointAtomically,
  appendAudit = appendAuditRecord,
  acquireLock = acquireWriterLock,
  releaseLock = releaseWriterLock,
  platform = process.platform,
  assertPrivatePathImpl = assertPrivatePath,
}) => {
  if (
    !scope
    || !SUPPORTED_WASABI_REGIONS.has(scope.sourceRegion)
    || scope.sourceRegion !== "ap-northeast-1"
    || scope.destinationRegion !== "ap-southeast-1"
    || validateBucket(scope.sourceBucket) !== scope.sourceBucket
    || validateBucket(scope.destinationBucket) !== scope.destinationBucket
    || validatePrefix(scope.prefix) !== scope.prefix
    || scope.sourceBucket === scope.destinationBucket
    || !Number.isSafeInteger(maxObjects)
    || maxObjects < 1
    || maxObjects > MAX_OBJECTS
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > 10
    || typeof storage?.listSourcePage !== "function"
  ) {
    throw new Error("invalid-production-backfill-options");
  }

  let localPaths;
  if (dryRun) {
    if (checkpointPath !== undefined || auditPath !== undefined) {
      throw new Error("dry-run-local-state-not-allowed");
    }
  } else {
    if (platform === "win32") throw new Error("directory-sync-unsupported");
    localPaths = validateStatePaths({ checkpointPath, auditPath, assertPrivatePathImpl });
  }

  const summary = baseSummary(dryRun);
  let lock;
  let lastCompletedKey = null;
  let completed = false;
  try {
    if (!dryRun) {
      lock = acquireLock();
      const auditState = parseAuditRecords(
        localPaths.auditPath,
        scopeFingerprint(scope),
        assertPrivatePathImpl,
      );
      const unresolved = [...auditState.intents.entries()].find(([, intent]) => intent.outcome === null);
      if (unresolved) {
        const [eventId, intent] = unresolved;
        appendAudit(localPaths.auditPath, {
          version: AUDIT_VERSION,
          scopeId: scopeFingerprint(scope),
          timestamp: new Date().toISOString(),
          type: "write-outcome",
          eventId,
          derivedKey: intent.derivedKey,
          outcome: "unknown",
        });
        throw new Error("unresolved-write-intent");
      }
      if ([...auditState.intents.values()].some((intent) => intent.outcome === "unknown")) {
        throw new Error("unknown-write-outcome");
      }
      if (checkpointExists(localPaths.checkpointPath, assertPrivatePathImpl)) {
        lastCompletedKey = readCheckpoint(
          localPaths.checkpointPath,
          scope,
          assertPrivatePathImpl,
        ).lastCompletedKey;
      } else {
        saveCheckpoint(
          localPaths.checkpointPath,
          buildCheckpoint(scope, null),
        );
      }
    }

    let startAfter = lastCompletedKey ?? undefined;
    while (summary.examined < maxObjects) {
      const requestSize = Math.min(pageSize, maxObjects - summary.examined);
      const page = await storage.listSourcePage({
        bucket: scope.sourceBucket,
        region: scope.sourceRegion,
        prefix: scope.prefix,
        maxKeys: requestSize,
        startAfter,
      });
      const objects = ensureOrderedProductionPage({
        page,
        prefix: scope.prefix,
        startAfter,
        maxKeys: requestSize,
      });
      if (objects.length === 0) {
        completed = true;
        break;
      }

      for (const object of objects) {
        if (summary.examined >= maxObjects) break;
        summary.examined += 1;
        let writeIntentId;
        let writeOutcome;
        const recordWriteIntent = (derivedKey) => {
          writeIntentId = crypto.randomUUID().replaceAll("-", "");
          appendAudit(localPaths.auditPath, {
            version: AUDIT_VERSION,
            scopeId: scopeFingerprint(scope),
            timestamp: new Date().toISOString(),
            type: "write-intent",
            eventId: writeIntentId,
            derivedKey,
          });
          return writeIntentId;
        };
        const recordWriteOutcome = (eventId, derivedKey, outcome) => {
          if (!eventId || eventId !== writeIntentId) throw new Error("invalid-write-outcome");
          appendAudit(localPaths.auditPath, {
            version: AUDIT_VERSION,
            scopeId: scopeFingerprint(scope),
            timestamp: new Date().toISOString(),
            type: "write-outcome",
            eventId,
            derivedKey,
            outcome,
          });
          writeOutcome = outcome;
        };
        const result = await classifyObject({
          scope,
          object,
          storage,
          dryRun,
          generate,
          recordWriteIntent: dryRun ? undefined : recordWriteIntent,
          recordWriteOutcome: dryRun ? undefined : recordWriteOutcome,
        });
        const category = result?.category;
        const accepted = result
          && typeof result === "object"
          && !Array.isArray(result)
          && result.count === 1
          && (TERMINAL_CATEGORIES.has(category) || (dryRun && category === "dry-run"));
        if (!accepted || (dryRun && category === "generated")) {
          throw new Error("invalid-object-result");
        }
        if (!dryRun && category === "generated") {
          if (!validDerivedKey(result.derivedKey)) throw new Error("invalid-derived-key");
          if (!writeIntentId || writeOutcome !== "generated") {
            throw new Error("generated-without-audit-outcome");
          }
        }
        if (category === "generated") summary.generated += 1;
        else if (category === "already-present") summary.alreadyPresent += 1;
        else if (category === "unsupported") summary.unsupported += 1;
        else if (category === "oversize") summary.oversize += 1;

        if (!dryRun) {
          saveCheckpoint(
            localPaths.checkpointPath,
            buildCheckpoint(scope, object.Key),
          );
          lastCompletedKey = object.Key;
        }
        startAfter = object.Key;
      }

      if (summary.examined >= maxObjects) {
        if (page.IsTruncated) summary.category = "paused-cap";
        else completed = true;
        break;
      }
      if (!page.IsTruncated) {
        completed = true;
        break;
      }
      startAfter = lastCompletedKey ?? startAfter;
    }
    if (summary.examined >= maxObjects && !completed && summary.category !== "paused-cap") {
      summary.category = "paused-cap";
    }
  } catch {
    failSummary(summary);
  } finally {
    if (lock) {
      try {
        releaseLock(lock);
      } catch {
        failSummary(summary);
      }
    }
  }
  return summary;
};

module.exports = {
  AUDIT_VERSION,
  CHECKPOINT_VERSION,
  DEFAULT_PAGE_SIZE,
  LOCK_PATH,
  MAX_OBJECTS,
  acquireWriterLock,
  appendAuditRecord,
  buildCheckpoint,
  classifyObject,
  ensureOrderedProductionPage,
  loadProductionBackfillConfig,
  parseArguments,
  parseAuditRecords,
  parseBoundedInteger,
  readCheckpoint,
  runProductionBackfill,
  validateBucket,
  validatePrefix,
  validateSourceScope,
  validateStatePaths,
  syncDirectory,
  writeCheckpointAtomically,
};

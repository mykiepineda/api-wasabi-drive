#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  appendAuditRecord,
  parseAuditRecords,
} = require("../src/thumbnail/production-backfill");

const HISTORY_RECORD_COUNTS = [0, 100, 250, 1000];
const BATCH_OBJECTS = 250;
const SCOPE_ID = crypto.createHash("sha256").update("synthetic-v2-audit-benchmark").digest("hex");
const TIMESTAMP = "2026-01-01T00:00:00.000Z";
const noop = () => {};

const syntheticEventId = (label) =>
  crypto.createHash("md5").update(label).digest("hex");

const syntheticDerivedKey = (label) => {
  const hash = crypto.createHash("sha256").update(label).digest("hex");
  return `v2/${hash.slice(0, 2)}/${hash}.webp`;
};

const makePair = (label) => {
  const eventId = syntheticEventId(label);
  const derivedKey = syntheticDerivedKey(label);
  const common = {
    version: 3,
    recipeId: "v2",
    scopeId: SCOPE_ID,
    timestamp: TIMESTAMP,
    eventId,
    derivedKey,
  };
  return [
    { ...common, type: "write-intent" },
    { ...common, type: "write-outcome", outcome: "generated" },
  ];
};

const createSyntheticHistory = (auditPath, recordCount) => {
  const records = [];
  for (let index = 0; index < recordCount / 2; index += 1) {
    records.push(...makePair(`history-${index}`));
  }
  fs.writeFileSync(
    auditPath,
    records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "",
    { mode: 0o600 },
  );
};

const benchmarkCase = (historyRecordCount) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wasabi-audit-benchmark-"));
  const auditPath = path.join(directory, "synthetic-audit.jsonl");
  try {
    createSyntheticHistory(auditPath, historyRecordCount);
    const parseStarted = process.hrtime.bigint();
    const parsed = parseAuditRecords(auditPath, SCOPE_ID, noop, "v2");
    const parseMs = Number(process.hrtime.bigint() - parseStarted) / 1e6;
    if (parsed.records.length !== historyRecordCount) {
      throw new Error("synthetic-audit-history-count-mismatch");
    }

    if (typeof global.gc === "function") global.gc();
    const before = process.memoryUsage();
    let peakHeapUsed = before.heapUsed;
    const appendStarted = process.hrtime.bigint();
    for (let index = 0; index < BATCH_OBJECTS; index += 1) {
      const [intent, outcome] = makePair(`batch-${historyRecordCount}-${index}`);
      appendAuditRecord(auditPath, intent, {
        assertPrivatePath: noop,
        syncDirectory: noop,
      });
      appendAuditRecord(auditPath, outcome, {
        assertPrivatePath: noop,
        syncDirectory: noop,
      });
      peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed);
    }
    const appendBatchMs = Number(process.hrtime.bigint() - appendStarted) / 1e6;
    const after = process.memoryUsage();
    const final = parseAuditRecords(auditPath, SCOPE_ID, noop, "v2");
    if (final.records.length !== historyRecordCount + BATCH_OBJECTS * 2) {
      throw new Error("synthetic-audit-final-count-mismatch");
    }
    return {
      existingRecords: historyRecordCount,
      appendedObjects: BATCH_OBJECTS,
      appendedRecords: BATCH_OBJECTS * 2,
      validatedExistingJournalMs: Number(parseMs.toFixed(2)),
      appendBatchMs: Number(appendBatchMs.toFixed(2)),
      appendMsPerObject: Number((appendBatchMs / BATCH_OBJECTS).toFixed(3)),
      peakHeapIncreaseBytes: Math.max(0, peakHeapUsed - before.heapUsed),
      heapDeltaBytes: after.heapUsed - before.heapUsed,
      rssDeltaBytes: after.rss - before.rss,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const main = () => {
  const results = HISTORY_RECORD_COUNTS.map(benchmarkCase);
  console.log(JSON.stringify({
    benchmark: "synthetic-v2-audit-append-validation",
    environment: process.version,
    existingRecords: HISTORY_RECORD_COUNTS,
    objectsPerCase: BATCH_OBJECTS,
    notes: [
      "No credentials or storage SDK calls are used.",
      "Each object appends a validated intent/outcome pair; file fsync remains enabled.",
      "Private-path assertions and the one-time directory sync are injected no-ops for synthetic temporary files.",
      "Memory values are process-level observations, not isolated allocation profiles.",
    ],
    results,
  }, null, 2));
};

main();

# Wasabi Drive backend — GitHub Copilot instructions (Phase 8D-C2)

**Current task:** Locally implement recipe-aware, resumable C1/`v2` thumbnail backfill using the existing protected production backfill framework. This instruction file is task-specific: it does not authorize live storage reads/writes, AWS/Wasabi access, credential changes, commits, merges, or deployments.

## Project ownership and current decisions

- The owner is the technical decision-maker. GitHub Copilot implements focused tasks; ChatGPT independently reviews branch source and tests. Do not broaden the task without approval.
- Phase 8C is complete and the original 13 `v1` derivatives are production-validated. Their objects, private state volume, checkpoint, audit journal, and backups are historical evidence to preserve.
- Phase 8D-A selected the C1 recipe: **immutable `v2`, centre crop to exactly 200 x 190 pixels, WebP quality 80**, with original- and CR2-preview orientation handling. The user visually approved C1 after a local sample comparison; measured saving was 67.9% in aggregate thumbnail bytes against 512/80 for that sample, not proof of equivalent page-speed improvement.
- Phase 8D-C1 (immutable v2 recipe and CR2-probe compatibility) was merged into `master` on owner report. Verify that current checkout contains the merged implementation; the last supplied reviewed archive was commit `b6a3aa8d60a43ebdf1cbac607f034bc0f8d57e63`, not proof of the live `master` HEAD.
- Long-term delivery decision: deterministic, backend-derived `v2` thumbnail URLs **without a per-file allowlist or coverage manifest**; React already attempts the original once when a thumbnail fails. **Do not implement URL signing or change frontend during C2.** Enable serving only for explicitly approved source scopes after generation and verification.
- Future automated thumbnails for new externally uploaded Wasabi objects are a separate phase. Do not introduce SNS, SQS, Lambda thumbnail workers, queues, databases, or other services now.

## Mandatory working-tree and access controls

- Before any edit, inspect `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, `AGENTS.md`, current instructions, and relevant code/tests. Expect a user-created branch from latest `master` named `feature/thumbnail-backfill-v2` (or an explicitly approved equivalent). If on `master` or a different feature branch, stop and report; do not silently switch branches.
- Never read, stage, print or change `.env`, `.env.local`, credentials, real bucket/key lists, checkpoints, audits, private Docker volumes or originals. Never use live cloud resources for tests. Do not reset/stash/discard unrelated user work.
- No commits, pushes, PRs, merges, deployments, `serverless deploy`/`package`, production Docker runs, or cloud/Bruno integration tests. Local Node.js 24 synthetic unit tests are permitted. `npm ci` only if necessary; do not mutate the lockfile or run forced audit fixes.
- When finished, report exact files changed, commands and tests run, limitations, and the remaining operational approval gates. Leave changes uncommitted for review.

## Architecture invariants

- Keep Node.js 24, CommonJS, Express 4, API Gateway REST API, AWS Lambda, Serverless v4, CloudFormation, Firebase-hosted React SPA, private Wasabi storage and backend Entra authentication/authorization intact.
- Preserve route -> application/service -> storage adapter -> Wasabi SDK separation; keep Sharp, CR2 preview extraction, write-capable backfill and credentials out of Express imports.
- Preserve original `AccessUrl`, optional `ThumbnailAccessUrl` contract, pagination, internal-bucket hiding, dedicated read-only API signing identity, and existing frontend fallback.
- Preserve `createThumbnailKey()` identity: `[formatVersion, sourceRegion, sourceBucket, completeSourceKey, normalizedETag]`; no source-key trimming, no content checksumming assumptions, and no changes to the meaning of `v1`.
- Use approved fixed recipe IDs only (`v1` and `v2`), not arbitrary user-supplied sizes/quality. `v1` must remain default for legacy production command invocations and retain their existing checkpoint and audit wire format, key validation, and behavior.
- C1 generation must require exactly 200 x 190 output with orientation preserved and no enlargement. If an original or embedded preview is too small, return the existing explicit unsupported/skip outcome; do not produce malformed `v2` or silently upscale. Preserve source caps and existing supported-format policy.
- Keep default dry-run, required explicit production confirmations for execution, a maximum **10 examined source objects per invocation**, bounded listing pages, explicit permitted prefix, fail-closed credential and stage validation, private external state files, conservative unknown-write handling, and Linux/POSIX durability constraints. Do not weaken these gates.
- Maintain `IfMatch` for source `GetObject`, `IfNoneMatch: "*"` for derived `PutObject`, and fail closed if provider preconditions are unsupported. Never overwrite originals or prior `v1` derivatives.
- **One effective writer lock** for both recipe versions whenever they share the production derived destination. The Docker image already uses `HOME=/state`; do not introduce separate locks through different containers/volumes.
- Newly introduced `v2` checkpoint/audit scope identity must be recipe-bound. It may use a new validated format for `v2`, but legacy `v1` checkpoint/audit structures and fingerprints must remain compatible. `v1` state must not be accepted as `v2`, and vice versa. Never migrate, repair, truncate, delete, or open historical production state during implementation.
- Production command state paths for `v2` append `.v2` before the file extension; omitted/explicit `v1` continue to use the exact legacy paths. Both recipes must retain the same lock under the shared `HOME=/state`.
- Keep the current approved production source-region boundary (Tokyo `ap-northeast-1`) and private derived destination (Singapore `ap-southeast-1`) during **this task**. Do not generally widen to other regions/root scans without the owner's exact bucket/region/scope decision and separate testing. This limitation must be reported clearly; it may prevent executing on the new 100-photo collection until approved scope support is added.

## Scope of 8D-C2 implementation

- Inspect `src/thumbnail/production-backfill.js`, `src/storage/thumbnail-prd-backfill-wasabi.js`, `scripts/thumbnail-backfill-prd.js`, `src/thumbnail/generate.js`, `src/thumbnail/service.js`, `src/thumbnail/key.js`, Dockerfile, and existing production-backfill tests before planning edits.
- Add **explicit, validated recipe selection** for the production backfill; omitted recipe must preserve `v1` behavior exactly. Pass `recipeId` consistently into `generateThumbnailForObject()`, key derivation/approval, destination-key validation, checkpoint scope, and audit identity.
- The storage adapter must validate and permit only the currently selected recipe's expected deterministic derived key after checking source identity; do **not** relax to arbitrary `v2` paths. Reuse existing production write safeguards.
- Ensure `v2` resumes with its **own new scope-specific checkpoint and audit** and cannot silently skip work completed by `v1`. Preserve old v1 behavior/data formats for an authorized rollback.
- If a design choice cannot preserve v1 compatibility or safety, stop and report options rather than improvising a migration.
- Use synthetically generated object metadata and injected mocks for all tests. Do not fabricate production verification evidence.
- Do not add API signing, frontend changes, deployment workflow changes, extra AWS resources, dependency upgrades, general-purpose multi-region support or automatic generation.

## Validation and handoff

- Run `node --version`, `npm test`, and `git diff --check` under Node.js 24. State actual totals, failures, skips; do not weaken tests.
- Required boundary tests include: legacy v1 command/default/stored-state compatibility; fixed v2 key and transform selection; reject wrong-version derived keys; reject stale and mismatched ETags; version-specific resumptions/checkpoint/audit identity; attempts to reuse v1 state as v2 (and vice versa) fail closed; one lock across recipe-specific state files; duplicate/ambiguous writes preserve write intent and `unknown` handling; source read/write preconditions unchanged; still at most 10 examined objects and bounded listings; insufficient-size samples skipped; production region/prefix/stage guards unchanged; no production SDK calls in tests.
- Update README only for syntax/contract changes, clearly distinguishing local usage examples from **not-yet-approved live commands**. Do not include real paths, scopes, buckets or secrets.
- Stop at code-review gate. No TEST or PRD cloud read/write has been authorized. The next steps after review are separately approved TEST-stage rehearsal and any region/prefix support actually needed for the first new collection.

# Wasabi Drive Backend — GitHub Copilot Instructions

## Engineering ownership and delivery

The human user is the technical owner and approves architecture, production access, rollout and deployment. Work on a focused task branch from protected `master`; do not commit, push, create a PR, provision resources, request live Wasabi data, or deploy unless the owner explicitly asks. Preserve the production-deployable backend and existing tests. Do not broaden task scope for stylistic cleanup.

## Current architecture (keep unchanged)

- Node.js 24, Express 4, CommonJS, API Gateway REST API, AWS Lambda, Serverless Framework v4/CloudFormation, AWS SDK for JavaScript v3, private S3-compatible Wasabi storage.
- Routes -> application/service -> storage adapters -> Wasabi SDK. `src/app.js` and `src/server.js` are deliberately separated. Config is centralized for the deployed API.
- React/Firebase uses Microsoft MSAL/Entra access tokens; Express authenticates tokens and authorizes trusted users. The backend is the security authority. API keys are not user authentication, and CORS is not authorization.
- Preserve `src/api/*`, `src/service/buckets.js`, `src/storage/wasabi.js`, original `AccessUrl` semantics, the `test`/`prd` deployments and GitHub Actions.
- The light `src/thumbnail/index.js` and Express imports must not eagerly import Sharp, the CR2 extractor, local CLI tools, or storage-write/backfill modules.
- `src/thumbnail/key.js` defines deterministic v1 identity from original source region, bucket, full key and normalized ETag. Do not change the key version/recipe.
- `src/thumbnail/service.js` + `cr2.js` + `transform.js` perform approved 512px maximum edge, WebP quality 80, embedded CR2 preview extraction with orientation. Standard JPG/JPEG/JFIF/PNG/WebP and CR2 are supported; NEF, HEIC/HEIF and other variants remain deferred.

## Completed work and provider findings

- Phases 8C-A1, A2, A3, B1, B2-A and B2-B1 have been merged and deployed. B1 produced private Wasabi TEST thumbnails. B2-A live TEST validation succeeded using Sydney (`ap-southeast-2`) SOURCE and Singapore (`ap-southeast-1`) DERIVED: Wasabi `ListObjectsV2 StartAfter`, strict listing order, dry-run, checkpoint creation, a resumed two-object batch with `generated: 2`, `failed: 0`, and cursor advancement were verified by the owner.
- The TEST tool is deliberately limited to configured TEST-named buckets, the `pilot/` prefix, 10 inspected objects, one local writer, explicit checkpoint and confirmation flags. Preserve all its guards. Its tests, CLI and checkpoints must not become production-capable by deleting or relaxing TEST restrictions.
- Wasabi Support Case 00307622: Sydney's `PutObject IfNoneMatch: "*"` validation fix was still only partly deployed at last confirmation; owner independently reproduced a sequential overwrite in Sydney. Singapore's conditional PUT was verified working and the original bytes remained intact. Do not use Sydney for derived conditional writes until a new owner-controlled retest succeeds. Do not add the cancelled B1-R non-atomic workaround.
- `GetObject IfMatch` was validated for a controlled Sydney source. `PutObject IfNoneMatch: "*"` must remain mandatory for future derived writes. These regional TEST observations are not blanket approvals for production.
- Defer the B1 intermittently missing final JSON investigation until a real first-write reproduction provides evidence. Do not add speculative timeouts or retries.
- The A1 inventory's 54,791 browser-image candidates are not the actual processing allowlist and do not account for B1's 25 MiB limit or CR2 preview policy. A1 totals are historical planning data, not a production authorization.

## Completed Phase 8C-B2-B1 - production READ-ONLY preflight

- `scripts/thumbnail-production-preflight.js`, `src/thumbnail/production-preflight.js`, `src/thumbnail/preflight-scope.js` and `src/storage/thumbnail-preflight-wasabi.js` are strictly metadata-only. The owner validated a complete source listing of an approved 13-object prefix in Tokyo (`ap-northeast-1`) using dedicated audit credentials: 13 eligible standard objects, no errors, `complete: true`, exit code 0. The actual bucket name, folder names and credentials are private. The completed scan is NOT authorization for GETs or writes.
- Preserve exact production preflight scoping, aggregate-only sanitized reporting, the 1000-object cap and SDK operation restriction to `ListObjectsV2`. Do not repurpose its audit credentials for backfill.
- The owner has provisioned a separate private production derived bucket in Singapore and a separate Wasabi backfill sub-user named `wasabi-drive-thumbnail-prd-backfill`. The agreed destination name is `wasabi-drive-prd-derived`; actual deployed bucket name must be confirmed by the owner before any live use. These facts do not authorize writes.

## Active task: Phase 8C-B2-B2 - guarded production backfill implementation (mocked only)

Build a separate locally invoked production CLI, using the existing thumbnail recipe and proven B2-A approach, to support default dry-run and explicitly confirmed writes. Do **not** run the tool against Wasabi. Implementation and mocked tests only; separate B2-B3 will handle operational verification.

**Production safety contract:**

1. Separate production entrypoint; never relax TEST-only `pilot/`, TEST naming/stage, TEST credential and lock safeguards. Preserve B2-B1's metadata-only preflight and original API/Serverless/frontend surfaces. Reuse or carefully extract pure processing helpers, without a broad rewrite.
2. Use separate `THUMBNAIL_PRD_BACKFILL_*` configuration with `STAGE=prd`; fail closed on missing configuration, wrong stage, exact bucket/region/prefix mismatch, unsupported region, broad/empty prefix, destination mismatch or reused `WASABI_*`, TEST, audit or AWS environment credentials. No SDK default credentials or `aws login` fallback. Never infer production access from the bucket name.
3. Constrain source requests to the single owner-approved Tokyo source bucket, region and nonempty prefix, and derived requests to the configured private Singapore bucket (`ap-southeast-1`) and v1 deterministic key pattern. Dedicated sub-user only. Only source `ListObjectsV2`/`HeadObject`/`GetObject` and destination `HeadObject`/`PutObject` are allowed. Preserve source `GetObject IfMatch`, capped source bytes, derived `PutObject IfNoneMatch: '*'` and checked HEAD-before-write behavior. No unconditional retries or non-atomic workaround; no deletions.
4. Default dry-run may only list/head metadata, not download bodies, transform images, PUT objects or write local checkpoint/audit/lock. Live mode requires explicit `--execute` and separate `--confirm-prd-backfill`, a private absolute external checkpoint, and a private absolute external append-only audit path; reject unknown/duplicate/incomplete options. Hard limit <=10 inspected objects per run; begin eventual owner rollout at 1-2, not automatically.
5. Preserve validated lexical `StartAfter` pagination, strict page ordering and sequential awaited result handling. Checkpoint only after confirmed terminal result and durable audit record for every newly generated derived object; never advance on permission, ETag, provider, transformation, audit, checkpoint or ambiguous outcome. Stable single-writer *production* local lock independent of checkpoint filename and separate from TEST lock; no stale lock auto-takeover; document no cross-machine guarantee.
6. Audit newly generated derived keys durably for later manual reconciliation/rollback, not source originals; keep checkpoint/audit outside git and sanitized console output (no keys, paths, ETags, provider errors or credentials). Document crash-after-PUT-before-audit ambiguity: already-present on retry is not proof the resumed process generated it. No automated rollback/deletion.
7. Existing A1/v1/CR2 policy is unchanged: 25 MiB source limit, 512px maximum edge, WebP quality 80, standard JPEG/PNG/WebP plus embedded CR2 previews; NEF and HEIC/HEIF deferred. Production storage remains private. Never change the v1 key recipe or include Sharp/RAW modules in the Express import graph.
8. Mock all tests. Cover exact scope and creds, command selection, condition headers, dry-run no writes, cursor and checkpoint safety, contention/lock failure, audit ordering, malformed listings, provider failures, ambiguous conditional results, sanitized summaries, and unmodified TEST/preflight/API imports. No real Wasabi requests by the coding agent, even read-only.
9. Do not introduce databases, queues, Lambdas, new frameworks, dependencies, IAM policy changes, AWS/S3 provisioning or frontend work. No commits, push, PR, credentials, live calls or deployment without explicit owner approval.

## Validation and handoff

Use Node.js 24. Run focused mocked tests, `npm test`, `git diff --check`, `git status --short`, `git diff --stat`, and examine all untracked files. Do not weaken tests. Leave changes uncommitted for the owner's independent review. The owner will decide when B2-B3 is approved, including new Singapore-bucket conditional-write testing, production dry-run, and first 1-2 source photographs. Deferred B1 missing-final-JSON investigation remains deferred pending evidence.

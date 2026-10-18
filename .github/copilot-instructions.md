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

- Phases 8C-A1, A2, A3, B1 and B2-A have been merged and deployed. B1 produced private Wasabi TEST thumbnails. B2-A live TEST validation succeeded using Sydney (`ap-southeast-2`) SOURCE and Singapore (`ap-southeast-1`) DERIVED: Wasabi `ListObjectsV2 StartAfter`, strict listing order, dry-run, checkpoint creation, a resumed two-object batch with `generated: 2`, `failed: 0`, and cursor advancement were verified by the owner.
- The TEST tool is deliberately limited to configured TEST-named buckets, the `pilot/` prefix, 10 inspected objects, one local writer, explicit checkpoint and confirmation flags. Preserve all its guards. Its tests, CLI and checkpoints must not become production-capable by deleting or relaxing TEST restrictions.
- Wasabi Support Case 00307622: Sydney's `PutObject IfNoneMatch: "*"` validation fix was still only partly deployed at last confirmation; owner independently reproduced a sequential overwrite in Sydney. Singapore's conditional PUT was verified working and the original bytes remained intact. Do not use Sydney for derived conditional writes until a new owner-controlled retest succeeds. Do not add the cancelled B1-R non-atomic workaround.
- `GetObject IfMatch` was validated for a controlled Sydney source. `PutObject IfNoneMatch: "*"` must remain mandatory for future derived writes. These regional TEST observations are not blanket approvals for production.
- Defer the B1 intermittently missing final JSON investigation until a real first-write reproduction provides evidence. Do not add speculative timeouts or retries.
- The A1 inventory's 54,791 browser-image candidates are not the actual processing allowlist and do not account for B1's 25 MiB limit or CR2 preview policy. A1 totals are historical planning data, not a production authorization.

## Active task: Phase 8C-B2-B1 — production READ-ONLY preflight

Build a small, explicitly scoped, locally run production metadata preflight. It must make **only source `ListObjectsV2` requests** and print aggregate, sanitized eligibility/size counts for one operator-approved source bucket and prefix. It must NOT generate thumbnails, download object bodies, contact a derived bucket, write checkpoints, issue PUT/COPY/DELETE, modify IAM, or provision any cloud resources. Production write-capable backfill is a later, separately approved task.

Safeguards:

1. New, independent production-preflight entrypoint. Do not modify or repurpose `scripts/thumbnail-backfill-test.js` or its TEST restrictions. Reuse small, pure classification helpers where possible; avoid duplicating the thumbnail policy.
2. Use dedicated local **read-only production audit credentials**, independently and explicitly configured (e.g., `THUMBNAIL_PRD_PREFLIGHT_*`). Do not reuse `WASABI_*` API credentials, TEST credentials, AWS deployment/root credentials, or implicit SDK credential fallbacks.
3. Require an exact owner-approved source bucket, region and nonempty prefix matched against local config; no implicit account-wide or all-nine-bucket discovery. Never infer a production scope from a substring such as `prd` in the bucket name.
4. Use bounded `ListObjectsV2` page sizes and an explicit per-run inspected-object cap. If a cap is reached, report `complete: false` or equivalent; do not report partial results as inventory totals. No source-body GETs, derived HEADs or writes in any mode.
5. Report aggregate counts and bytes only: current v1 eligibility, CR2, known `>25 MiB` oversize, unsupported, zero-byte, missing/invalid ETag, scan cap/completeness. No bucket names, object keys, filenames, ETags, credentials, paths, access URLs or private metadata in stdout/stderr, fixtures, README or PR description.
6. Use AWS SDK v3 regional S3 clients with explicit Wasabi endpoints and supplied audit-only credentials; reject unsupported regions or unsafe input. Do not widen the hardcoded TEST `pilot/` listing adapter. Treat errors/ambiguous listings as failures, not as completed scans.
7. Reject live execution / mutation flags (`--execute`, `--confirm-*`, `--write`, etc.) as unknown arguments. A production preflight is always read-only and may only enumerate explicitly approved metadata.
8. Avoid frameworks, databases, queues, alternate storage providers, extra Lambdas and dependencies.
9. Add injected/mocked tests for credential separation, exact bucket/prefix/region matching, bounded listing, pagination, safe aggregate-only output, dry/read-only guarantees, malformed/oversize/CR2 classification, failed provider responses and API import isolation.
10. Update README minimally to record actual B2-A live validation (StartAfter and two generated thumbnails), the remaining Sydney defect and the preflight instructions with placeholders. Do not include or print private production scopes or credentials. Update these instructions only in the task branch.

## Validation and handoff

Use Node.js 24. Run focused tests, `npm test`, `git diff --check`, and inspect all changed files. Do not weaken tests, change dependency versions, or touch Serverless, GitHub Actions, existing API routes or frontend. Leave the implementation uncommitted for owner review. No live calls to production buckets, including read-only inventory, unless separately authorized by the owner.

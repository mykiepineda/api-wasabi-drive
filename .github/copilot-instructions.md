# Wasabi Drive Backend - GitHub Copilot Instructions

## Authority and change control

Wasabi Drive is a deployed personal application and a cloud-architecture learning project. The owner makes architectural decisions. Inspect current source and the active task prompt before changing code. Never silently broaden scope. Protected `master` is the integration/release branch: implementation belongs on a focused task branch and PR. Do not commit, push, create a PR, modify cloud resources, or deploy unless explicitly instructed by the owner.

The current verified source baseline is backend `master` after Phase 8C-B1 was merged, deployed to `test` and `prd`, and owner-validated (October 2026). A1 inventoried nine source buckets and validated local Sharp prototypes. A2 established deterministic v1 identities and an in-memory thumbnail policy/service. A3 integrated CR2 high-quality embedded JPEG extraction and original-orientation handling into the service; a real sample successfully produced upright 341x512 WebP (41,620 bytes). Existing backend API behavior remains unchanged.

**Active task: Phase 8C-B1R - narrow TEST-only compatibility adaptation after the completed B1 implementation.** The owner verified that Wasabi (Sydney) overwrote an existing disposable object even when `PutObject` included a prepared and signed `If-None-Match: *`; equivalent Amazon S3 request was rejected with HTTP 412. Wasabi support investigation remains open. `GetObject IfMatch` was verified to reject mismatched ETags. Implement only explicit acceptance of a non-atomic single-writer TEST pilot, an immediate pre-PUT HEAD recheck, tests and documentation. Neither B1R nor B1 authorizes bulk backfill, concurrency, Lambda workers, API `ThumbnailAccessUrl`, frontend changes, production writes, or new AWS infrastructure.

## Existing architecture to preserve

- Node.js 24, CommonJS, Express 4, AWS Lambda/API Gateway REST API, Serverless Framework v4, AWS SDK for JavaScript v3, private multi-region Wasabi S3-compatible buckets.
- React/Firebase Hosting, Microsoft Entra access-token authentication and backend trusted-user authorization. Frontend state and API keys are not authentication/authorization.
- HTTP/Express route -> application/service -> infrastructure/storage -> AWS SDK -> Wasabi. Keep local HTTP bootstrap separate from Lambda app construction.
- `src/app.js`, `src/api/*`, `src/service/buckets.js`: deployed authenticated API, unchanged for B1. `AccessUrl` always means original object URL.
- `src/storage/wasabi.js`: existing region resolution, provider error mapping, browse listing with `Delimiter: '/'`, recursive metadata listing without delimiter, and original presigning. Do not refactor this production-critical adapter solely for B1.
- `src/thumbnail/key.js`: `v1/<2-hex>/<64-hex>.webp` from SHA-256 of JSON array [formatVersion, sourceRegion, sourceBucket, fullSourceKey, normalizedETag].
- `src/thumbnail/eligibility.js`: supported standard JPG/JPEG/JFIF/PNG/WebP and CR2 embedded-preview policy; NEF deferred; HEIC/HEIF not approved.
- `src/thumbnail/service.js`: `applyThumbnailPolicy` accepts trusted source bytes/metadata, generates WebP and derived key in memory, returns safe nonfatal ineligible outcomes.
- `src/thumbnail/cr2.js`: embedded JPEG preview, EXIF-first / CR2 IFD0 orientation fallback; do not reimplement RAW decoding.
- `src/thumbnail/transform.js`: fixed v1 max edge 512, quality 80, fit inside, without enlargement, metadata-safe transform. Keep recipe unchanged.
- `src/thumbnail/index.js`: lightweight key/policy exports only. Neither the API import graph nor this index may eagerly load Sharp or the CR2 extraction module.
- `serverless.yml` currently deploys ONLY the existing Express Lambda. CI/CD: Node 24 PR checks; merge to protected master deploys `test`; manually promote exact SHA to `prd` through GitHub OIDC.
- `sharp` and `extract-raw-preview` are devDependencies for current utility work, not worker-runtime packaging proof.

## B1 data and security rules

1. Originals are authoritative and immutable: no Put/Copy/Delete/Move/ACL or metadata modification of any source object. Thumbnails reside only in a separate **private** Wasabi derived bucket, not within user source buckets or prefixes.
2. Never assume a stage string is a security boundary. The pilot must use separate TEST-only Wasabi credentials and a narrowly authorized private test thumbnail bucket. Credential permissions are enforced by Wasabi IAM policy. Do not re-use GitHub OIDC deployment credentials or silently broaden the API's existing Wasabi credential scope.
3. Pilot operates against an explicit, owner-controlled **test source bucket and one object**. Real personal/prd buckets are not to be used for pilot writes. No full-account enumeration, production backfill, or automatic processing.
4. Separate stage config for the local pilot from the existing Express/Entra config. Do not require API trusted-user environment variables merely to run isolated thumbnail storage logic, and do not modify fail-closed auth config.
5. Source identity must match read bytes: use conditional GetObject/IfMatch with listing/HEAD ETag, check returned ETag and size where available, and fail safely on mismatch. Confirm actual Wasabi compatibility in a controlled test; AWS S3 compatibility alone is not proof. Never silently degrade to an unconditional read.
6. Avoid duplicate writes: check the deterministic destination key before downloading source bytes AND recheck it immediately before PUT. Treat only recognized destination HTTP 404 as absent, never 403/transport errors. Keep `IfNoneMatch: '*'` on PutObject as a best-effort header, but **never describe it as enforced atomic protection on Wasabi**: the controlled TEST proved otherwise. No unconditional fallback and no parallel writers. The double HEAD reduces but cannot close the race. A repeated pilot should report `already-present`.
7. Before a live write require all three TEST-only CLI flags `--execute --confirm-test-write --accept-non-atomic-put`, and an explicit service-level permission (default denied), after owner code review and approval. Dry-run remains the default with no source-body fetch or writes. One human-operated process only; this is an operational restriction, not distributed locking or a guarantee against a privileged external writer. Preserve the pilot source allowlist and separate credentials.
8. Hard-bound pilot downloads in memory; check source size before GET and enforce a byte cap while consuming the response. A2 service expects a Buffer. Do not claim streaming end-to-end or Lambda resource suitability. The pilot cap is a temporary operational guard, not a permanent format eligibility rule.
9. PutObject uses `ContentType: image/webp` and exact derived key returned by A3. Never persist source bucket/key/ETag in destination object keys or public metadata. Do not log/commit any private paths, bucket names, keys, ETags, presigned URLs, secrets, image bytes, or EXIF. CLI summary output must be sanitized.
10. Errors must be classified safely. An unsupported source or bad thumbnail should not create a derived key in storage. A failed operation must not change any original object. No speculative database, queue, new frameworks, caches or provider abstractions.

## B1 implementation shape (adapt to real source)

- Prefer a thin local CLI -> an application-level one-object orchestration function -> dedicated thumbnail storage operations -> AWS SDK -> Wasabi. Reuse `applyThumbnailPolicy` unchanged where possible.
- Avoid touching existing browse adapter; do not duplicate entire multi-region region-discovery implementation. For the controlled B1 pilot it is acceptable to require explicit validated source and destination Wasabi regions. Document that automatic region discovery across nine buckets is a later backfill/worker requirement.
- Keep local-pilot credentials/config separate and injected into isolated modules. Add only TEST placeholders to `.env.example` if needed; do not add new variables to `serverless.yml` or CI/CD yet.
- Explicit no-network mocked unit tests for region separation, ETag conditional read, skip-if-present, absent vs forbidden, destination write precondition, no source writes, size cap and timeout handling, and error sanitization.
- Manual validation comes **after** owner code review and private test bucket / least-privilege credential preparation. No live upload from tests. Actual Wasabi `IfNoneMatch` was observed NOT to block overwrites; do not rely on it or claim that a successful PUT proved precondition enforcement.

## Validation and delivery

Use Node 24; preserve all existing tests. Run `npm test`, focused unit tests, `git diff --check`, and `git status --short`. Bruno tests are not needed when the API is unchanged. Confirm the Express import graph does not load Sharp or thumbnail-write modules; no changes to `serverless.yml`, `src/app.js`, auth, existing storage browsing, API routes, existing presigned URL behavior, or GitHub Actions.

Report files changed, test results, verified Wasabi `IfMatch` GET and failed atomic `IfNoneMatch` PUT behavior, the deliberate TEST-only non-atomic single-writer tradeoff, and a SAFE sanitized pilot checklist. Do not commit, push, create PR, deploy, create buckets/users/policies, or perform live Wasabi writes unless owner explicitly requests it.

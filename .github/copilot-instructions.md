# Wasabi Drive Backend — GitHub Copilot Instructions

## Owner, source of truth, and change control

Wasabi Drive is a live personal application and an enterprise architecture/cloud-engineering learning project. The developer is the technical owner and architectural decision-maker. ChatGPT provides architecture review and task guidance; Copilot implements only the explicitly approved task.

Inspect the current repository and active task prompt before editing. Treat the latest merged `master` source as the baseline. If a task prompt conflicts with source or these instructions, report the conflict; do not guess or silently broaden scope.

`master` is protected and must remain deployable. Use a focused task branch and reviewable commits. Do not commit, push, open/merge pull requests, or deploy unless the owner explicitly authorizes the action. Avoid unrelated cleanup, unsolicited dependency upgrades, changes to AWS/Wasabi credentials, or changes to infrastructure.

## Current production baseline and active task

Source baseline: backend `master` after Phase 8C-A3 was merged, deployed to `test` and `prd`, and production-validated (October 10, 2026).

Completed:
- 8C-A1: read-only multi-bucket inventory/locator, local Sharp prototype, sanitized format and size evidence.
- 8C-A2: deterministic `v1` SHA-256 thumbnail identity, metadata eligibility, fixed 512px/quality-80 WebP transform, in-memory `ThumbnailService`, portable CR2 preview extraction and local probe.
- 8C-A3: integrated CR2 embedded-preview processing and orientation fallback into the in-memory thumbnail service.
- Representative local CR2 through the main service: upright WebP 341 × 512 / 41,620 bytes; source orientation 8; visual result owner-validated. **This is local sample evidence, not a guarantee for all CR2 files or proof of Linux Lambda packaging.**

**Active task: Phase 8 Task 8C-B1 — isolated private thumbnail storage adapter and guarded one-object TEST pilot.** Suggested branch: `feat/8c-b1-thumbnail-storage-pilot`, based on `master` after A3.

B1 is local-only storage/application/test/documentation work. Do not proceed to bulk backfill, SNS/worker processing, API/frontend integration, or production rollout without separate approval. Do not commit, push, open a PR, provision resources, or deploy without owner authorization.

## Existing architecture to preserve

- Node.js 24, CommonJS, Express 4, AWS Lambda, API Gateway REST API, `serverless-http`.
- AWS SDK for JavaScript v3, multi-region private Wasabi S3-compatible storage.
- Serverless Framework v4, CloudFormation, `test` and `prd` stages.
- GitHub Actions: pull-request tests, automatic `test` deployment on merge to `master`, manual exact-SHA production promotion, GitHub OpenID Connect deployment role.
- React/Firebase frontend, Microsoft Entra OAuth 2.0 API access-token authentication, backend trusted-user authorization.

Dependency direction: `HTTP / Express route -> application/service layer -> storage adapter -> AWS SDK -> Wasabi`.

Current source map (verify before editing):
- `src/app.js`, `src/api/buckets.js`: secured existing Express API.
- `src/service/buckets.js`: existing bucket/file operations and original `AccessUrl` generation.
- `src/storage/wasabi.js`: multi-region client selection, provider errors, listing/presigning. Keep browsing `Delimiter: "/"` unchanged.
- `src/config/index.js`: centralized, fail-closed environment and trusted-user configuration.
- `src/thumbnail/key.js`: versioned deterministic key (`v1/<2 hex>/<64 hex>.webp`).
- `src/thumbnail/eligibility.js`: standard-image policy with approved CR2 embedded-preview category; NEF remains deferred.
- `src/thumbnail/transform.js`: Sharp WebP transform with auto-orientation and optional CR2 fallback orientation.
- `src/thumbnail/cr2.js`: `extractCR2EmbeddedPreview`, TIFF IFD0 orientation parser, preview-first orientation policy and safe extractor failures.
- `src/thumbnail/service.js`: `applyThumbnailPolicy` processes standard formats and approved CR2 previews in memory.
- `src/thumbnail/index.js`: **pure/lightweight key and eligibility exports only**; no Sharp/CR2 processing imports.
- `src/storage/thumbnail-wasabi.js`, `src/thumbnail/generate.js`: B1-only, isolated storage adapter and one-object workflow; neither is wired into the deployed API.
- `scripts/thumbnail-single-pilot.js`: explicit one-object TEST CLI, dry-run by default and requires both `--execute` and `--confirm-test-write` for live operations.
- `scripts/thumbnail-cr2-probe.js`: local experiment; returns sanitized fields and optional exclusive-created output (`wx`).
- `serverless.yml`: **one Express `app` Lambda**, without thumbnail worker.
- `test/`: Node built-in `node:test` and `node:assert/strict`.

## Security/data invariants

- The backend remains the security authority. Preserve Entra authentication, trusted-user authorization and private Wasabi access.
- Original objects are authoritative: never overwrite, delete, rename, move, or modify them for thumbnails.
- Keep generated previews separate from originals in a private derived bucket. B1 does not provision buckets, policies, or credentials.
- `AccessUrl` continues to mean the presigned URL for the **original** file; do not introduce `ThumbnailAccessUrl` yet.
- No frontend storage SDK, public object URLs, browser credentials, or API-key authentication.
- Do not log, commit, or print secrets, personal bucket names/keys, source paths, real ETags, presigned URLs, photo bytes or EXIF metadata. Synthetic test identifiers only. Local output can report fixed safe status/reason, dimensions and byte counts.
- Unsupported/undecodable/malformed sources must yield a nonfatal, privacy-safe failure. Do not modify originals or generate a false derived key.
- Do not add a database, framework, queue, layer, AWS service, IAM permission, deployment configuration, or CI/CD integration for B1. Local pilot environment variables must remain separate from the Express API configuration.

## A3 completed acceptance record

1. Update the centralized `evaluateThumbnailEligibility` policy so **CR2 is an eligible distinct `cr2-preview` category** when required source identity and positive safe-integer object size are valid. NEF remains deferred; HEIC/HEIF, GIF, BMP, CR2 variants without usable embedded preview, other RAW formats and documents/videos remain unsupported or undecodable as applicable. The inventory classifier and frontend image extensions are NOT the production policy.
2. In `applyThumbnailPolicy`, dispatch by the evaluated category. Standard formats must keep the same Sharp path. CR2 must call the **existing** `extractCR2EmbeddedPreview({ input: sourceBytes })`, reject a missing/low-quality/unusable preview safely, then call `transformToWebp` on the extracted JPEG with the helper's `fallbackOrientation`. Never submit original CR2 bytes directly to Sharp.
3. Reuse existing orientation rules: embedded preview EXIF wins; otherwise CR2 IFD0 fallback; supported values 1/3/6/8; mirrored 2/4/5/7 fail closed; do not rotate twice. Preserve fixed WebP recipe: max edge 512, quality 80, fit `inside`, no enlargement, correct EXIF handling, alpha/metadata behavior.
4. Preserve key identity: `SHA-256(JSON.stringify(["v1", sourceRegion, sourceBucket, completeSourceKey, normalizedETag]))`, not an identity based on the extracted JPEG. The same source object/ETag must produce the same derived key regardless of its supported format. Never store private key/bucket information in derived paths.
5. Preserve the service's current **in-memory** input/output contract: source bytes and metadata in, `derivedKey`, WebP buffer, dimensions, `image/webp` and safe status out. Do not add Wasabi reads, writes, HEAD per object, CLI backfill, API fields/routes, or cloud resources.
6. The obsolete `allowCR2Preview`/`allowRawPreview` gate is not security authorization. Avoid maintaining a misleading flag which contradicts the now-approved in-memory CR2 path; remove or simplify it locally only as needed, adjusting A2 tests/docs. The caller is still trusted application code; normal application authorization remains unchanged.
7. Keep API isolation: `src/app.js`, `src/api/*`, `src/service/buckets.js`, `src/storage/wasabi.js` and `src/thumbnail/index.js` must not import `sharp`, `extract-raw-preview`, CR2 processing or the heavy thumbnail service.
8. `sharp` and `extract-raw-preview` remain **development dependencies** for now. They are not automatically ready for Lambda worker packaging. Do not change dependency placement or `serverless.yml`; Linux Lambda deployment verification belongs to the later worker/storage phase.
9. Prefer the smallest direct change to `eligibility.js`, `service.js`, targeted tests and README. Reuse `cr2.js` and `transform.js`; avoid abstractions/registries, broad refactors or silently widening format support.

## A3 correctness and validation gates

Use Node.js 24 and the existing test conventions. Add or adapt focused tests covering:
- CR2 policy category enabled for valid metadata (case-insensitive `.CR2`), invalid size/ETag/folder marker rejected; NEF still deferred.
- The actual `applyThumbnailPolicy -> extractCR2EmbeddedPreview -> transformToWebp` call path (mock helper where useful), not merely the lower-level probe.
- CR2 success returns the standard v1 identity and WebP contract; no source-byte mutation.
- Extractor missing-preview/low-quality/malformed/failure results are nonfatal with null/absent thumbnail output, safe reason and no derived key.
- Orientation fallback 8 produces portrait with correct pixel rotation; preview-owned orientation is applied once; unsupported mirroring safely fails.
- Standard JPG/JPEG/JFIF/PNG/WebP behavior, existing resize settings, transparency and tests remain intact.
- No changes to browsing, `AccessUrl`, authentication, multi-region storage, deployment or API runtime module imports.

Do not commit personal CR2 files or derived previews. Validate at least one **owner-run local real-CR2 sample through the main service**, not only the independent probe, without exposing filenames/paths in output. If a new permanent CLI is unnecessary, provide a safe local-only command that invokes `applyThumbnailPolicy` with synthetic source identity and prints only summary fields. Do not claim Linux Lambda compatibility from Windows success.

The completed A3 validation record:

```text
npm ci --include=dev
npm test
git diff --check
git status --short
```

Use CI's normal Node 24 Linux runner for PR checks once authorized. Bruno API integration tests are not required for in-memory thumbnail-only code. Never weaken regression tests to force a pass. Report precise files changed, tests, real-file service result, outstanding packaging limitations, and stop. No commit/push/PR/deployment unless requested.

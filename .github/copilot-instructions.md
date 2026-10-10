# Wasabi Drive Backend — GitHub Copilot Instructions

## Owner, source of truth, and change control

Wasabi Drive is an operational personal application and an enterprise architecture/cloud engineering learning project. The developer is the technical owner and architectural decision-maker. ChatGPT provides architecture/task guidance and reviews; Copilot implements only the explicitly selected task.

Before editing, inspect current `master` and the active task prompt. The repository's source defines current behavior; the owner's latest approved task prompt defines the requested change. Surface any conflict instead of guessing. Do not autonomously redesign architecture, add cloud resources, alter credentials/permissions, upgrade unrelated dependencies, commit, push, open/merge a pull request, or deploy.

`master` is protected and deployable. Work in a focused task branch and keep changes small and testable. Avoid unrelated cleanup and preserve existing tests.

## Production baseline and active task

The October 2026 `master` snapshot has completed Phase 8 Task 8C-A1, including:

- read-only, explicitly scoped, multi-bucket inventory (`scripts/inventory-images.js`, `src/thumbnail/inventory.js`);
- read-only object locator (`scripts/locate-images.js`, `src/thumbnail/locate.js`);
- local Sharp prototype (`scripts/prototype-thumbnail.js`, `src/thumbnail/prototype.js`);
- corresponding tests and sanitized findings in `README.md`.

A1 was merged, deployed to `test` and `prd`, and production-validated. These utilities are evidence tooling, **not a deployed thumbnail-processing service**.

**Active task:** Phase 8 Task **8C-A2 — Durable Thumbnail Foundation**. Suggested branch: `feat/8c-a2-thumbnail-service`, created from the latest `master`.

A2 is backend-only, with two implementation gates: (1) verify portable CR2 embedded-preview extraction against the known-good local sample; (2) implement/test deterministic v1 identity, production eligibility policy, reusable transform, and a storage-independent thumbnail application service. Do not assume a candidate CR2 dependency is approved until measured evidence supports it. Do not proceed to 8C-B/C/D/E without fresh approval.

## Technology and boundaries to preserve

- Node.js 24, CommonJS, Express 4, `serverless-http`, AWS Lambda, API Gateway REST API.
- AWS SDK for JavaScript v3, S3-compatible private Wasabi storage, multiple Wasabi regions.
- Serverless Framework v4, CloudFormation, separate `test` and `prd` environments.
- GitHub Actions CI/CD: tests for PRs, automatic `test` deployment on merge, manual exact-SHA production promotion, GitHub OpenID Connect deployment credentials.
- Firebase-hosted React frontend (not modified in A2).
- Microsoft Entra access-token authentication and backend trusted-user authorization.

Preserve the existing dependency direction:

`HTTP/Express route -> application/service layer -> storage implementation -> AWS SDK -> Wasabi`.

Existing code map:

- `src/app.js`, `src/api/buckets.js`: Express API, authentication/authorization boundary, error handling.
- `src/service/buckets.js`: browse orchestration and **original** `AccessUrl` generation.
- `src/storage/wasabi.js`: bucket region discovery, per-region S3 clients, `ListObjectsV2`, presigning, provider-error boundary.
- `src/config/index.js`: centralized fail-closed configuration (including strict trusted-user Object ID validation at module load).
- `src/thumbnail/{inventory,locate,prototype}.js`: A1 evidence utilities; inventory/locator format lists are **not** production eligibility policy.
- `serverless.yml`: currently one `app` Lambda, without function-specific packaging.
- `test/`: `node:test`/`node:assert/strict` tests.

Do not collapse HTTP/service/storage layers or refactor security/configuration to simplify thumbnail work. Pure thumbnail key, policy and transformation modules should not need to import application configuration or cloud credentials.

## Non-negotiable security and data invariants

React/MSAL -> Microsoft Entra OAuth 2.0 access token -> API Gateway -> Express authentication -> trusted-user authorization -> private Wasabi objects.

- Originals are authoritative and immutable to the thumbnail pipeline. Never overwrite, delete, rename, move, or modify an original.
- Derived thumbnails will be disposable data stored in a **separate private Wasabi bucket per environment** in later tasks. Do not place them in source buckets.
- Keep credentials server-side and externalized. Never put secrets or raw storage URLs in the frontend.
- Do not log or commit personal filenames, full Wasabi object keys, bucket names from live scans, ETags from private objects, presigned URLs, photo bytes, metadata/EXIF, or credentials. Tests should use synthetic identifiers.
- No MongoDB, new database, queue, new HTTP endpoint, extra Lambda, or IAM change for A2.
- Keep the current API, error responses, health route, request logs, auth middleware, region behavior and existing `AccessUrl` semantics unchanged. `AccessUrl` refers to the original, never the derived preview; **do not add `ThumbnailAccessUrl` in A2**.

## Exact Task 8C-A2 scope

Implement a small, reusable **backend foundation**, not a deployed pipeline:

1. A pure v1 thumbnail-key function.
2. A distinct backend thumbnail eligibility policy using real inventory results.
3. A reusable Sharp-to-WebP transform, based on A1 measurements.
4. A narrow application/service entry point that combines policy, keying, source decoding and transformation without Wasabi network I/O or writes.
5. A gated portable Canon CR2 embedded-JPEG extraction experiment, with integration only if proven compatible and acceptable.
6. Focused unit tests and concise README/design-contract documentation.

Prefer simple functions over framework-like classes, abstractions and plugin registries. It is acceptable for a future backfill or Lambda worker to supply input bytes/stream and receive a derived key, WebP bytes, dimensions and content type (`image/webp`). **Do not build** a production object fetch/upload adapter or invoke Wasabi reads/writes as part of A2.

### v1 thumbnail identity

Start from a versioned, collision-resistant deterministic contract (exact implementation should be documented and tested):

`SHA-256(JSON.stringify(["v1", sourceRegion, sourceBucket, completeSourceKey, normalizedETag]))`.

Then produce a safe derived key such as `v1/<first-two-hash-characters>/<full-hex-hash>.webp`.

- Preserve source region, bucket and full key identity exactly, including nested paths, Unicode and punctuation; do not use a filename, partial prefix or lossy normalization.
- Normalize an ETag only by trimming whitespace and removing one pair of enclosing double quotes if present. Treat ETag as opaque: not necessarily MD5 and not safe to lowercase/reinterpret.
- Require nonblank region, bucket, complete key and ETag; do not generate keys for insufficient metadata.
- A different ETag, source key, bucket, region or format version must produce a different key. Repeating identical input must produce an identical key.
- Do not put source bucket/key/ETag as cleartext into derived thumbnail paths or logs.
- Separate `test` and `prd` output buckets will isolate environments in later tasks; do not add an environment/stage to the v1 hash unless a concrete collision/security requirement is demonstrated.

### Production eligibility policy (distinct from A1 inventory)

The nine-bucket evidence contains mostly JPEG photos, plus small populations of PNG/WebP/JFIF, 35 Canon CR2 RAW files, and many NEF files with separate JPEG counterparts.

- v1 standard image candidates: `jpg`, `jpeg`, `jfif`, `png`, `webp` (subject to successful decode).
- `cr2`: a **separate embedded-preview path**; eligible only when a working extractor has been demonstrated and the preview is actually usable.
- `nef` and `cr2` are not browser-native image formats. NEF support is deferred because matching JPEGs already exist; do not make it eligible in A2.
- HEIC/HEIF, GIF, BMP, AVIF, TIFF, PSD, other RAW and video/document formats remain out of scope or unverified; do not silently expand the supported list.
- Reject/skip zero-byte objects, folder markers, unsupported formats and missing required key identity. An extension alone is not proof that bytes are decodable.
- Return a clear nonfatal eligibility/unsupported result rather than throwing for ordinary unsupported formats. Invalid/undecodable input, missing CR2 preview and processing failures must not compromise originals.
- Keep policy centralized in the backend and separate from both the A1 measurement classifier and frontend presentation classification.

### Transform recipe and resource safety

Based on A1: output WebP, maximum edge 512 px, quality 80, `fit: 'inside'`, `withoutEnlargement: true`, auto-orient, preserve aspect ratio/transparency and strip unnecessary source metadata. The local CR2 experiment extracted `PreviewImage` (5472 x 3648, 2,746,504 bytes), producing a 512 x 341 WebP (40,506 bytes) of acceptable quality. `ThumbnailImage` was far lower quality and is not an acceptable default fallback.

- Reuse the successful Sharp settings rather than inventing multiple thumbnail sizes or crops.
- Keep Sharp's input-pixel safety limits; do not set `unlimited: true`. Add modest bounds for untrusted input/payload size when practical.
- A streaming path may be investigated, but avoid complexity and unbounded whole-file buffering solely to appear streaming. Explain actual memory trade-offs, especially for CR2 input.
- A2 should output thumbnail data and metadata in memory; do not write to Wasabi or modify source files.
- If failure occurs, distinguish unsupported/no-preview from genuine failures with safe messages. Never expose private paths/object keys or raw errors in logs.

### Canon CR2 gate

A manual ExifTool 13.59 test established that a representative CR2 has a good **`PreviewImage`** (5472 x 3648) plus a poor 17 KB `ThumbnailImage`; Sharp does not decode the original CR2 with the current installation.

Evaluate a portable Node.js implementation that extracts the larger **embedded JPEG** without fully developing RAW sensor data. One candidate is `extract-raw-preview` (pure ESM, MIT, zero runtime dependencies as advertised), but it is a young third-party package and must be assessed for version, provenance, license, security and Node 24 compatibility. Do not adopt solely on documentation.

- Use CommonJS-compatible `import()` if evaluating an ESM-only library; do not migrate the repository to ESM.
- Provide a **local-only, opt-in** way to test a user-supplied CR2 file without committing samples or exposing file paths in output.
- Verify a decodable **large/high-resolution** preview comparable to the ExifTool result, correct orientation/visual appearance, and successful Sharp-to-WebP output. Do not accept the 17 KB `ThumbnailImage` as equivalent evidence.
- Test on Node 24 and assess Linux Lambda packaging implications; Windows-only success does not establish worker compatibility.
- Use focused, privacy-safe tests (synthetic/permissively licensed fixtures only); never commit personal RAW photos.
- If the candidate cannot be proven compatible or its quality/security is poor, **do not silently claim CR2 support or add a heavy RAW converter**. Report the blocker and stop for architectural review, while preserving the standard-format foundation if that work is complete.

### Dependency and packaging isolation

`sharp` is currently in `devDependencies`, imported only by A1 prototype code; `serverless.yml` defines a single API Lambda. A2 may add new thumbnail-only modules and local tests, but the Express/API runtime must not import Sharp, CR2 extraction code, or those modules. Do not modify `serverless.yml`, AWS IAM, GitHub workflows or deployment environment variables.

Keep Sharp and any experimental CR2 extractor as **development-only for this non-deployed A2 stage**, documenting that the future worker stage must explicitly revisit production dependency placement and Linux packaging. Do not introduce a Lambda Layer or individual function packaging in A2.

## Testing and evidence gates

Use existing Node 24 and `node:test`/`node:assert/strict`; preserve all current tests. Add focused coverage for key determinism/collision separation, ETag/version behavior, supported/unsupported and zero-byte policy, transform dimensions/orientation/metadata/transparency, CR2 missing-preview/low-quality-preview failure paths, and error isolation. Assert that standard browsing (`Delimiter: '/'`), original `AccessUrl`, authentication, region resolution and API contracts remain unchanged.

Use synthetic/pure fixtures and dependency injection only when it simplifies tests without expanding production abstractions. For local work:

```text
npm ci --include=dev
npm test
git diff --check
git status --short
```

`npm ci --include=dev` is useful on developer machines with `NODE_ENV=production`/npm omit settings; existing CI uses `npm ci` in its normal environment. Bruno `npm run test:integration` is not required for a pure non-API task; do not fake cloud checks or deploy.

Stop and report exact files, tests, CR2 proof/failure and packaging implications. No A2 change authorizes backfill, SNS, Lambda, storage writes, API/React integration, automatic bucket notifications, or deployment.

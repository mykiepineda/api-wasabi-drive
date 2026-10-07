# Wasabi Drive Backend - GitHub Copilot Instructions

## Ownership and working agreement

Wasabi Drive is a deployed personal application and an enterprise-architecture/cloud-engineering learning project. The developer is the technical owner and architectural decision-maker. ChatGPT assists with architecture, task specifications and review; Copilot implements only the selected task.

Prefer small, reviewable changes. Do not independently redesign architecture, expand scope, change cloud permissions, upgrade unrelated dependencies, commit, push, create/merge a pull request, or deploy. Read the current source and the owner's latest task prompt before editing. Source is authoritative for existing behavior; the task prompt defines the intended change. Report material conflicts rather than guessing.

## Current phase and active task

Current phase: **Phase 8 - Media Performance**.

Completed and production-validated foundations include:

- Microsoft Entra authentication and trusted-user authorization;
- private Wasabi object access through backend-generated temporary `AccessUrl` values;
- AWS SDK for JavaScript v3;
- cursor pagination using opaque continuation tokens;
- multi-region Wasabi bucket discovery and regional client reuse;
- CI/CD with protected `master`, automatic `test` deployment, and manual exact-SHA production promotion;
- safe API error boundaries and `MaxKeys` validation;
- structured request logging with deployment stage and release SHA;
- frontend browser-native image lazy loading and async decoding.

The active implementation task is **Phase 8 Task 8C-A1 - Thumbnail evidence: read-only image inventory and local Sharp prototype**.

Suggested branch: `feat/8c-a-thumbnail-foundation`.

Implement only 8C-A1 when explicitly instructed. Stop for evidence review afterward. Do not continue to the final thumbnail key/policy/service foundation or Tasks 8C-B, 8C-C, 8C-D, or 8C-E without separate approval.

## Established backend architecture

Preserve:

- Node.js 24;
- Express 4;
- CommonJS JavaScript;
- AWS Lambda behind API Gateway REST API;
- `serverless-http` Lambda adaptation;
- Serverless Framework v4 and CloudFormation;
- AWS SDK for JavaScript v3;
- private Wasabi S3-compatible storage;
- separate `test` and `prd` stages.

Preserve dependency direction:

`HTTP / Express route -> application/service layer -> storage/infrastructure -> AWS SDK -> Wasabi`

Current source map:

- `src/app.js`: Express construction, authentication/authorization mount, request logging, final error handler, Lambda adapter.
- `src/api/buckets.js`: bucket HTTP routes.
- `src/service/buckets.js`: bucket/object orchestration and per-object `AccessUrl` generation.
- `src/storage/wasabi.js`: Wasabi SDK access, multi-region discovery/cache, regional clients, object listing and presigning.
- `src/config/index.js`: centralized runtime configuration.
- `src/errors.js`: application-owned validation/storage error model.
- `src/observability/requestLogger.js`: safe structured request completion logs.
- `serverless.yml`: current single Express/API Lambda and runtime environment configuration.
- `test/`: Node.js built-in `node:test` tests.
- `scripts/`: local/integration utilities.
- `.github/workflows/`: protected CI/CD workflows.

Do not collapse these layers for thumbnail work.

## Security and data invariants

Preserve the trusted request path:

React/MSAL -> Microsoft Entra -> OAuth 2.0 API access token -> API Gateway -> Express authentication -> application authorization -> private Wasabi storage.

Preserve:

- mandatory Microsoft Entra authentication for `/buckets`;
- backend trusted-user authorization;
- private source objects;
- server-side Wasabi credentials;
- server-generated temporary object URLs;
- no API-key authentication;
- no legacy MongoDB/password authentication.

Never put Wasabi credentials, AWS credentials, bearer tokens, Entra identifiers, complete presigned URLs, object payloads, or private object keys into logs or committed reports.

Original Wasabi objects are authoritative. Thumbnail-related code must never overwrite, rename, move, or delete an original object.

## Existing API/error/logging behavior is an invariant

Do not change normal API behavior during 8C-A1.

Preserve:

- `GET /health` as unauthenticated `{ "status": "ok" }`;
- current `400`, `401`, `403`, `500`, and `502` response contracts;
- request lifecycle logging schema and redaction rules;
- current `AccessUrl` semantics and 3600-second presigning duration;
- existing object-list response shape;
- existing authentication/authorization order.

Task 8C-A1 must not add `ThumbnailAccessUrl` or alter the frontend-facing API contract.

## Multi-region Wasabi invariants

The configured Wasabi endpoint/region is the bootstrap client. Buckets may exist in different Wasabi regions.

Preserve:

- `GetBucketLocation` discovery;
- validated `307 TemporaryRedirect` handling;
- canonical regional endpoints;
- region/client caching and retryable failed discovery;
- correct regional client selection for listing and presigning.

`src/storage/wasabi.js#getListObjects` is browse-specific. It intentionally uses `Delimiter: "/"` and current prefix/pagination semantics. **Do not change that behavior for inventory.**

If recursive inventory needs a storage addition, add a separate focused page-level storage method using `ListObjectsV2` without `Delimiter`, reusing the existing bucket-region resolution, regional client and `sendProviderRequest` boundary. Keep the existing `getListObjects` contract unchanged.

`StorageProviderError` already recognizes the fixed `ListObjectsV2` operation. Do not invent a new provider operation name when the inventory call is still `ListObjectsV2`.

## Configuration invariant

`src/config/index.js` currently validates `ENTRA_TRUSTED_USER_OBJECT_IDS` at module load, and the storage layer imports this centralized config.

Do not weaken, bypass or broadly refactor this fail-closed security configuration merely to make the inventory CLI independent of Entra settings.

A local inventory script should load the repository's existing `.env` before requiring application/storage modules and should run with the same complete local configuration already used by the backend. If this proves materially unusable, stop and report it rather than redesigning authentication configuration in 8C-A1.

## Task 8C architectural direction

Thumbnails are private, derived, disposable application data. Originals remain authoritative.

The approved future direction is:

- a separate private thumbnail bucket per environment;
- deterministic/versioned thumbnail identity;
- a shared thumbnail service for future event processing and backfill;
- future Wasabi ObjectCreated -> AWS SNS -> thumbnail Lambda automation;
- no SQS unless measured operational need appears;
- `AccessUrl` remains the original-object URL;
- a future optional `ThumbnailAccessUrl` will represent the derived preview URL.

These are architecture constraints, not permission to implement later stages during A1.

## Task 8C-A1 scope

8C-A1 exists to gather evidence before locking the v1 thumbnail policy and transform recipe.

Implement only:

1. a read-only recursive image-library inventory utility;
2. a local Sharp prototype for representative files;
3. focused automated tests;
4. concise documentation/usage needed to run those tools.

Do not build the deployed thumbnail system yet.

## Read-only inventory requirements

The inventory utility must:

- scan only explicitly supplied source bucket(s); do not silently scan every account bucket;
- support an optional prefix and arbitrary nested subfolders;
- recursively enumerate object metadata through paginated `ListObjectsV2` calls without `Delimiter`;
- reuse the existing storage/multi-region implementation rather than creating an independent S3 client in the script;
- never modify source objects;
- never download every source object merely to classify formats;
- never issue one `HeadObject` request per item;
- tolerate empty pages/buckets and pagination correctly.

Keep the CLI simple. Do not add a command-line parsing dependency solely for A1; ordinary `process.argv` parsing is sufficient.

Default output should be aggregate-only and should not print every key or bucket name. Report at least:

- number of source buckets scanned;
- total object count and bytes;
- zero-byte/folder-marker count;
- extension counts and bytes, normalized case-insensitively;
- unknown/no-extension count and bytes;
- broad candidate-image count and bytes;
- candidate-image source-size p50, p90 and maximum;
- missing-ETag count.

If percentiles are implemented, keep the algorithm deterministic and test it. A simple nearest-rank percentile is appropriate for this utility.

The inventory's `candidate image` concept is measurement only, not the final thumbnail eligibility policy. At minimum account for the frontend's current presentation formats (`jpg`, `jpeg`, `webp`, `bmp`, `png`, `gif`, `heic`) plus other common image extensions found useful for inventory such as `heif`, `tif`, `tiff`, and `avif`. Final supported formats remain unapproved until evidence is reviewed.

Do not commit inventory output containing personal filenames or bucket names. If the implementation writes reports, use a clearly local ignored directory and update `.gitignore` narrowly.

## Sharp prototype requirements

Add `sharp` only for local prototype/testing during A1. Prefer `devDependencies` so the existing deployed Express Lambda does not gain a native runtime dependency.

Do not import Sharp from `src/app.js`, `src/api/`, `src/service/buckets.js`, `src/storage/wasabi.js`, or any module loaded by the existing API runtime.

The local prototype should:

- accept a local input image path and output path/directory;
- allow maximum edge and WebP quality to be configured;
- default to a 512 x 512 bounding box;
- preserve aspect ratio;
- use `fit: "inside"`;
- use `withoutEnlargement: true`;
- auto-orient using image orientation metadata;
- output WebP with prototype quality 80;
- preserve Sharp's default safety limits;
- not use `unlimited: true`;
- strip source metadata by default;
- report source format/dimensions, output dimensions, input/output bytes and byte-reduction percentage;
- fail cleanly for unsupported or undecodable input without exposing sensitive data.

A1 does not require stream optimization. Prefer the simplest reliable local-file prototype. Streaming from Wasabi should be evaluated when the reusable worker/service implementation is designed later.

Do not add HEIC/HEIF-specific native build configuration in A1. Test the actual installed Sharp/libvips behavior against representative files first.

## Serverless/package boundary

Current `serverless.yml` defines one `app` Lambda and does not use individual function packaging.

Task 8C-A1 must not:

- add a second Lambda;
- add SNS/SQS resources;
- add a thumbnail bucket;
- introduce `package.individually` yet;
- add a Lambda Layer;
- change IAM;
- change deployment workflows.

Because Sharp is prototype-only in A1, keep it out of the existing API runtime dependency graph. `serverless.yml` should normally remain unchanged.

## Frontend boundary

The current frontend recognizes image extensions in `src/components/main/File.jsx` and uses the same `AccessUrl` for both the grid image and the original-object link.

That frontend list is presentation behavior, not an approved backend processing allowlist.

Task 8C-A1 is backend-only. Do not modify frontend source, frontend tests, Firebase configuration or frontend Copilot instructions.

## Expected A1 implementation areas

After inspecting current source, expected changes are limited to areas such as:

- `src/storage/wasabi.js`: one separate recursive/paginated metadata-page method if needed;
- a small thumbnail/inventory helper module under `src/thumbnail/` or equivalent;
- `scripts/inventory-images.js`;
- `scripts/prototype-thumbnail.js`;
- focused tests under `test/`;
- `package.json` / `package-lock.json` for Sharp and local script commands;
- a small README section and possibly `.gitignore` if local reports are written.

Do not modify unrelated files simply because they were inspected.

## Testing

Use the existing Node.js built-in test stack: `node:test` and `node:assert/strict`. Do not add a new test framework.

Add focused tests proving at least:

- recursive inventory pagination uses the separate metadata-listing path without changing browse `Delimiter` behavior;
- extension normalization is case-insensitive;
- no-extension and zero-byte objects are classified correctly;
- aggregate counts/bytes and percentile calculations are correct;
- missing ETags are counted safely;
- prototype resize stays within bounds;
- aspect ratio is preserved;
- smaller images are not enlarged;
- orientation metadata is applied when practical to test with generated data;
- invalid/undecodable image content fails cleanly;
- existing `AccessUrl`, multi-region, security, logging and API tests remain unchanged/passing.

Use generated/synthetic test images where possible. Never add personal source photos to the repository.

Run on Node.js 24:

```text
npm ci
npm test
git diff --check
git status --short
```

If a local stage environment is already available, a non-deploying `serverless package --stage test` packaging check may be used to confirm the API package does not rely on Sharp. Do not invent or expose secrets merely to make that check run. Report it as skipped when appropriate.

`npm run test:integration` is not required for A1 because no external API contract should change. If the implementation unexpectedly changes the API, stop and report scope drift rather than treating integration tests as permission to continue.

## CI/CD and change management

`master` is protected and should remain deployable. Implementation belongs on the focused task branch.

Preserve all existing workflow files, pinned actions, OIDC deployment roles, Environment protection, exact-SHA production promotion, smoke tests and deployment commands.

Do not deploy during A1 unless the owner separately requests deployment.

Do not commit, push, create/merge a pull request, or force-push unless separately instructed. Propose focused commit messages only.

## Explicit non-goals for A1

Do not implement:

- deterministic final thumbnail object keys;
- the final backend eligibility allowlist;
- the reusable production ThumbnailService;
- thumbnail writes to Wasabi;
- existing-library thumbnail backfill;
- SNS;
- SQS;
- a thumbnail Lambda;
- Wasabi bucket event notifications;
- thumbnail bucket infrastructure;
- Lambda individual packaging/layers;
- API `ThumbnailAccessUrl`;
- frontend thumbnail rendering/fallback;
- video fixes;
- document/video preview generation;
- Vite, TypeScript, CSS framework or viewer modernization;
- unrelated dependency upgrades/refactors.

## Completion report

Stop after A1 and report:

- branch and starting/base SHA;
- exact files changed;
- why each change was necessary;
- inventory/storage approach and confirmation that existing browse listing semantics were preserved;
- Sharp dependency placement and confirmation that existing API runtime code does not import it;
- tests added and exact command/results;
- `git diff --check` and `git status --short` results;
- exact read-only inventory command(s) for the owner;
- exact local prototype command(s) for representative images;
- evidence fields the owner should bring back for architecture review;
- any actual HEIC/HEIF behavior observed;
- packaging check run or omitted and why;
- confirmation that no API/frontend/infrastructure/deployment/security behavior was changed;
- proposed focused commit messages;
- any remaining issues.

Do not proceed beyond A1 until the owner reviews the evidence and explicitly approves the next step.

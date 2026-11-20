# Copy-ready GitHub Copilot task — Wasabi Drive Phase 8D-C3

You are implementing **Phase 8D-C3: deterministic v2 thumbnail URL signing** on a focused task branch from the latest backend `master`. The owner makes architectural decisions. **Do not commit, push, merge, deploy, contact Wasabi/AWS, change GitHub Environment settings, use production credentials, run backfill/pilot/inventory/preflight/integration commands, or touch any state/backup/audit files.** Work only with synthetic/mocked tests and leave modifications for review.

## Inspect first

1. Show `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, `node --version`; read `AGENTS.md` and `.github/copilot-instructions.md`. If on `master`, create `feature/thumbnail-v2-deterministic-signing` from up-to-date clean `master`; don't discard existing changes. If branch is not clean, stop and report.
2. Read `src/thumbnail/key.js`, `src/thumbnail/eligibility.js`, `src/service/buckets.js`, `src/storage/thumbnail-api-wasabi.js`, `src/config/index.js`, `src/app.js`, `serverless.yml`, both deployment workflows, `.env.example`, `README.md`, `test/buckets.service.test.js`, `test/thumbnail-api-wasabi.test.js`, `test/config.thumbnail-api.test.js` and applicable auth/security tests.
3. Summarize present v1 behavior and propose a minimal change plan before editing.

## Implement

**Approved behavior:** Existing v1 thumbnail URLs for up to 13 exact allowlisted Tokyo derivatives continue unchanged. New v2 thumbnail URL signing is separately enabled for one exact Sydney source bucket and prefix in each stage. For each source object already returned by authorized `/buckets` listing, calculate a deterministic `v2` key from its **current listing ETag**, source region, bucket, full key and version; sign it using the fixed dedicated Singapore derived-read identity; return `ThumbnailAccessUrl`. No per-file v2 allowlist, coverage manifest, HEAD/existence check or new endpoint. Preserve original `AccessUrl` and frontend fallback. Do not broaden user or storage authorization.

**Config:** Add a default-off `THUMBNAIL_API_V2_ENABLED` plus source bucket, source region and slash-terminated prefix. Reuse existing **stage-specific** derived-bucket/region, explicit dedicated read credential pair and TTL if compatible; validate them when either mode is enabled, with derived bucket in `WASABI_INTERNAL_BUCKETS`. Keep `THUMBNAIL_API_ENABLED`, v1 source/prefix, v1 13-key allowlist and the Tokyo-only production guard intact. V2 stage is explicit; current source region may be only `ap-southeast-2` for this initial rollout. Fail closed on invalid booleans, scope, credentials, identity reuse, prefix, stage, derived region or overlapping v1/v2 scopes. If the actual configuration needs separate destination credentials, **stop and raise the trade-off** rather than silently changing security design.

**Service:** Candidate selection on `getListObjects` only. Check selected bucket, `getBucketRegion()` resolved region, exact prefix match on each returned object and shared `evaluateThumbnailEligibility()`, plus the existing `MAX_SOURCE_BYTES` (25 MiB) limit for v2 candidates only. Use `createThumbnailKey({ formatVersion: "v2", sourceRegion, sourceBucket, completeSourceKey, normalizedETag })`. V1 still requires legacy allowedKeys. Preserve bucket filtering, authorization middleware, pagination, original URLs and sanitized error aggregation. Handle one region lookup per applicable listing page, not per object. Do not make `HeadObject` requests.

**Signer:** Existing factory only signs v1 keys; permit canonical lowercase `v2/xx/<64hex>.webp` keys while continuing to permit v1. Ensure shard equals first two digest characters. Reject v3, uppercase, malformed, traversal, caller-chosen buckets, unknown keys. Sign with GetObjectCommand and the configured dedicated read identity only; no network check of existence.

**Workflows/docs:** Wire `THUMBNAIL_API_V2_*` through Serverless, test and PRD GitHub Actions, `.env.example`, README. Keep flags default-off, source identifiers in protected configuration, secrets externalized, no arbitrary v2 key lists. Document opt-in and rollback by disabling the v2 flag **and redeploying**, with v1 untouched. Do not enable the flag in any environment as part of implementation.

## Required synthetic tests

- V1 existing 13-key allowlist, sign URL and Tokyo production guard remain unchanged; errors still sanitized.
- V2 disabled by default, enabled with complete safe stage configuration independent of v1 enabled state; invalid/overlapping scope fails before storage operations.
- Exact source bucket/region/prefix + eligible JPG/PNG/WebP and ETag produce expected v2 URL; changed ETag generates a different key; wrong source or noneligible or known-oversize object does not.
- Canonical signer allows only v1/v2 matching shards, uses fixed derived bucket/region read credentials, never HeadObject, never arbitrary bucket/key.
- Original `AccessUrl`, pagination, `CommonPrefixes`, internal derived-bucket hiding and auth/trusted-user enforcement remain unchanged.
- Signer initialization or signing failure gracefully omits only thumbnail URL; logs no secrets, signed URL, private key or ETag.
- No Sharp/backfill dependencies pulled into the Express/Lambda module graph. CI and Serverless v2 settings are wired correctly and default false.

## Validate and hand off

Run `npm test` with Node.js 24 and locked dependencies, plus `git diff --check`, `git status --short`, syntax checks for changed `.js` files. Report actual test totals, failures/skips, changed files, default feature behavior, unresolved decisions and production/TEST configuration still needed. **Stop without committing or deploying.**

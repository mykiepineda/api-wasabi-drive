# Wasabi Drive backend — GitHub Copilot instructions (Phase 8D-C3)

**Active task: implement an opt-in deterministic C1/`v2` thumbnail access-URL path for one explicitly enrolled Sydney source scope per deployment stage. Code-only work, not rollout.**

## Owner, baseline, and workflow

- The owner is the architectural decision-maker; ChatGPT is the independent reviewer, Copilot is a narrowly scoped implementer.
- Read the actual repository `AGENTS.md`, current `.github/copilot-instructions.md`, `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, and relevant source/tests before editing. The current checkout and latest approved owner decisions supersede this prompt if they conflict; surface any conflict rather than guessing.
- Branch off updated `master` using `feature/thumbnail-v2-deterministic-signing`. Do not commit, push, merge, open a PR, deploy, modify live stage variables/secrets, invoke AWS/Wasabi, run live Bruno requests or local pilots/backfills, or touch Docker volumes/audits/checkpoints. Do not make production reads or writes. Leave changes uncommitted for review.
- Keep Node.js 24, CommonJS, Express 4, Serverless v4, API Gateway REST, Firebase frontend, Entra authentication and trusted-user authorization, bucket/service/storage separation and all existing private storage constraints.
- Preserve existing tests; no weakening or unrelated cleanup. Work only with synthetic fixtures and mocked storage/presigner. Run `npm test`, `git diff --check` and relevant `node --check` on Node.js 24 and report actual totals.

## Current state and approved decisions

- C1 `v2` is immutable 200×190 centre-cropped WebP quality 80. The complete Sydney production collection of 100 was processed, closed, and sampled visually by the owner; do not run generation again.
- Existing API v1 pilot signs only an allowlist of up to 13 deterministic `v1` keys, with strict Tokyo PRD source guard, dedicated derived read credential, private Singapore derivative destination and `THUMBNAIL_API_ENABLED` control. It must not regress.
- The existing React frontend already accepts optional `ThumbnailAccessUrl` and falls back once to `AccessUrl` on image-load failure. Preserve the response contract and no frontend edits.
- For v2: **no per-file whitelist, coverage manifest, database, object-existence HEAD, new signed-URL endpoint, proxy, CDN, queue or automatic generation**. Compute the current source ETag-dependent `v2` key for each eligible returned object in an exact configured scope. Source listing must already be protected by Entra and trusted-user middleware; backend authorization remains authoritative.
- For the first rollout, v2 serves one configured Sydney (`ap-southeast-2`) source bucket and nonempty slash-terminated prefix per stage and private Singapore (`ap-southeast-1`) derived bucket. TEST and PRD must remain isolated; source and derived buckets cannot be identical; derived must be hidden through `WASABI_INTERNAL_BUCKETS`. Do not auto-enrol all Sydney buckets.

## Recommended compact implementation

1. Add `THUMBNAIL_API_V2_ENABLED` (default `false`) and exact source `THUMBNAIL_API_V2_SOURCE_BUCKET`, `THUMBNAIL_API_V2_SOURCE_REGION`, `THUMBNAIL_API_V2_SOURCE_PREFIX`. Keep legacy `THUMBNAIL_API_ENABLED`, `THUMBNAIL_API_SOURCE_*`, and `THUMBNAIL_API_ALLOWED_KEYS` as **v1-only**. Continue to require/validate the existing shared derived-bucket, Singapore region, dedicated read credentials and TTL when either recipe is enabled, even if v1 is disabled. Refactor config only as far as necessary to share validation; do not require legacy v1 allowlist to enable v2. If destinations/credentials genuinely differ, stop and report rather than creating new secrets or weakening separation silently.
2. Enforce exact Sydney v2 source region for TEST and PRD, distinct stage source/destination identities, valid exact bucket and slash-terminated prefix, trusted stage, independent signer identity, and private derived-bucket protection. Fail closed on malformed enabled config. Preserve legacy v1 PRD Tokyo-only / TEST non-Tokyo rules and the 13-key cap. For this release, reject overlapping v1/v2 source scopes instead of ambiguously overriding them; migrating the original 13 comes later.
3. Preserve deterministic key identity `["v2", sourceRegion, sourceBucket, completeSourceKey, normalizedETag]` by calling existing `createThumbnailKey({formatVersion:"v2", ...})`. Use `evaluateThumbnailEligibility` unchanged and, for v2 only, exclude originals larger than `MAX_SOURCE_BYTES` (25 MiB from `src/thumbnail/policy.js`) so known-oversize sources never receive speculative v2 links. Compare the actual region resolved by `wasabi.getBucketRegion` and exact bucket/prefix for returned `Contents` before signing. No new HeadObject, per-file lookup, or cross-bucket scan. Reuse one region discovery per list page where possible.
4. In `src/storage/thumbnail-api-wasabi.js`, accept canonical `v1` and `v2` keys, each with lowercase two-character shard matching the 64-character SHA-256 hex digest. Reject arbitrary versions, malformed keys, mismatched shards, path traversal, client-selected bucket and signer credential fallbacks. `GetObjectCommand` is used for local signing only, never a live derivative existence request.
5. Preserve `AccessUrl`, pagination and original `Contents` metadata. Add `ThumbnailAccessUrl` only when the authorized scoped candidate successfully signs. A signer failure must not suppress original `AccessUrl`; log sanitized aggregate category and count, never raw URL, ETag, key, credential or provider exception. Do not import Sharp, backfill, raw preview, Docker or image processors in API modules.
6. Thread v2 flag and source settings through `serverless.yml`, `.github/workflows/backend-test-deploy.yml`, `.github/workflows/backend-prd-deploy.yml` and `.env.example` with disabled default and protected stage-specific variable/secret handling; update README and this instructions file only as relevant. Ensure config preflight is performed by existing deploy workflows before deployment.

## Tests required

- Legacy v1: exact allowlist, Tokyo guard, v1 signer, TTL, stage validation and key cap unchanged; no regressions.
- V2 disabled => no v2 URL even when the source matches; v1 disabled and v2 enabled => valid v2 URL without v1 credentials/allowlist requirements beyond shared derived signer settings.
- V2 scoped candidates => byte-for-byte key parity with `createThumbnailKey` using full key and actual normalized ETag; wrong bucket/region, outside prefix, invalid/missing ETag, zero-byte, folder marker, unsupported type, or >25 MiB => no thumbnail signing.
- Canonical v1 and v2 keys only; no arbitrary version, mismatched shard, malformed digest, path traversal or unconfigured derived bucket allowed.
- Original AccessUrl and page data unchanged; one bounded region resolution; no thumbnail existence HEAD; no extra cloud client calls beyond existing listing/original signer behavior. Signing errors are sanitized and original URL remains.
- API authentication/trusted-user authorization, internal bucket hiding, and no image processing imports remain intact. Invalid stage config should fail before deployment.
- TEST/PRD workflow and `serverless.yml` wiring is tested or independently inspected. No new staging or policy changes, no actual Wasabi traffic.

## Stop / report

Run `node --version`, `npm test`, `git diff --check`, and `git status --short` under locked Node.js 24 dependencies. Report changed files, tests passed/skipped/failed, config behavior, v1 compatibility, known gaps, and any deployment environment settings the owner must configure later. Stop with uncommitted changes for ChatGPT review. No cloud deployment or feature enablement.

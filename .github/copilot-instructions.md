# Wasabi Drive backend — GitHub Copilot instructions (Phase 8D-C1)

**Active task: local-only implementation of the fixed C1 thumbnail recipe as an immutable `v2` production-library option.** This file replaces the backend's `.github/copilot-instructions.md` for the focused task. It does not authorize the later backfill, deterministic API rollout, live storage access, or deployment.

## Current owner decisions

- The owner is the architectural decision-maker; Copilot edits source under a focused prompt, and ChatGPT independently reviews the result. Do not broaden scope.
- Phase 8C is completed and owner-validated. Preserve its 13 production `v1` derivatives, original objects, historical audit/checkpoint, and backup evidence; do not reopen verification or rewrite state.
- Phase 8D-A is complete: the fixed-size frontend grid is deployed and accepted. The selected C1 recipe is **200 x 190 pixels, centred physical crop, WebP quality 80**; its sample showed a 67.9% aggregate thumbnail-byte reduction versus existing 512/80 on the tested photographs. This is *not* measured page-speed improvement.
- Long-term approved thumbnail delivery: backend derives the expected `v2` key for an eligible, authorized original and signs a private derivative URL **without a per-file whitelist, coverage manifest, or per-object existence request**. The existing frontend attempts the original `AccessUrl` once if a thumbnail URL fails. It requires no changes in this task.
- Today the API is still a constrained `v1` pilot. **Do not activate speculative signing yet**. Enable v2 delivery only on approved source scopes after controlled generation and verification, so ordinary browsing is not made worse while the backfill is incomplete.
- The future automatic-upload pipeline is not part of this phase. No event notifications, SNS/SQS, extra Lambda, database or new cloud service.

## Working tree, Git, and permissions

- On the owner's local Windows VS Code checkout, inspect `git branch --show-current`, `git status --short`, and `git rev-parse HEAD` before editing. Treat the actual local source as authoritative; the prior supplied backend `master` snapshot is not a substitute for the current checkout.
- The owner should prepare a new focused branch **`feature/thumbnail-recipe-v2` from the latest `master`**. Do **not** silently implement on `feature/thumbnail-coverage-manifest`, merge the experimental prototype branch, or switch/reset/stash branches on the owner's behalf. If not on the approved branch or if conflicting changes exist, stop and report.
- Never commit directly to `master`. Do not commit, push, create PRs, merge, or deploy without separate owner approval. Leave code changes uncommitted for review.
- An untracked `.env.local` was reported in a previous checkout. Do not read, move, overwrite, stage, or print it. Never read credentials or private Wasabi filenames/buckets/state volumes; never put them in source/tests or chat.
- Allowed: read repository source, make narrowly scoped library/test/documentation edits, run Node.js 24 local mocked tests (`npm test`), `git diff --check` and status/diff inspection. `npm ci` only if required to test; never mutate lockfile. No Wasabi/AWS calls, live integration tests, credential updates, Docker production runs, or deployment/packaging commands.

## Architecture invariants

- Retain Node.js 24, Express 4, CommonJS, Lambda/API Gateway REST API, Serverless Framework v4, private multi-region Wasabi storage, central configuration and route -> service -> storage separation.
- Authentication through Microsoft Entra access tokens and backend trusted-user authorization stays mandatory for API routes. Frontend state, API keys and CORS are not authorization.
- Keep original `AccessUrl`, pagination, folder semantics, internal-bucket hiding/rejection, and the dedicated read-only derivative signer unchanged in this task.
- Do not import Sharp, RAW preview libraries, or any write-capable generation/backfill module into Express/API import paths.
- The immutable `v1` recipe is max edge 512, inside fit, no enlargement, WebP quality 80. **Default legacy calls must still produce v1 keys and preserve the same output policy**.
- Derivative identity is defined by `src/thumbnail/key.js` as `[formatVersion, sourceRegion, sourceBucket, completeSourceKey, normalizedETag]`, hashed and rendered `<version>/<two hex>/<64 hex>.webp`. Do not rewrite this helper or normalize/trim complete source keys. The ETag is not a universal file checksum.
- For C1, preserve existing EXIF/CR2 orientation handling, source size limits, safe failure paths, WebP output and metadata stripping. No arbitrary user-supplied crop parameters or other dynamic recipes.
- For a source/embedded preview too small to yield exactly 200 x 190 **without enlargement**, the conservative provisional policy is to skip and report a distinct reason; do not upscale silently or generate a differently sized `v2`. Flag this policy explicitly in the review result for final owner acceptance before live generation.
- Keep `IfMatch` on source reads, `IfNoneMatch: "*"` on derived writes, bounded processing, checkpoint/audit durability and one effective writer lock untouched in this task. The next implementation step will explicitly version generation state; do not assume current backfill can safely process `v2`.

## Immediate task boundary and acceptance

Implement only the **production-library `v2` transformation and versioned derivative-key selection** needed to reuse the tested centre-crop prototype logic safely. Favor the smallest precise change to the existing `src/thumbnail/service.js` / `src/thumbnail/transform.js` and their synthetic tests; preserve `v1` as default. Follow the separate task prompt for exact scope.

Tests should cover: `v1` unchanged and default; `v2` centre crop 200 x 190 and WebP q80; landscape and portrait; orientation and alpha where applicable; malformed/unexpected recipe ID fail closed; small original/embedded preview no-enlargement policy; correct `v1` vs `v2` deterministic key identity; and no write-capable or Sharp imports into Express. Keep existing tests passing—do not weaken them.

Do **not** implement or modify in this task: production backfill runner/CLI/checkpoints, storage adapters, API deterministic signing or source enrolment, feature flags, Serverless/CloudFormation/workflows, frontend, migrations, secrets, Wasabi permissions, or source-folder scans.

Report all changed files, actual test results and limitations, plus precisely what remains before C1 can be generated in TEST. Stop for the owner's and ChatGPT's review.

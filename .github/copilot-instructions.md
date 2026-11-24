# Wasabi Drive backend — GitHub Copilot instructions (Phase 8D-D, Task 1A)

**Active task:** add a narrowly scoped, backwards-compatible bucket-scoped v2 source-enrollment boundary for the authenticated API and supply one pure validator that the production preflight/backfill can reuse in Task 1B. **Code and mocked tests only. Do not execute backfills or deploy.**

## Authority and working agreement

- The owner is the architectural decision-maker. ChatGPT reviews architecture and code; GitHub Copilot/Codex implements only the approved small task.
- Governing handoff: `Wasabi-Drive-CURRENT-IMPLEMENTATION-HANDOFF.md`, revision **2026-11-23.2**. The uploaded backend snapshot (51) identifies source commit `3baa99bf47d1c4fb1b2aca5ddd6988aedd2953ac`; recheck the actual checkout before edits. In case of newer source/owner decisions, report differences and follow the latest approval.
- Inspect `AGENTS.md`, this file, `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, relevant modules/tests, and `README.md` before making changes. Respect unrelated modifications. Do not commit to `master`.
- Work on `feature/v2-bucket-scoped-backfill` (or another owner-approved focused task branch) based on the latest verified `master`. Leave all changes **uncommitted** for owner/ChatGPT review. Do not push, merge, create a pull request or deploy.
- Do not contact live AWS/Wasabi, inspect private credentials, run live Bruno integration, run Docker backfills/preflight, touch checkpoint/audit/backup volumes, edit GitHub Environment variables or apply policies. Tests must use synthetic fixtures, stubs and mocks only.
- Keep Node.js 24, Express 4, CommonJS, Serverless Framework v4, API Gateway REST, Microsoft Entra access-token authentication and trusted-user authorization. Preserve the existing route -> service -> storage -> Wasabi AWS SDK separation, TEST/PRD isolation, private derived bucket, fixed destination, and read-only API signing identity.
- Preserve current tests; do not weaken expectations or mix in stylistic cleanup. Run `npm test`, `git diff --check` and relevant `node --check` in a Node.js 24 checkout when dependencies are installed. Record actual results, not presumed results.

## Immutable decisions and current behavior

- The Sydney v2 100-photo collection was completed and accepted by the owner; the v1 13-photo pilot also completed. **Do not regenerate either pilot or alter durable state.**
- V2 recipe/key contract: WebP, 200 x 190 pixels, centre-cropped, quality 80, metadata stripped, no enlargement, 25 MiB source maximum; deterministic key from `["v2", sourceRegion, sourceBucket, completeSourceKey, normalizedETag]`. Do not alter transform, key, eligibility or storage-write behavior in Task 1A.
- `src/config/index.js` currently requires one `THUMBNAIL_API_V2_SOURCE_BUCKET`, `_SOURCE_REGION` and nonempty slash-terminated `_SOURCE_PREFIX`; v2 is hard-limited to Sydney and rejects v1/v2 scope overlap.
- `src/service/buckets.js` already chooses an eligible exact v1 pilot candidate **before** v2 and returns original `AccessUrl` even when thumbnail signing fails. V2 signing is speculative; the browser's original-image fallback is accepted. Never add per-image `HeadObject` calls, a coverage manifest or a file-level allowlist to browsing.
- The existing production backfill has a ten-object cap, read-only preflight has separate validation, and both are still tied to one exact source scope. This is Task 1B/Task 2 work, **not an excuse to widen Task 1A**.
- The transitional source bucket list is **not** the final product: a later separately approved phase must automatically discover and process eligible new buckets/uploads. Do not build the proposed SNS/SQS/Lambda, discovery, reconciliation, new policies, or queues now.

## Task 1A — precise implementation boundary

1. Add one small pure source-enrollment schema/validator (suggested location: `src/thumbnail/source-enrollment.js`) for an explicit set of `{bucket, region}` entries. It must not import API credentials, storage clients, Docker state, image generation, or policy administration. Validate exact bucket names, supported source regions, nonempty and nonduplicated entries, conflicting duplicate regions, stage-specific exclusions supplied by the caller, and separation from destination and forbidden buckets. PRD must exclude protected TEST/operational storage; TEST may enroll expressly approved TEST sources. Exclusion sets come from the stage-specific caller, not naming guesses alone. Expose a small read-only membership check by **bucket + verified region**. No per-prefix/per-object registry. Keep interfaces simple so an approved automatic discovery source can supply a validated set later.
2. Introduce an **opt-in** stage-specific JSON array config for API v2 (suggested name: `THUMBNAIL_API_V2_SOURCE_BUCKETS_JSON`, e.g. `[{"bucket":"synthetic-photos","region":"ap-southeast-2"}]`). This representation is a proposal for review, not a permanent source-administration service. When absent, preserve current one-bucket/prefix v2 behavior for rollback and existing deployed stage values. When explicitly present, fail closed if malformed/empty; require the existing pilot bucket/region also to be represented if its legacy variables remain set, or report a safer equivalent migration rule rather than silently dropping old coverage. Never treat missing/invalid config as whole-account enrollment.
3. For the opt-in set, match **any object prefix** in a selected bucket; retain literal complete object keys, eligible content and ETag-dependent keying. Permit supported source region equal to the derived region **if and only if the bucket identities differ**. Continue to require the fixed private derived bucket/region and dedicated read credentials; v1 rules, exact 13-key allowlist, original access and all existing Entra/trusted-user controls remain intact. Internal buckets must stay hidden from browsing and must never be enrolled as sources.
4. Remove the v1/v2 source-overlap rejection **only** after tests prove exact v1 candidate precedence for its allowed objects and v2 candidates for other eligible objects inside an enrolled bucket. Do not alter the v1 prefix or allowlist contract; do not re-sign the 13 v1 thumbnails as v2 by default.
5. Use existing `wasabi.getBucketRegion` once per list page for relevant candidate buckets. Require the resolved region to match the enrollment entry; fail conservatively if lookup fails. No thumbnail existence probing or additional bucket-level authorization inferred from thumbnail coverage. Preserve all `Contents`, `AccessUrl`, existing sanitized aggregate failures and `ThumbnailAccessUrl` response shape.
6. Wire the optional JSON setting through `serverless.yml`, TEST/PRD backend workflows and `.env.example`, with no hardcoded real bucket values and no rollout enablement. Document the transition and rollback in `README.md` and update this active-task file if needed. Keep existing legacy stage variables accepted and used until deliberate migration.

## Required mocked tests

- Pure schema: valid multi-bucket set, exact region membership, duplicates/region conflicts, malformed/empty JSON, unsupported names/regions, derived/internal exclusion, PRD exclusion of TEST/operational buckets, authorized TEST-source inclusion in TEST, stage mismatch, same-region distinct-bucket allowed, and no implicit wildcard or account-level authorization.
- Legacy API v2 remains unchanged when the new setting is absent; v2 disabled stays disabled; malformed opt-in configuration fails closed.
- Existing v1 pilot and all 13 allowlisted keys retain precedence when v1/v2 coverage overlaps; other eligible images in the same enrolled bucket receive correct v2 keys.
- Whole-bucket v2 coverage includes root and deeply nested object keys without normalizing identity. Non-enrolled bucket or incorrect resolved region gets no thumbnail URL; internal derived buckets remain inaccessible via existing browse paths.
- Original `AccessUrl`, listing metadata, pagination and auth/authorization remain unchanged. No live thumbnail existence `HEAD`, no new source or derived permissions and no new write path.
- Validate stage wiring and the documented compatibility/rollback path with synthetic environment values.

## Reporting and stop conditions

Report the exact changed files and source assumptions, compatibility behavior when the new setting is absent, configuration shape and safeguards, tests run and totals, and how the pure validator will be reused by Task 1B. Flag any unsafe ambiguity rather than guessing bucket classification or stage ownership. Leave uncommitted code for review.

**Explicitly excluded from Task 1A:** changing production backfill limits, CLI coordinator, read-only preflight behavior, Wasabi policies, Docker image, credential assignments, real source lists, Sydney state, API thumbnail signing keys, frontend, automatic discovery, notifications or image processing. These require subsequent bounded tasks and/or owner authorization.

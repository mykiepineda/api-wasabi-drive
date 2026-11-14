# Wasabi Drive backend — GitHub Copilot instructions (Phase 8D-C2b)

**Active task: add Sydney (`ap-southeast-2`) as an explicitly supported PRD source region for the immutable C1/`v2` thumbnail backfill. This is a LOCAL CODE-ONLY task. Do not touch Wasabi, AWS, Docker state, or deployed services.**

## Ownership and authoritative context

- The owner remains the technical/architecture decision-maker. GitHub Copilot implements focused tasks; the owner and ChatGPT review before committing, merging, granting permissions, or performing any storage operation.
- The owner reports Phase 8D-C1 (`v2` recipe), C2 (recipe-aware PRD backfill), and C2a (`v2` single-object TEST pilot) merged. TEST site remains healthy; a Sydney TEST object produced a 200 x 190 WebP, 4,980 bytes, and the owner visually verified it in the TEST-derived bucket. This verifies single-object generation/write only, NOT multi-object checkpoint/restart/recovery behavior.
- The next approximately 100-photo collection is in Sydney (`ap-southeast-2`); its stage, exact bucket, folder prefix, and permitted operations have not been stated here. NEVER assume it is a TEST or PRD source.
- The approved immutable C1 recipe is **`v2`: centre-cropped 200 x 190 WebP at quality 80, orientation-safe, without enlarging small images**. Existing `v1` remains immutable at 512 maximum edge/quality 80.
- The eventual browsing design is server-derived deterministic `v2` keys and temporary read-only thumbnail URLs, with no per-file whitelist, no per-object `HEAD` during normal browsing, and the existing one-time frontend fallback to the original. This is OUT OF SCOPE for C2b.
- Read the current checkout and live repository files as authoritative. Previously supplied reviewed snapshots may be older than the owner's current `master`. Do not assume the merge SHA.

## Hard constraints

- Before edits inspect `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, `AGENTS.md`, `.github/copilot-instructions.md`, source and tests. Do not commit on `master`, reset/stash user changes, or access untracked `.env.local` or other private files.
- DO NOT make live calls to Wasabi/AWS, request new permissions, run pilot/backfill/preflight/integration commands, build/run Docker with credentials or state, touch private checkpoint/audit/backup volumes, commit, push, merge, deploy, or change deployment workflows. Use synthetic fixtures and mocked providers only.
- Preserve Node.js 24, CommonJS, Express/route-service-storage separation, Serverless Framework, private source/derived objects, Entra authentication/authorization, internal-bucket hiding, dedicated credentials, stage isolation, and unchanged frontend/API contracts.
- Preserve **v1 Tokyo-only** PRD source (`ap-northeast-1`) without changing its existing runtime output, key identity, state schema, checkpoint/audit files, default recipe or processing controls.
- For **explicit `v2` only**, permit either Tokyo (`ap-northeast-1`) or Sydney (`ap-southeast-2`) PRD source. Destination remains pinned to private Singapore (`ap-southeast-1`) and must differ from source bucket. Do not generalize to all `SUPPORTED_WASABI_REGIONS` or enable PRD writes against TEST bucket names.
- Do not relax current required nonempty, slash-terminated source prefix, exact configured bucket/region/prefix matching, 10-examined-object cap, page-size limits, conditional `IfMatch` source GET and `IfNoneMatch: "*"` derived PUT, audit intent/outcome durability, fail-closed uncertain writes, lock path, or recipe-specific checkpoint/audit identity. State paths remain private and outside Git.
- Keep a single effective writer lock for the same mounted state HOME; separate volumes/machines do NOT share this lock. Do not create per-region or per-recipe lock paths.
- Do not alter the existing single-object TEST pilot, legacy bulk TEST driver, C1 image generation, CR2 processing, API signer, config of thumbnail serving, Serverless/GitHub Actions, dependencies, or frontend. No database, manifest, queue, or new cloud service.

## Focused C2b code task

1. Inspect `src/thumbnail/production-backfill.js` (including `loadProductionBackfillConfig`, `runProductionBackfill`, `parseArguments`, fingerprint/checkpoint/audit/lock logic), `src/storage/thumbnail-prd-backfill-wasabi.js`, `scripts/thumbnail-backfill-prd.js`, and `test/thumbnail-production-backfill.test.js`.
2. Bind source-region acceptance to the **validated recipe ID**, consistently in configuration loading, runner validation, and storage-adapter construction: `v1` only Tokyo; `v2` Tokyo or Sydney. Preserve all other production safety checks. An omitted recipe must continue to resolve to `v1`, so omitting `--recipe` with Sydney must FAIL CLOSED.
3. Prefer a minimal shared pure validation helper if it genuinely prevents policy drift, but do not refactor unrelated code. Unknown recipes, stage/bucket mismatches, arbitrary regions, destination-region changes and root/empty prefixes must continue to fail before any storage operation.
4. Preserve the identity payload exactly: `[formatVersion, sourceRegion, sourceBucket, completeSourceKey, normalizedETag]`. Do not trim keys, rehash by destination region, or modify the hash algorithm. `v2` Sydney and `v2` Tokyo must use distinct identities for the same other inputs.
5. Add focused synthetic tests proving the region/recipe matrix at all entrypoints; validations reject before client/network work or state writes; correct Sydney S3 endpoint is used for approved source operations, Singapore for derived; bounded dry-run is read-only; conditional operations, resume identity, audit/lock and all v1 regressions survive. Test more than one object/pagination and interruption/resume with injected mocks if available within the existing suite.
6. Make only narrowly necessary README/instruction changes. Clearly label any command as syntax-only and NOT authorized to run. Do not print private source identifiers or credentials.

## Validation and stop gate

- Use locked dependencies under Node.js 24: `node --version`, `npm test`, `git diff --check`, `git status --short`; report actual totals, skips, failures, and changed files. No live network/cloud operations.
- Report where all recipe/region guards are enforced and whether current TEST tooling genuinely exercises the production checkpoint/audit path (it currently does not). Distinguish a mocked test from a live multi-object TEST rehearsal.
- Stop. Leave changes uncommitted for independent review. The owner will authorize any PR/merge, TEST rehearsal and eventual production execution separately.

## Later gates (not this task)

- Determine whether a minimal TEST-safe, multi-object, production-equivalent backfill rehearsal is needed; do not bypass PRD stage/bucket guards or use production credentials for TEST.
- After explicit source/stage/prefix approvals, inventory the Sydney collection read-only; preserve baseline; backfill 100 in bounded batches with new private v2 state, verified derivatives and controlled recovery.
- Separately implement deterministic `v2` API signing with scope authorization and original fallback; benchmark before/after and expand source buckets. Automatic object-created generation, Photo Viewer and mobile-first work are future phases.

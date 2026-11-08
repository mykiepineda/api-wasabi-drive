# Wasabi Drive backend - Copilot instructions, Phase 8D-C2a

**Active task:** Add explicit immutable `v2` (C1) support to the existing **single-object TEST pilot**. This is an implementation-only task; no cloud use, deployment, or live processing is authorized.

## Owner decisions and known baseline

- The owner is the technical/architecture decision-maker; Copilot implements only focused approved work, and ChatGPT reviews the resulting source.
- Phase 8D-C1 (`v2` recipe) and C2 (`v2`-aware, resumable PRD backfill) are reported merged; `wasabi-drive-test.web.app` is owner-validated after C2. Independently inspect the local checkout; do not assume a particular live commit SHA.
- Approved immutable `v2` recipe: 200 x 190 pixels, centre crop, WebP quality 80, orientation-safe, no enlargement. Too-small sources/previews are skipped. Preserve `v1` unchanged and default wherever previously implicit.
- The approved **future serving approach** is deterministic backend-derived `v2` thumbnail keys and temporary signed URLs, without a per-file whitelist or manifest. The current React frontend already falls back to the original once on a thumbnail failure. These are **not** tasks for C2a.
- New ~100-photo source collection is in Wasabi Sydney `ap-southeast-2`; its bucket stage, exact prefix and production permissions have NOT been established in this code task. Do not read this collection or use it as TEST material.
- A separate later C2b task will consider source-region support for Sydney -> private Singapore `ap-southeast-1` in the **production** backfill; preserve the current Tokyo-only production region guard during C2a.

## Hard boundaries

- Inspect `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, `AGENTS.md`, current Copilot instructions and the relevant modules/tests first. Work on a focused branch from current master, never edit or commit directly to master. If unexpected modifications exist, report them rather than stashing/resetting them.
- Never open, print, stage, modify or commit private `.env*`, credentials, real filenames/key inventories, private Docker volumes, historical checkpoints/audits or backups. Ignore untracked `.env.local` without inspecting it.
- Do not call Wasabi/AWS, use Bruno integration tests, install/deploy infrastructure, run live pilot/backfill tools, commit, push, open PR, merge or deploy. Synthetic/mock tests under Node.js 24 only. If dependencies need installation, use `npm ci` with the locked versions, without modifying dependency versions.
- Preserve existing Node.js 24/CommonJS stack, Express authentication/authorization, private multi-region storage, internal-bucket hiding, signing identity, fallback, Docker safety, conditional `IfMatch` source reads and `IfNoneMatch: "*"` derived writes.
- Preserve test-stage isolation: TEST source and destination buckets must pass existing TEST-name guards, no PRD/production bucket acceptance, separate TEST credentials, Singapore private derived destination. Existing test CLI defaults and `v1` execution behavior must not change.
- No SNS/SQS, Lambda thumbnail worker, new database, configuration manifest, arbitrary image sizes/quality, unrelated refactors, region guard relaxation, or new production privileges.

## Approved C2a implementation

- Inspect `scripts/thumbnail-single-pilot.js`, `src/thumbnail/generate.js`, `src/thumbnail/transform.js`, `src/storage/thumbnail-wasabi.js`, `test/thumbnail-single-pilot.test.js`, `test/thumbnail-service.test.js` and README before editing.
- Add an OPTIONAL value flag `--recipe` to the existing `thumbnail:pilot` (single-object TEST) CLI, accepting only exact `v1` and `v2` recipe IDs, with omitted flag defaulting to existing `v1` behavior. Reject duplicates, unsupported IDs, missing values and unknown flags fail-closed.
- Pass the selected `recipeId` to `generateThumbnailForObject()` through the existing service interface. Reuse the deterministic key identity, fixed recipes and existing conditional source/read and derivative/write guards. Do not implement a new image-processing path or unconditionally write any key.
- Preserve dry-run default, existing two explicit TEST write confirmations, TEST environment/bucket checks and sanitized output. No changes to PRD runner, API signer, test bulk backfill, CloudFormation, Serverless or frontend.
- Add synthetic tests proving default `v1` behavior, explicit `v1`, successful `v2` recipe propagation and source-derived key, invalid flag rejection, no storage calls on invalid stage/scope, and unchanged dry-run vs execution confirmation. Preserve all earlier tests without weakening them.
- Update README narrowly to show `--recipe v2` as a future TEST pilot example clearly labelled **not authorized for live execution by this task**.

## Validation / deliverables

- Execute `node --version`, `npm test`, `git diff --check`, `git status --short` under Node.js 24 and report exact totals, skips and failures. No live network/cloud tools.
- Return a concise file-by-file change summary, security/compatibility review, expected TEST-only command syntax (without real bucket/object values), unresolved questions, and whether the branch is ready for independent review.
- Stop before committing or merging. The owner will approve the branch and later authorize TEST-only operations separately.

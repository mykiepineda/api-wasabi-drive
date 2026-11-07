# Copilot implementation prompt — Wasabi Drive Phase 8D-C1

You are implementing a small, **local-only backend source task** for Wasabi Drive. Read `.github/copilot-instructions.md` and `AGENTS.md` first; the human owner retains all architectural and deployment decisions.

## Preconditions (mandatory)

1. Run read-only `git branch --show-current`, `git status --short`, `git rev-parse HEAD`; report the results. The owner-approved implementation branch is `feature/thumbnail-recipe-v2`, based on the latest `master`. If a different task branch is checked out or user changes would be disturbed, STOP; do not switch, stash, reset, merge, or create branches autonomously.
2. Do not open, print, edit, or stage `.env.local`, any `.env` file with real credentials, private photo keys/objects, or audit/checkpoint volumes.
3. Inspect **actual checked-out** `src/thumbnail/key.js`, `src/thumbnail/eligibility.js`, `src/thumbnail/service.js`, `src/thumbnail/transform.js`, `src/thumbnail/generate.js`, relevant CR2 handling, and corresponding synthetic tests before editing. Also inspect the local prototype implementation if present, but do not cherry-pick or merge the experiment branch wholesale.
4. If functionality has already landed in the current source, explain the overlap and implement only demonstrably missing behavior.

## Approved change: immutable v2 C1 in generation library

Implement a fixed `v2` recipe with:

- Output format: WebP.
- Target: **200 x 190 pixels**.
- Resize: `cover`, **centre-positioned crop**, respect orientation before cropping.
- Quality: **80**.
- Preserve reasonable no-enlargement behavior. If a source (or extracted CR2 preview) cannot result in exactly 200 x 190 without upscaling, return a distinct ineligible/skipped outcome rather than silently enlarging or returning an off-size derivative. This is a provisional policy for review; report it, do not treat it as approval for live production handling.
- Preserve the `v1` recipe EXACTLY in behavior: 512px maximum edge, `inside`, quality 80, no enlargement; existing callers without a recipe selector still use `v1`.
- Use the existing `createThumbnailKey({ ..., formatVersion: 'v2' })` rather than reimplementing hashing. The key must remain based on source region, bucket, complete key, and current normalized ETag. No key guessing from filename alone.
- Support selection only between known immutable `v1` and `v2` recipe IDs in library code; reject unknown IDs/custom dimensions or quality instead of building a general image-processing framework.
- Reuse current standard-image / CR2 embedded-preview behavior and orientation safeguards. Do not expand supported formats or add new dependencies.
- Preserve source-size eligibility, predictable error outcomes, metadata stripping, and input immutability.

Use the minimum necessary files and abstractions. Adapt existing unit tests and add focused synthetic tests that prove version-specific keys, default `v1` parity, C1 dimensions, landscape/portrait, orientation, alpha if applicable, too-small inputs, corrupt bytes, CR2 where existing fixtures suffice, and invalid recipe selection. The outputs must be deterministic for the same source identity and version; do not demand byte-for-byte equivalence across unrelated Sharp versions.

## Explicitly out of scope

- No changes to `src/thumbnail/production-backfill.js`, existing TEST/PRD backfill CLIs, storage adapters/credentials, checkpoint or audit schema, Docker generation entrypoints, `serverless.yml`, deployment workflows or config activation.
- No change to `src/service/buckets.js`, `src/storage/thumbnail-api-wasabi.js`, user authentication, signed URL selection or existing `v1` allowlist. **Do not enable v2 thumbnail URLs yet.**
- No frontend modifications. The latest supplied `File.jsx` already attempts the original `AccessUrl` once when a thumbnail request fails.
- No Wasabi/AWS access, provider `HEAD`, test integration requests, Docker production runs, commits, pushes, merges or deployments. No operations on real photo objects or private state.
- Do not change dependencies or run `npm audit fix` as part of this task.

## Verification and output

On Node.js 24, run local tests using the existing lockfile (`npm ci` only if dependencies are absent), `npm test`, and `git diff --check`. Run any additional narrow synthetic tests if helpful. Report exact commands and results, list changed files and any deviations, and state whether the existing `v1` behavior remains intact.

Explain the remaining blockers before owner-authorized C1 generation: recipe-aware resumable state and writer validation; approved source scope/region and destination; dedicated TEST validation; and later deterministic v2 API signing with strict bucket/stage boundaries. Do not implement those steps now.

**Stop with uncommitted changes for independent owner/ChatGPT review.**

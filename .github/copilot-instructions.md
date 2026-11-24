# Wasabi Drive backend - GitHub Copilot instructions (Phase 8D-D, Task 1B corrections)

**Active task:** fix opt-in production v2 preflight prefix/root selection and credential segregation; complete truthful, sanitized backfill CLI diagnostics. Base all edits on the current checked-out source (owner supplied `master (52)`; archive records commit `4defb81471e0edadb85e9ca1f7c2e492a7c475b9`). **Do not implement Task 2 or activate expanded PRD enrollment.**

## Authority, Git and workflow

- The owner makes architecture, security and deployment decisions. ChatGPT performs independent analysis and review; Copilot/Codex implements the explicitly approved bounded task.
- Read `AGENTS.md`, this file, the approved Phase 8D-D handoff (revision 2026-11-23.2), relevant tests, and the latest checkout before editing. The archive SHA is a reference only; verify actual local HEAD.
- The `master` GitHub ruleset was recently found disabled and has now been reactivated. Never commit, push or edit on `master`. Work ONLY on the owner-created `fix/v2-preflight-scope-and-diagnostics` branch from current `master`. Run `git branch --show-current`, `git status -sb`, `git branch -vv` and `git rev-parse HEAD` before changes. If the branch or worktree is unexpected, STOP.
- Leave all edits uncommitted. Do not push, merge, create PRs or deploy. Preserve unrelated files and existing uncommitted work.
- Do not access live AWS/Wasabi, run metadata-only live preflight, production backfill, Docker campaign, Bruno integration, or policy operations. Do not touch private checkpoint/audit/backup files, print secrets or inspect personal data. Use synthetic tests and mocks.
- Run Node.js 24 `npm test`, `git diff --check`, and relevant `node --check` locally. Preserve all tests and report actual results; do not weaken assertions to make them pass.

## Architecture and immutable safeguards

- Retain React/Firebase, Node.js 24, Express 4/CommonJS, API Gateway REST, Lambda, Serverless Framework v4 and Wasabi storage. Preserve HTTP/CLI entry -> application/service -> storage adapter -> Wasabi/AWS SDK separation, TEST/PRD isolation, Microsoft Entra authentication, backend trusted-user authorization, private buckets and fixed destinations.
- Sydney's 100 accepted v2 derivatives and Tokyo's 13-photo v1 pilot are completed history. Do not regenerate them, alter image recipes or deterministic key identity, or touch production durable evidence.
- V2 recipe remains WebP 200 x 190, center-crop, quality 80, stripped metadata, no enlargement, 25 MiB source cap. Preserve v1 precedence for its approved pilot keys and original `AccessUrl`/thumbnail fallback. No per-file thumbnail catalog or browser existence HEAD requests.
- Backfill remains ten examined objects maximum per invocation and page limit ten, with strict bounded lists, source-identity-bound derived keys, source read-only access, `IfNoneMatch: "*"` derived writes, private checkpoints and append-only durable audit, conservative unknown-write detection, shared writer lock and no state resets. Do not introduce automatic retries.
- Task 1B's multi-bucket enrollment is a **transitional explicit PRD allowlist**. Never grant access implicitly to new buckets, internal buckets or TEST resources. Future automatic thumbnail lifecycle and auto-discovery are separate design/approval work.

## Active changes - only these

1. In **opt-in v2** preflight, non-root prefixes must be nonempty literal folder prefixes ending in `/`. Root means exactly empty prefix with explicit `wholeBucket === true`. Require this both in scope validation and the storage adapter. Reject partial-lexical overlaps such as `photos` matching `photos-old/`, and all implicit or malformed whole-bucket selection. Preserve v1 and legacy v2 behavior when opt-in is absent.
2. Apply dedicated `THUMBNAIL_PRD_PREFLIGHT_*` credential reuse prevention in BOTH legacy and opted-in v2 modes, comparing access key and secret independently with any configured API, TEST, AWS and `THUMBNAIL_PRD_BACKFILL_*` values. Error messages and tests use no real secrets. This does not replace review of effective read-only Wasabi policy.
3. In `scripts/thumbnail-backfill-prd.js` (and minimally the backfill runner if required), report ONLY allowlisted, evidence-backed diagnostic codes for config/scope/known state/write/provider failures. Unknowns remain generic failures. No raw error, path, object name, secret, audit record or provider body in CLI output; no change to execution, retry, lock or write semantics.
4. Update task instructions and narrowly relevant README/test documentation. No unrelated style cleanup, framework upgrade, new cloud service, schema overhaul, campaign coordinator, increased caps, policy changes or deployments.

## Files and tests to focus on

Inspect `src/thumbnail/preflight-scope.js`, `src/thumbnail/production-preflight.js`, `src/storage/thumbnail-preflight-wasabi.js`, `scripts/thumbnail-production-preflight.js`, `scripts/thumbnail-backfill-prd.js`, the error-handling segment of `src/thumbnail/production-backfill.js`, and focused tests under `test/thumbnail-production-preflight.test.js` and `test/thumbnail-production-backfill.test.js`.

Cover valid/invalid opt-in folder and explicit root scopes, direct adapter bypass attempts, bucket-region exclusions, both config modes' credential reuse checks, unchanged legacy behavior and strict sanitized failure summaries. Run full regression and inspect the diff. Leave changes uncommitted for owner review.

## Stop and report

Stop if the solution would change effective permissions, secret distribution, live storage calls, checkpoint/audit contents or ordering, retry semantics, production deployment, or Task 2 scope. Report the exact modified files, test results, limitations and anything needing architectural approval.

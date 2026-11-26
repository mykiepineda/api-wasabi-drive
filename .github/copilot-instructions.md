# Wasabi Drive backend — GitHub Copilot instructions (Phase 8D-D Task 2B)

## Authority and baseline

Follow `AGENTS.md` first. The owner controls architecture, permissions, Git integration and production operations. Preserve Node.js 24, CommonJS, the existing Express/Lambda/Serverless deployment, Wasabi S3-compatible storage, and route/service/storage boundaries. Prefer the smallest incremental change over new infrastructure or abstractions. The authoritative source is the owner's current locally checked-out, protected-`master`-derived feature branch; the last externally reviewed Task 2A.2 ZIP predates its README update and merge.

**Current task:** Task 2B — one local, explicitly approved v2 backfill campaign, sequential 1–250-object invocations, operator stop/resume, independent private job state and strict failure/no-progress gates. Task 2A.2's v2 cap is already merged and TEST-validated. Do **not** implement the follow-on cloud-based Automated Thumbnail Lifecycle in this branch.

## Branch and coding agent

- Work only on `feature/v2-backfill-campaign-continuation`, created by the owner from the updated `origin/master`. Check current branch, HEAD, ancestry and worktree before editing; protect unrelated existing changes. Never edit `master`.
- Use VS Code Copilot **Interactive + Assisted**. Approve local file edits and offline tests as necessary; respect denied tool calls. Do not auto-approve broad terminal, Docker or cloud tools.
- Agent may edit only narrowly relevant CLI, coordinator, shared backfill state handling, tests and documentation. Do not commit, push, create PRs, merge, deploy, run integration tests, contact AWS/Wasabi or access real Docker production state. Owner manually exports feature-branch ZIP for ChatGPT review.

## Invariants that must survive

- **Gate 0:** Test real CLI-shaped v2 checkpoint creation and resume with runtime-only scope fields. The existing checkpoint reader expects an exact five-field persisted scope; correct any verified serialization mismatch without changing v1/v2 format versions, fingerprints or old checkpoint compatibility. Stop if a migration is needed.
- v1 cap stays 10 and its recipe/serving remain unchanged; v2 cap stays 250, listing-page cap stays 10 and default is 5. No unbounded batch or parallel workers.
- Strict PRD source enrollment by exact `{bucket, region}`, protected bucket exclusions, explicit prefix or `wholeBucket: true`, fixed private derived destination, and separate dedicated credentials. The campaign plan is an operator-selected job schedule, **not** a new permission authority.
- Preserve ETag-bound v2 deterministic WebP keys, 200 x 190 centre crop, quality 80, source size/eligibility checks, read-only source access, separate API thumbnail-read identity, derived existence checks and `IfNoneMatch: "*"` writes.
- Preserve append-only intent/outcome audit, private path validation, per-record `fsync`, checkpoint file/directory sync, unknown-write fail-closed handling, shared persistent writer lock on `/state`, and exact stage/recipe/job state isolation. Do not rewrite/delete existing Sydney checkpoints or audits.
- Distinguish `paused-cap` from true `completed`; validate cursor advancement on every continued slice. Stop on any failure or ambiguous outcome, invalid state, lock contention/loss, backup failure, no progress or finite budget exhaustion. Never bypass errors by creating new checkpoints.
- A resumed lexical cursor is **not** a catch-up scan. Later uploads that sort before the old cursor require a new job/scan identity and new private state. Existing v2 derivatives are skipped; old v1 thumbnails remain intact and v1-first API serving is unchanged.

## Code boundaries and validation

Implement the coordinator as a small, testable local CommonJS entry point reusing existing production backfill CLI/service/storage instead of duplicating image processing or adding services, databases, queues or dependencies. The default plan operation must not contact the provider. Use an unambiguous paired campaign execution confirmation for any future live run; **this task is code-only and grants no live authorization**. Keep summary output aggregate and sanitized.

Add mocked/offline tests for real scope checkpoint compatibility, strict private plan validation, sequential batch/job transitions, fresh Sydney catch-up, original v1-scope v2 generation, existing-derivative skips, stop/resume, failed/unknown state, no progress, finite limits and no sensitive output. Preserve current tests; run Node.js 24 `npm test`, `node --check` and `git diff --check`, with synthetic benchmark where feasible. Stop if an unsafe state migration, policy expansion or cloud access would be required.

Leave changes uncommitted for owner review. The owner commits and pushes feature branch only after local review; a protected-`master` PR and TEST validation precede any separate PRD operational approval.

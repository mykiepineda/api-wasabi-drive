# Wasabi Drive backend - Copilot instructions (Phase 8D-D Task 2A.2)

## Authority and engineering boundaries

The owner is the architectural and security decision-maker. Follow `AGENTS.md` as the general repository authority, and use this file for the current task. Keep the existing Node.js 24, Express 4, CommonJS, AWS Lambda/API Gateway REST, Serverless Framework and Wasabi S3-compatible storage design. Preserve the HTTP/CLI -> service -> storage separation. Avoid unrelated cleanup, new services, new dependencies and redesigns.

**Current task:** Phase 8D-D Task 2A.2, a local-only increase of the production backfill **v2 examined-object cap from 10 to 250 per invocation**, with v1 remaining at 10 and source-listing pages remaining at at most 10. Task 2A.1's optimized audit parser is already approved, merged and TEST-validated. This task is NOT the automatic campaign coordinator (Task 2B).

## Git and coding-agent operation

- The owner creates `feature/v2-backfill-v2-250-cap` from current `origin/master`. Before editing, inspect branch, worktree, HEAD, and relevant code. Never work on `master`. Treat only the owner's intentional instructions-file change as expected; do not overwrite any unexpected uncommitted work.
- Use VS Code **Interactive + Assisted** permissions. The agent may inspect repository files, edit only in-scope code/docs/tests, run offline Node.js tests and synthetic benchmarks. Ask for ordinary tool approvals in VS Code; respect denials and do not bypass tool restrictions.
- The agent must NOT commit, push, merge, open PRs, deploy, change credentials or policies, contact AWS/Wasabi, execute a live backfill/integration test, mount or alter any production Docker volume, or modify historical Sydney checkpoint/audit files.
- The owner manually commits/pushes the feature branch, creates a Draft PR, and transfers the branch ZIP with test results for independent ChatGPT review. Merge only after review and required GitHub PR checks; `master` is protected.

## Non-negotiable storage and state safeguards

- Preserve Sydney v2 completion and the legacy Tokyo v1 pilot; no source or derived object mutation in this task.
- Keep v2 WebP 200 x 190 center crop, quality 80, metadata stripped, no enlargement, source eligibility and 25 MiB source-size limit; v1 recipe, key format and v1-first URL precedence remain unchanged.
- Retain exact approved source bucket/region enrollment, protected bucket exclusions, literal slash-terminated prefixes, explicit `--whole-bucket` for root selection, fixed derived destination, separate dedicated credentials and source read-only behavior.
- Retain ETag-bound deterministic derived keys, `IfNoneMatch: "*"` conditional writes, existence checks and no-overwrite behavior.
- Keep checkpoint/audit versions, processing fingerprints and filenames compatible; append-only write intent then outcome, per-record `fsync`, directory sync, corruption detection, unknown outcome fail-closed behavior, private state validation and shared writer lock unchanged.
- Do not treat a completed lexical checkpoint as a full synchronization of future uploads. Do not change scan resumption semantics or add Task 2B continuation.

## Task 2A.2 precise change boundaries

1. Inspect `src/thumbnail/production-backfill.js` and `scripts/thumbnail-backfill-prd.js` for all bounds, including the CLI `safeSummary`. Make recipe-aware caps consistent: v1 max 10 (including the default recipe), v2 max 250. Prefer one small shared source of truth; do not add environment configuration or a generic limits framework.
2. Preserve the default listing page size of 5 and the storage adapter's hard maximum of 10 keys per listing request. The runner must never ask for more than the smaller of page size or remaining examined-object allowance.
3. Keep `--max-objects` mandatory, integer, bounded and deliberately operator-selected. Preserve existing CLI confirmations and summary field allowlist. A valid 250-object v2 summary must not be rejected as unsafe; invalid, excessive or contradictory summaries must still fail closed without private identifiers.
4. Add focused offline tests for v1=10/v2=250 boundaries, 251 rejection, validation before storage calls, multi-page progression, cap-paused vs completed, cursor resumption, mixed eligible/ineligible/already-present results, corrupt/unknown state and nonzero sanitized failures. Keep tests and status semantics truthful. Do not weaken existing tests.
5. Update ONLY the relevant README/backfill runbook limit descriptions; do not change the actual PRD permissions worksheet, deployment wiring or preflight limits (the latter intentionally have different bounds).
6. Run Node.js 24 focused tests, `npm test`, `node --check` of changed JavaScript, `git diff --check`, and the existing offline synthetic audit benchmark. Summarize results and remaining Docker-volume performance limitation.

## Stop and escalation conditions

Stop if branch/worktree status is unexpected, any security or durability invariant cannot be preserved, a state format or fingerprint migration becomes necessary, there is a requirement to access production state or cloud services, or tool permission is denied. Report the precise blocker without inventing a workaround. No production usage of the 250 limit is approved by this coding task.

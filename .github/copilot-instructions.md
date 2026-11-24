# Wasabi Drive backend — Copilot instructions (Phase 8D-D Task 2A)

## Authority and project boundaries

The owner is the architectural/security decision-maker. ChatGPT performs independent analysis and review; Copilot implements only the owner-approved task. Read and follow repository `AGENTS.md` first. It remains the general engineering and security authority. Preserve the current backend stack (Node.js 24, Express 4, CommonJS, AWS Lambda/API Gateway REST, Serverless Framework, Wasabi S3-compatible storage), stage isolation and HTTP/CLI -> service -> storage structure. No unrelated improvements, frameworks or cloud services.

**Active Task 2A:** bounded *v2* production backfill capacity plus offline audit-performance characterization. Use the current checked-out `master`-derived feature branch and the separate `Phase-8D-D-Task-2A-Copilot-Agent-Prompt.md`. The latest Task 1B corrective PR is reported merged and TEST-validated; do not rely on an older archive SHA as proof of the current checkout.

## Git and Agent operating mode

- Owner creates `feature/v2-backfill-bounded-batches` from up-to-date `master` before giving the prompt to the Agent. Verify branch and worktree read-only before editing; stop if unexpected. NEVER work on `master`.
- In VS Code, use **Interactive + Assisted** permissions. The Agent may read ordinary repository source, make approved local edits and run local synthetic tests. Ask approval for installing dependencies; do not bypass any tool-denied effect. Keep terminal permissions specific rather than `Allow All`.
- The Agent must NOT commit, push, merge, create a PR, deploy, change credentials/policies, execute a live backfill, call Wasabi/AWS, run live integration tests, mount production state, or alter Docker production volumes. Do not expose secrets or private filenames.
- Owner manually commits/pushes feature changes, creates a Draft PR and transfers feature-branch ZIP and test summary to ChatGPT for independent review. Merge only after review/required PR checks; protect `master`.

## Immutable data, recipe and security contracts

- Preserve completed Sydney v2 collection and legacy Tokyo v1 pilot; do not reprocess them.
- v2 recipe remains WebP 200×190 center-crop, quality 80, metadata stripped, no enlargement; source eligibility and 25 MiB limit unchanged.
- Keep v1 precedence where applicable, deterministic keys and ETag binding; fixed private derived bucket and namespace, dedicated least-privilege backfill identity, separate API reader, Wasabi source read-only, and `IfNoneMatch: "*"` on derived writes.
- Keep Task 1B's explicit approved bucket/region enrollment, literal slash-terminated prefixes, deliberate `--whole-bucket` selection and separate preflight credentials. Do not expand enrollment or production permissions.
- Keep checkpoint/audit format/version/fingerprint compatibility, append-only durable intent then outcome order, directory sync, strict corruption detection, unknown-write fail-closed behavior, shared writer lock and private state. Local durable records and remote writes are not one atomic transaction.

## Task 2A code and tests

1. **First benchmark** synthetic audit histories; existing append revalidates the whole journal. If observed cost is unsafe for 250 examined objects, report evidence and stop instead of weakening journal validation or changing the format.
2. If measurements support it, implement explicit v2-only `maxObjects` cap **250**, retaining v1 cap **10** and maximum listing page size **10**. Update *both* runner and CLI summary validation. Treat `examined` (not generated count) as the cap.
3. Test multi-page processing, cap boundaries, honest completion, restart with the same state, invalid input, invalid/unknown audit, lock loss, unknown writes and sanitized output. Preserve all existing tests.
4. Run local Node.js 24 `npm test`, targeted tests, `git diff --check`, and report relevant offline benchmark results. No live Wasabi operations, including metadata-only dry runs.
5. This task does **not** introduce a campaign coordinator or multi-bucket execution loop; those are separately reviewed Task 2B changes.

## Stop conditions

Stop and report unexpected branch/worktree state, blocked tools, evidence that the performance goal cannot be reached safely, a required change to durability/fingerprints/state format or source permissions, or any need to deploy or access external systems. Do not broaden scope to make tests pass.

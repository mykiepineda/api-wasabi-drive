# Wasabi Drive backend — Copilot instructions (Phase 8D-D Task 2A.1)

## Authority and project boundaries

The owner is the architectural/security decision-maker. ChatGPT performs independent analysis and review; Copilot implements only the owner-approved task. Read and follow repository `AGENTS.md` first. It remains the general engineering and security authority. Preserve the current backend stack (Node.js 24, Express 4, CommonJS, AWS Lambda/API Gateway REST, Serverless Framework, Wasabi S3-compatible storage), stage isolation and HTTP/CLI -> service -> storage structure. No unrelated improvements, frameworks or cloud services.

**Active Task 2A.1:** local-only, synthetic audit parser scalability investigation. The previous 250-object benchmark exposed substantial cost, so the v2 cap remains 10. The newly approved scope is a minimal equivalent parser optimization and regression/benchmark evidence; raising caps and campaign coordination are NOT authorized. Use `Task-2A-Audit-Parser-Scalability-Copilot-Agent-Prompt.md`.

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

## Task 2A.1 code and tests

1. Inspect existing synthetic benchmark and expensive repeated `Map` scans in `parseAuditRecords`. Keep `appendAuditRecord` validating the complete existing journal before each append, with per-record `fsync` and all path/inode/lock protections.
2. If possible, implement only an equivalent linear-pass audit parser improvement; preserve all existing v1/v2 accepted and rejected records, including unknown/pending-intent fail-closed cases, journal boundaries, versions and corruption detection.
3. Add focused synthetic tests for journal semantics and compatibility. Rebenchmark with repeated comparable runs; report host filesystem limitations. Do not weaken tests or claim guaranteed performance based on one local trial.
4. **Do not raise either recipe cap** or change the ten-object listing-page limit. The cap decision will follow independent review of evidence.
5. Run local Node.js 24 `npm test`, focused tests, `node --check`, `git diff --check`, and report files, results and outstanding risks. No live Wasabi operations or production state volume.

## Stop conditions

Stop and report unexpected branch/worktree state, blocked tools, evidence that equivalence or durability cannot be preserved, a required change to fingerprints/state formats or source permissions, or any need to deploy or access external systems. Do not broaden scope to make tests pass.

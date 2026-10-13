# Wasabi Drive Backend - GitHub Copilot Instructions

## Ownership and delivery controls

Wasabi Drive is the owner's working personal application and a cloud engineering learning project. The owner makes architectural decisions. Inspect the current source and task prompt before modifying code. Do not commit, push, create a pull request, deploy, provision resources, change IAM policies, or execute live Wasabi operations unless the owner explicitly requests that action. Work on a focused branch from protected `master`. Keep unrelated changes out of the diff.

**Current authoritative baseline:** backend `master` after Phase 8C-B1 was merged and successfully deployed to `test` and `prd`. B1's TEST-only live pilot was subsequently validated: a source in Wasabi Sydney (`ap-southeast-2`), a private derived bucket in Singapore (`ap-southeast-1`), a generated WebP, and an identical rerun returning `already-present`. The owner confirmed anonymous access to the derived file was denied and the source read policy was scoped to the disposable `pilot/*` objects.

**Active task: Phase 8C-B2-A - bounded, resumable, local TEST thumbnail backfill.** B2-A extends B1 to process a very small explicitly selected TEST prefix using ONE local writer. It is not authorization to process any personal/family bucket, run a production backfill, add automation, or deploy a thumbnail worker.

## Architecture to preserve

- Node.js 24, CommonJS, Express 4, API Gateway REST API, AWS Lambda, Serverless Framework v4, AWS SDK for JavaScript v3, private Wasabi S3-compatible storage.
- The deployed React/Firebase client authenticates through MSAL/Microsoft Entra. The Express backend validates access tokens and authorizes trusted users. Browser state and API keys are not authorization.
- Preserve HTTP route -> service/application -> infrastructure/storage -> AWS SDK -> Wasabi. Keep Lambda app construction separate from local startup.
- `src/app.js`, `src/api/*`, `src/service/buckets.js`, `src/storage/wasabi.js`, `src/config/index.js`, and the `AccessUrl` original-object behavior are production-critical. Do not refactor them for B2-A.
- `src/thumbnail/key.js` creates versioned deterministic WebP keys from the ORIGINAL source's region/bucket/full key/normalized ETag. Never change the v1 key contract.
- `src/thumbnail/eligibility.js` is the authoritative format policy: standard JPG/JPEG/JFIF/PNG/WebP and CR2 preview are eligible; NEF and HEIC/HEIF remain out of scope. The A1 inventory's wider diagnostic extension list is NOT the processing policy.
- `src/thumbnail/service.js`, `cr2.js`, and `transform.js` implement the reviewed 512-pixel, quality-80 WebP recipe and CR2 orientation. Reuse them unchanged where possible.
- `src/thumbnail/generate.js` is the validated one-object orchestrator: source HEAD/ETag, eligibility and size limit, derived HEAD, conditional source GET (`IfMatch`), in-memory transform, conditional derived PUT (`IfNoneMatch: "*"`). Reuse it rather than duplicating generation logic.
- `src/storage/thumbnail-wasabi.js` is the isolated B1 storage adapter using separate regional clients and dedicated TEST credentials. Add a narrowly scoped list-page operation there for B2-A; do NOT reuse the production `src/storage/wasabi.js` adapter because it uses API credentials and runtime configuration.
- `src/thumbnail/inventory.js` and `scripts/inventory-images.js` are read-only evidence tools. Reuse ideas for paginated metadata listing, but not their production-credential path.
- `src/thumbnail/index.js` and the Express import graph must remain lightweight; neither should eagerly load Sharp, RAW extraction, or any thumbnail backfill/write module.
- The API's Lambda packaging and workflows are unchanged. Sharp and `extract-raw-preview` remain devDependencies for local processing; Linux Lambda compatibility is a separate future task.

## Provider-specific findings - do not regress

- TEST source conditional `GetObject IfMatch` passed against Wasabi Sydney.
- **Wasabi Sydney `PutObject IfNoneMatch: "*"` remains unsafe for this project:** sequential requests overwrote an existing object in the owner's direct retest. In Case 00307622, Wasabi Support confirmed a staged conditional-write fix is deployed in Singapore but **not yet fully across Sydney endpoints**, and asked for later follow-up. Do not infer Sydney is fixed until owner revalidation succeeds.
- Amazon S3 correctly rejected the comparison overwrite; Wasabi `us-east-1` was reported working by Support.
- **A TEST derived bucket physically created in Singapore (`ap-southeast-1`) passed:** its second conditional PUT returned `PreconditionFailed`, and SHA-256 verification confirmed the first object's bytes remained intact. B1 real TEST thumbnail generation and rerun also succeeded against that bucket.
- B2-A live execution is permitted ONLY with the approved TEST destination configured as `ap-southeast-1`. Do not select Sydney as the derived write region or weaken `IfNoneMatch`, the source `IfMatch`, or destination HEAD behavior. Do not implement the cancelled B1-R non-atomic workaround.
- Provider behavior may vary by region; these TEST results are not a blanket guarantee for other Wasabi regions or future production deployment.

## Scope and safety for B2-A

1. The source must be the configured isolated TEST source bucket, and object discovery must be explicitly limited to `pilot/` or a narrower sub-prefix. The derived destination must be the configured private TEST bucket in Singapore. Do not accept arbitrary destination/stage overrides, account-level enumeration, or source bucket names without a distinct `test` segment. Reject production-looking names and non-TEST stages as B1 does.
2. A local CLI is dry-run by default: metadata listing and derived HEAD checks are allowed; **no source-body GET or derived PUT** unless both `--execute` and a distinct `--confirm-test-backfill` flag are present. Cap every run at a small, explicit number of inspected objects (e.g. maximum 10 for B2-A); reject invalid/zero/negative/unbounded limits. A single run processes sequentially with no parallelism.
3. Preserve B1's 25 MiB source buffer/stream cap and fail closed on ETag mismatch or unsafe provider errors. Distinguish already-present, unsupported formats, known oversize objects, and unexpected failures in sanitized counts. Do not mutate, delete, copy, retag, or write to any source object.
4. Add isolated, TEST-credential-based `ListObjectsV2` metadata listing (`Prefix`, bounded `MaxKeys`, and an explicit safe resume scheme). Do not use `Delimiter`, since nested photo folders must be discovered. `s3:ListBucket` will have to be granted only on the approved TEST source bucket and prefix by the owner; Copilot must not change cloud permissions.
5. **Resume must be crash-safe and cannot silently lose failed objects.** Prefer a local checkpoint of the last fully processed object key with `StartAfter` on resume, so a crash after the PUT but before checkpointing causes a safe idempotent retry. Validate strictly increasing listing keys and verify Wasabi's `StartAfter` behavior on disposable TEST data before any live batch. If not demonstrably supported, stop and report instead of making progress guarantees. Treat listing as a moving view, not a point-in-time snapshot; fresh/changed earlier keys need a later intentional rescan.
6. Persist checkpoint atomically after each terminal per-object result. Do not advance past a transient or ambiguous failure, precondition error, ETag mismatch, incomplete metadata on an eligible object, or a failed checkpoint write; stop the run with a nonzero exit status. A corrupt, unexpected, or mismatched-scope checkpoint must fail closed. The checkpoint must bind to source bucket/region/prefix and destination bucket/region and be kept outside the Git repository; it contains potentially private source keys.
7. For local single-writer safety, use an exclusive run lock for live execution; never silently take over a stale lock. Document manual recovery only after the owner confirms no run is active. Do not introduce a database, queue, distributed lock, third-party service, or concurrency framework.
8. Keep CLI output to aggregate sanitized counts/categories/exit status. No object keys, filenames, bucket names, ETags, credentials, paths, presigned URLs, exception stacks, personal metadata, or checkpoint contents in logs, tests, README evidence, or commits. No live operations in tests.
9. Unit-test paging, `StartAfter`/order validation, resume mid-batch and after crash, scope mismatch/corruption, safe dry-run, existing-thumbnail skip, terminal unsupported/oversize handling, transient failure stop, CLI flags/stage guards, locks, checkpoint atomicity/failure, and API import isolation. Tests should use injected mocked Wasabi clients and temporary local files only.
10. Preserve tests and keep the change proportional. B2-A must not change existing APIs, authorization, Serverless deployment, GitHub Actions, frontend, thumbnails key/transform, source region discovery, or dependency versions without owner approval.

## B2-A operational reliability acceptance gates

- Await completion of each eligible object's asynchronous thumbnail generation before incrementing result counters, processing the next key, or updating the checkpoint. Unknown/rejected/ambiguous results fail closed with no checkpoint advancement.
- Keep local checkpoints **outside the actual Git repository root**. Exclusive locking must work on first use of an external path, reject a competing writer, and never silently clear stale locks.
- B2-A must have dedicated automated tests covering deferred promises, safe sequential processing, counts, pagination/resume, lock/atomic checkpoint lifecycle, TEST-only CLI flags, sanitized output, and list adapter scoping; existing B1 tests alone are insufficient.
- The B1 `thumbnail:pilot` first-write command has intermittently returned without final JSON despite creating a private thumbnail. This remains a separate unresolved lifecycle/acknowledgement question; investigate using a focused B1 fix branch from `master`. B2-A must not claim a successful write or advance its checkpoint on an unconfirmed outcome.

## Validation and handoff

Run Node 24 `npm test`, targeted B2 and B1 tests, `git diff --check`, `git status --short`, and `git diff --stat`. Verify API import isolation and absence of source Put/Delete/Copy operations. Document necessary **manual** IAM adjustments (scoped source `s3:ListBucket` for `pilot/`) and owner-run, sanitized dry-run and TEST-batch commands; do NOT configure IAM or run those commands against Wasabi as part of implementation.

No code commits, pushes, PRs, deployments, AWS/Wasabi resource creation, or live object operations by Copilot. Stop with an implementation report for architectural/code review.

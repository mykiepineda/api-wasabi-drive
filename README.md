# Wasabi Drive API

Backend API for browsing Wasabi Drive buckets and generating temporary object access URLs.

## Health endpoint

`GET /health` returns HTTP 200 with the fixed body `{ "status": "ok" }`. It is intentionally unauthenticated and shallow; it does not probe Wasabi, Entra, or other dependencies.

## Bucket API errors and object listing

`MaxKeys` is optional on object-list requests. When supplied, it must contain only decimal digits and resolve to an integer from 1 through 1000; leading zeroes are accepted. Invalid values return HTTP 400 with `{ "error": "MaxKeys must be an integer between 1 and 1000." }`.

The API returns fixed JSON errors: 401 `Unauthorized`, 403 `Forbidden`, 500 `Internal Server Error`, and 502 `Bad Gateway` for recognized storage-provider or transport failures. Request parsing retains safe 400, 413, and 415 responses. Provider details are not returned to clients.

The Bruno regression request `buckets/invalid-max-keys.bru` checks the invalid `MaxKeys=0` response without modifying storage.

## Wasabi regions

`WASABI_SERVICE_URL` and `WASABI_REGION` configure the bootstrap/default S3 client. It uses those settings for account-level bucket listing and initial bucket-region discovery. They are not a guarantee that every bucket is in the same region, and separate environment variables per bucket or region are not needed.

Bucket-specific operations resolve the bucket's region with `GetBucketLocation`. If Wasabi returns a recognized `307 TemporaryRedirect`, the API validates the bucket's Wasabi endpoint and creates a regional client using the canonical endpoint `https://s3.<region>.wasabisys.com`. Region and client information is cached in process memory, so a cold start may repeat discovery. Presigned object URLs are signed by the bucket's regional client and remain valid for one hour.

Regional clients use the configured `WASABI_ACCESS_KEY_ID` and `WASABI_SECRET_ACCESS_KEY` credentials. An empty `GetBucketLocation` location constraint represents `us-east-1`; the legacy `EU` constraint represents `eu-west-1`.

## Backend deployment

Pull requests to `master` run backend CI. After a change is merged to `master`, GitHub Actions automatically deploys the backend to the `test` stage. Validate the deployed change in `test` before promoting it to production.

After deployment, the test workflow automatically runs the non-destructive deployment smoke checks: `/health` returns 200 and unauthenticated `/buckets/` returns 401. Production promotion runs the same checks after deployment. The full authenticated Bruno regression remains a manual gate against `test`; its scope is blocked from `prd`.

To manually redeploy the current `master` to TEST and apply previously configured TEST Environment variables or secrets, open **Actions** → **Backend Test Deployment** → **Run workflow**, select `master` in the branch selector, then choose **Run workflow**. The workflow runs its tests, deploys using the protected `test` Environment, and performs the deployment smoke checks. A dispatch from any branch other than `master` cannot deploy. Merging this workflow change to `master` will itself trigger the existing automatic TEST deployment, so keep `THUMBNAIL_API_V2_ENABLED=false` until the owner separately approves v2. Preserve each stage's existing approved `THUMBNAIL_API_ENABLED` value; do not change v1 enablement as part of the v2 rollout.

To roll back TEST thumbnail enrichment, set `THUMBNAIL_API_ENABLED=false` in the protected `test` Environment and manually run **Backend Test Deployment** again from `master`. Preserve `WASABI_INTERNAL_BUCKETS` protection.

Production promotion is manual through the **Backend Production Promotion** workflow. Start it from `master` and provide the exact full 40-character commit SHA that was deployed to and validated in `test`. The workflow verifies that the commit belongs to `master`, checks out that exact commit, and runs `npm ci` and `npm test` before deployment. The GitHub Environment `prd` is the production protection boundary and can require approval.

GitHub OIDC and AWS STS provide short-lived AWS deployment credentials. No permanent AWS deployment access keys are stored in GitHub. The production workflow runs the existing `npm run deploy:prd` command; production configuration is supplied through the protected `prd` environment.

To roll back, identify a known-good commit on `master` and rerun **Backend Production Promotion** with that exact full SHA. The workflow performs the same validation and tests before redeploying that source to production.

Rollback to a commit predating the health/deployment-smoke capability may successfully redeploy the older application but fail the current workflow's post-deployment smoke step because that source does not expose `/health` or support the `deployment-smoke` scope. In that case, verify the rollback manually. After this capability has been production-validated, prefer a known-good SHA that includes it.

## Phase 8C-D1 — Scoped private thumbnail URLs

The backend can optionally add `ThumbnailAccessUrl` to authorized object-list results for exact, approved v1 derivative keys. The existing original `AccessUrl`, pagination, and object metadata remain unchanged. Enrichment is disabled by default; this implementation does not enable production access or perform thumbnail existence checks.

Configure each protected GitHub Environment (`test` and `prd`) independently. `WASABI_INTERNAL_BUCKETS` is required as a nonempty exact bucket-name list for every deployed stage, even while thumbnail enrichment is disabled; it filters those buckets from bucket results and blocks direct region/object browsing. The deployment workflow validates centralized configuration locally before Serverless runs. Local/mock operation without `DEPLOYMENT_STAGE` may omit the internal list, but must not be treated as a deployment configuration.

When explicitly enabled, provide the environment's source bucket, source region, slash-terminated private prefix, derived bucket, Singapore derived region (`ap-southeast-1`), exact verified allowlist (up to 13 v1 keys), dedicated read access-key pair, and URL lifetime. PRD source scope is Tokyo (`ap-northeast-1`); TEST must not use that production source region. Store the source bucket/prefix and exact allowlist, plus both credential pairs, in that stage's protected Environment secrets; keep non-secret regions, bucket configuration and the enablement switch in its Environment variables. The dedicated derived identity must be separate from the API identity and have only `s3:GetObject` on the approved private derivative scope. The signer uses that explicit identity and the fixed derived bucket/region; it has no write, delete, list, or default-credential fallback. Browsing signs only listing candidates that pass source identity, eligibility, and exact allowlist checks. Before approval, verify the actual stage configuration's Serverless variable resolution and Lambda environment-size budget without printing secret values.

Preserve the currently approved `THUMBNAIL_API_ENABLED` value in both environments; do not change v1 enablement as part of the v2 rollout. Keep `THUMBNAIL_API_V2_ENABLED=false` until the separate TEST source scope and existing private TEST derivatives, dedicated read credentials, and v2 behavior are approved. Validate TEST before any PRD promotion. PRD v1 enablement additionally waits for independent read-only verification and reconciliation of the final five objects into the approved 13-key set. Before any rollout, an owner-authorized read-only validation must retrieve a genuine signed private WebP, confirm the original `AccessUrl` still works, confirm anonymous raw-object access fails, and confirm unprocessed objects receive no thumbnail URL; a generated URL alone is not sufficient. No live validation is authorized by this documentation.

For rollback, set the stage's `THUMBNAIL_API_ENABLED=false` and redeploy through its existing controlled workflow. Retain `WASABI_INTERNAL_BUCKETS` protection if possible. Do not delete derivatives or alter backfill state.

## Phase 8D-C3 — Deterministic v2 thumbnail URLs

The API can optionally sign deterministic C1 `v2` WebP keys while listing source objects. `THUMBNAIL_API_V2_ENABLED` defaults to `false`; implementation does not enable it in TEST or PRD. In legacy mode, when the opt-in JSON setting is absent, each stage remains restricted to the existing exact source bucket and slash-terminated prefix in Sydney (`ap-southeast-2`). In opt-in mode, a stage may list exact `{bucket, region}` entries and any eligible key prefix in those buckets. For each returned, eligible standard image or supported CR2 embedded-preview candidate within the 25 MiB source limit, the API derives the key from the listing ETag, source region, bucket, and complete object key. It uses the existing dedicated Singapore (`ap-southeast-1`) derived-read identity. There is no per-file allowlist, generation, existence `HEAD`, new endpoint, or change to the original `AccessUrl` or frontend fallback.

V2 is independently enabled from v1 and does not require the v1 source settings or key allowlist. It does require the shared stage-specific derived bucket, Singapore region, dedicated read credential pair, TTL, and derived-bucket entry in `WASABI_INTERNAL_BUCKETS`. If v1 and v2 are both enabled in the same bucket, the v1 exact 13-key candidate wins; eligible non-pilot objects may receive v2 URLs. Keep the v1 Tokyo production guard and v1 13-key limit unchanged.

Configure TEST and PRD separately through their protected GitHub Environments: `THUMBNAIL_API_V2_ENABLED` (Environment variable, kept `false` until separately approved), `THUMBNAIL_API_V2_SOURCE_BUCKET` and `THUMBNAIL_API_V2_SOURCE_PREFIX` (Environment secrets), and `THUMBNAIL_API_V2_SOURCE_REGION=ap-southeast-2` (Environment variable). Preserve the stage's existing `THUMBNAIL_API_ENABLED` value; v2 rollout must not enable, disable, or otherwise alter v1. Reuse that stage's existing derived-bucket settings and dedicated read credentials; do not copy credentials between stages. The deploy workflow validates enabled configuration before Serverless deployment. No source scope or secret is committed in this repository.

To roll back v2 enrichment, set `THUMBNAIL_API_V2_ENABLED=false` in that stage's protected Environment and redeploy through its existing controlled workflow. This leaves v1 enablement and allowlisted URLs untouched. Retain `WASABI_INTERNAL_BUCKETS` protection; do not delete derivatives or alter backfill state.

As an additive, opt-in transition, a stage may set `THUMBNAIL_API_V2_SOURCE_BUCKETS_JSON` to a JSON array of exact `{ "bucket": "...", "region": "..." }` entries. The opt-in form enrolls every eligible object key in those buckets; it does not add a prefix allowlist and performs no per-file authorization or existence probe. It requires the existing `THUMBNAIL_API_V2_SOURCE_BUCKET` and `_REGION` legacy pair to remain represented while those legacy variables are set, preventing accidental coverage loss during migration. Malformed or empty JSON fails closed.

PRD opt-in mode requires `THUMBNAIL_API_V2_EXCLUDED_BUCKETS_JSON` as an explicit syntactically valid JSON array, including `[]` when no buckets are excluded. TEST opt-in may use its separately configured explicit protections and must reject malformed exclusion JSON if supplied. Exclusions and internal/derived buckets are explicit configuration; the implementation does not infer ownership from bucket names or treat a source region as account-level access. TEST may include only expressly approved TEST source entries. Leave the source-enrollment JSON setting absent to preserve the legacy bucket/prefix behavior. Present-but-empty or malformed source-enrollment JSON fails closed. Rollback is to remove the source-enrollment JSON setting and keep the legacy variables, or set `THUMBNAIL_API_V2_ENABLED=false`; do not alter v1, policies, credentials, or durable v2 objects.

## Phase 8 Task 8C-A1 - Thumbnail evidence tools

These local tools gather evidence only. The inventory requests object-list metadata from explicitly named Wasabi buckets and does not download or modify source objects. Its broad candidate-image extensions are for measurement, not an approved thumbnail eligibility policy. The thumbnail prototype reads a local image and writes a separate WebP output.

Run the inventory from the repository root with the normal complete local backend `.env` configuration. The script loads `.env` before importing storage and configuration modules; the existing Entra trusted-user configuration remains required.

```powershell
npm run inventory:images -- --bucket "<source-bucket>"
npm run inventory:images -- --bucket "<source-bucket>" --bucket "<another-source-bucket>" --prefix "<optional/prefix/>"
```

The default output contains aggregate counts and byte totals only, without bucket names or object keys. For local representative images, Sharp writes WebP at a maximum 512-pixel edge and quality 80 by default. The output may be an existing/new directory or a `.webp` file path.

```powershell
npm run thumbnail:prototype -- ".\private-samples\representative.jpg" ".\private-samples\output"
npm run thumbnail:prototype -- ".\private-samples\representative.jpg" ".\private-samples\preview.webp" --max-edge 384 --quality 75
```

Do not commit inventory output or personal sample images. For review, return aggregate object/byte totals, extension counts/bytes, candidate-image counts/bytes and source-size p50/p90/max, plus missing ETags. For representative prototypes, record source/output dimensions and bytes, reduction percentage, visual quality, orientation and small-image behavior, transparency where relevant, and HEIC/HEIF success or failure category without private filenames.

The read-only locator is for explicit, local evidence gathering. It lists object metadata only; it does not download or modify objects. Its JSON output intentionally contains private bucket names and full object keys, so do not commit output. The diagnostic extension set is not the production thumbnail eligibility policy.

Locate NEF files:

```powershell
npm run locate:images -- --bucket <bucket-1> --bucket <bucket-2> --extension nef --limit 20
```

Use `--extension cr2` in the same command to locate CR2 RAW objects.

Locate the largest photo/image objects:

```powershell
npm run locate:images -- --bucket <bucket-1> --bucket <bucket-2> --largest 10
```

## Phase 8C-B2-A TEST backfill (owner-run only)

The local batch CLI defaults to a read-only metadata dry-run: it lists only the explicitly selected TEST source prefix and checks eligible objects' derived-object metadata. It does not fetch source bodies, write derived objects, create/update checkpoints, or acquire the persistent writer lock. It requires an explicit source bucket, source region, `pilot/` (or narrower) prefix, and a maximum of 1-10 objects.

```powershell
npm run thumbnail:backfill:test -- --source-bucket "<configured-test-source-bucket>" --source-region "ap-southeast-2" --prefix "pilot/" --max-objects 10
```

Live writes are **owner-only**, limited to the configured TEST source and the configured private derived bucket in Singapore (`ap-southeast-1`). A live invocation must use an absolute checkpoint path outside the Git working tree and include both confirmation flags. Live invocations share one stable exclusive lock in the current user's OS temporary directory, regardless of checkpoint filename. This lock prevents concurrent local writers only; it is not a cross-machine distributed lock. The checkpoint stores the last fully completed source key and must be treated as sensitive. Each terminal object result is checkpointed atomically; on ambiguous post-PUT interruption, rerunning from the prior cursor is intended to safely encounter `already-present`. Never remove or replace a stale lock unless the owner has confirmed no process is active.

```powershell
npm run thumbnail:backfill:test -- --source-bucket "<configured-test-source-bucket>" --source-region "ap-southeast-2" --prefix "pilot/" --max-objects 10 --checkpoint "C:\private\wasabi-thumbnail-backfill.json" --execute --confirm-test-backfill
```

The owner must manually grant `s3:ListBucket` only on the approved TEST source bucket, constrained by `s3:prefix` to `pilot/`, retain source GetObject only on `pilot/*`, and grant the needed HEAD/conditional PUT permissions only to the approved Singapore derived bucket. Do not change IAM from this repository. Each invocation examines at most 10 objects. The listing is a moving view, not a snapshot; keys added or changed lexicographically before the saved cursor require a deliberate new scan from the beginning after the current scan completes.

The owner validated B2-A against TEST objects: source `ListObjectsV2 StartAfter` and strict listing order worked in Sydney, dry-run passed, checkpoint creation and resume worked, and a resumed two-object batch generated two private WebPs in Singapore.

For Wasabi Support Case 00307622, Support reported the conditional-PUT fix deployed in Singapore, while the Sydney rollout remained incomplete at last confirmation. The owner independently reproduced a sequential overwrite in Sydney. Do not treat Sydney derived conditional PUT as production-safe; this is provider- and region-specific evidence.

## Phase 8C-B2-B1 production metadata preflight (read-only)

This local command lists metadata for exactly one owner-approved source bucket, region and nonempty prefix configured to match the command arguments. It uses dedicated audit credentials with `s3:ListBucket` restricted to that bucket and prefix. Set `THUMBNAIL_PRD_PREFLIGHT_SOURCE_BUCKET`, `THUMBNAIL_PRD_PREFLIGHT_SOURCE_REGION`, `THUMBNAIL_PRD_PREFLIGHT_SOURCE_PREFIX`, `THUMBNAIL_PRD_PREFLIGHT_WASABI_ACCESS_KEY_ID`, and `THUMBNAIL_PRD_PREFLIGHT_WASABI_SECRET_ACCESS_KEY` in the local environment; it does not fall back to API, TEST, AWS profile, or deployment credentials.

```powershell
npm run thumbnail:preflight:prd -- --source-bucket "<owner-approved-source-bucket>" --source-region "<owner-approved-region>" --prefix "<owner-approved-prefix>/" --max-objects 100
```

The page size is bounded (default 100; maximum 1000), and `--max-objects` is mandatory (maximum 1000). Output contains only aggregate object counts/bytes, eligibility categories, and `complete`/`capped`; the five primary categories account for every examined object and all examined bytes. `invalidEtag` is an independent quality counter that can overlap a primary category. `unsupported` means not currently eligible: besides unsupported formats and folder markers, it includes supported-format candidates with missing or invalid ETags when within the size limit. The oversized count means supported-format candidates above 25 MiB for this scan, not permanent unsupported status. Eligible CR2 counts are metadata-only preview candidates and do not establish that an object has a usable embedded JPEG. Provider errors are sanitized, and a capped sample is not a complete inventory. Although the command never prints object names, metadata listing can access real photo filenames, so use an appropriately scoped read-only credential and handle access accordingly. This command performs only source `ListObjectsV2`; it does not read object bodies, contact a derived bucket, or write checkpoints or objects. **PRODUCTION WRITES ARE NOT AUTHORIZED.**

## Phase 8C-B2-B2 production backfill (implementation only; NOT YET AUTHORIZED)

The local production backfill has a separate CLI and dedicated `THUMBNAIL_PRD_BACKFILL_*` credentials. It does not load `.env` or fall back to API (`WASABI_*`), TEST, preflight-audit, AWS profile, metadata-service, or deployment credentials. Configure only the one owner-approved source scope and the private Singapore derived bucket in the local process environment; do not put real values in this repository. The CLI requires exact matches for the configured source bucket, source region and nonempty prefix. Recipe `v1` permits only Tokyo (`ap-northeast-1`); only an explicit `--recipe v2` permits Tokyo or Sydney (`ap-southeast-2`). Omitting `--recipe` remains `v1`, so Sydney is rejected by default. The derived region is fixed to Singapore (`ap-southeast-1`), while its bucket name is supplied through local configuration, not inferred from a name or hardcoded by the tool.

Placeholder-only local configuration (use a dedicated production backfill sub-user; never reuse other credentials):

```powershell
$env:THUMBNAIL_PRD_BACKFILL_STAGE = "prd"
$env:THUMBNAIL_PRD_BACKFILL_SOURCE_BUCKET = "<owner-approved-source-bucket>"
$env:THUMBNAIL_PRD_BACKFILL_SOURCE_REGION = "ap-northeast-1"
$env:THUMBNAIL_PRD_BACKFILL_SOURCE_PREFIX = "<owner-approved-prefix>/"
$env:THUMBNAIL_PRD_BACKFILL_DERIVED_BUCKET = "<configured-private-derived-bucket>"
$env:THUMBNAIL_PRD_BACKFILL_DERIVED_REGION = "ap-southeast-1"
$env:THUMBNAIL_PRD_BACKFILL_WASABI_ACCESS_KEY_ID = "<dedicated-backfill-access-key>"
$env:THUMBNAIL_PRD_BACKFILL_WASABI_SECRET_ACCESS_KEY = "<dedicated-backfill-secret-key>"
```

The following examples are **NOT YET AUTHORIZED** for live or dry-run access to Wasabi. The default invocation is metadata-only and can inspect at most 10 objects; it lists the exact source prefix and may HEAD individually eligible source and derived objects. It does not GET source bodies, generate thumbnails, create a lock, or write local state. `--max-objects` is required and `--page-size` is bounded to 1-10 (default 5).

The production backfill accepts only the fixed `--recipe v1` and `--recipe v2` choices. Omitting `--recipe` is exactly the legacy `v1` behavior, including the existing deterministic keys and checkpoint/audit formats. `v2` selects the immutable 200 x 190 centre-cropped WebP recipe at quality 80; it skips originals or CR2 previews too small to produce that exact size without enlargement. No dimensions or quality values can be supplied.

```powershell
# NOT YET AUTHORIZED — do not run against Wasabi until the owner approves B2-B3.
npm run thumbnail:backfill:prd -- --source-bucket "<owner-approved-source-bucket>" --source-region "ap-northeast-1" --prefix "<owner-approved-prefix>/" --max-objects 2
```

Execution is a separate owner-controlled gate and requires both confirmation flags plus absolute checkpoint and append-only audit paths in a private directory outside the repository. Paths must be canonical, non-symlink paths; on POSIX, their directory and existing files must be user-private. Windows ACLs are still checked, but **live execution is refused on Windows** because this Node.js implementation cannot establish durable directory-entry syncing after checkpoint rename. Use a POSIX host with directory `fsync` support for live execution until a Windows-specific implementation and its crash behavior are verified. On supported POSIX filesystems, checkpoint data is synced before rename and the containing directory is synced after rename; a sync failure returns failure even though the rename may already be visible. This is a crash-resistance measure, not a guarantee against storage hardware or filesystem failures.

The single production writer lock is stable across checkpoint names, is separate from the TEST lock, and prevents concurrency on this local machine only—not across machines. A stale lock fails closed and is never automatically taken over. The private JSON Lines audit is versioned and append-only. Before each conditional PUT, the tool durably records a `write-intent` with the scope fingerprint, event ID and selected recipe's derived key. After the PUT, it appends `generated`, `not-generated` (a confirmed conditional-write race), or `unknown`. Checkpoint advancement follows a terminal processing result and its required audit events. If the process stops with an intent lacking an outcome, the next execution records `unknown` and stops before source listing. Any `unknown` outcome blocks future runs with those state files. A successful PUT followed by an outcome-append failure therefore cannot be retried and mislabeled as an ordinary `already-present` result. The tool does not claim exact attribution for an unresolved remote write. Existing audit files are validated before processing and before append; missing final newlines, partial records, malformed JSON, invalid transitions, or scope mismatches fail closed. The tool never truncates or repairs audit data automatically.

When `--recipe v2` is selected, `.v2` is inserted before each checkpoint/audit file extension (for example, `checkpoint.json` uses `checkpoint.v2.json` and `audit.jsonl` uses `audit.v2.jsonl`). This keeps v2 state separate from historical v1 files. The v2 checkpoint and append-only audit carry explicit recipe identity and use new format versions; v1 formats remain unchanged. Both recipes use the same production writer lock under the shared `/state` home directory.

**Recovery:** stop and preserve byte-for-byte private copies of both the checkpoint and audit file before any manual review; keep the originals unchanged. For a checkpoint durability error, pending/unknown intent, or malformed audit tail, do not reuse those state paths. After reviewing the archived evidence and accepting that the prior attempt remains unattributed, start a deliberate new scan from the beginning with new checkpoint and audit paths. Existing derived objects will be reported as `already-present`; this does not attribute them to the earlier attempt. Retain the original audit alongside the new audit for manual reconciliation. There is no automated rollback or deletion. Source originals are never modified.

```sh
# NOT YET AUTHORIZED — requires a separate owner approval; POSIX host required for live execution.
npm run thumbnail:backfill:prd -- --source-bucket "<owner-approved-source-bucket>" --source-region "ap-northeast-1" --prefix "<owner-approved-prefix>/" --max-objects 2 --checkpoint "/private/wasabi-prd-checkpoint.json" --audit "/private/wasabi-prd-audit.jsonl" --execute --confirm-prd-backfill
```

The v1 recipe remains unchanged: deterministic v1 key, maximum 512-pixel edge, WebP quality 80, supported standard image formats and CR2 embedded previews, and a 25 MiB source cap. The fixed v2 recipe uses the same source eligibility and size limits. NEF and HEIC/HEIF remain unsupported. Destination objects remain private. Local development and tests use injected mocks only; they do not authorize production access. The owner controls the later rollout gate, including any approved TEST rehearsal and first photographs.

The TEST single-object pilot and the legacy TEST bulk driver do **not** exercise the production runner's recipe-specific checkpoint, append-only audit, or shared writer-lock path. The unit tests use mocked storage and local synthetic state; they are not a live multi-object TEST rehearsal.

The following v2 command is a syntax example only. **NOT AUTHORIZED FOR LIVE USE.** It uses placeholder values and still requires the separate owner approval gate:

```sh
npm run thumbnail:backfill:prd -- --source-bucket "<owner-approved-source-bucket>" --source-region "ap-northeast-1" --prefix "<owner-approved-prefix>/" --max-objects 2 --recipe v2 --checkpoint "/private/thumbnail-checkpoint.json" --audit "/private/thumbnail-audit.jsonl" --execute --confirm-prd-backfill
```

The following Sydney v2 command is **syntax-only and NOT AUTHORIZED for live or dry-run access**. Sydney requires explicit `--recipe v2`; this placeholder command is not permission to inspect or process any source:

```sh
npm run thumbnail:backfill:prd -- --source-bucket "<owner-approved-source-bucket>" --source-region "ap-southeast-2" --prefix "<owner-approved-prefix>/" --max-objects 2 --recipe v2
```

### Task 1B PRD v2 opt-in scope

Legacy mode remains active when `THUMBNAIL_PRD_V2_SOURCE_BUCKETS_JSON` is absent. Legacy v1 is unchanged; legacy v2 also remains the exact old single-bucket/prefix behavior until the explicit opt-in variables are supplied. Opt-in v2 is a local-only, non-secret migration configuration and does not alter API or TEST configuration:

```powershell
$env:THUMBNAIL_PRD_V2_SOURCE_BUCKETS_JSON = '[{"bucket":"synthetic-source","region":"ap-southeast-2"}]'
$env:THUMBNAIL_PRD_V2_EXCLUDED_BUCKETS_JSON = '["synthetic-test-bucket","synthetic-ops-bucket"]'
$env:THUMBNAIL_PRD_V2_DERIVED_BUCKET = "synthetic-private-derived"
```

Every opt-in source must match an exact `{bucket, region}` pair. The fixed derived bucket must match `THUMBNAIL_PRD_BACKFILL_DERIVED_BUCKET`, and the excluded list must explicitly identify protected TEST, internal, operational and state buckets. Migrate by removing legacy `THUMBNAIL_PRD_BACKFILL_SOURCE_*` values rather than keeping duplicate migration inputs. Malformed, empty or mismatched opt-in settings fail before storage creation. Synthetic values are examples only; actual bucket names remain outside Git.

Backfill and preflight both require an explicit scope selector:

```powershell
# Literal slash-terminated folder prefix
npm run thumbnail:backfill:prd -- --source-bucket "<approved-source>" --source-region "ap-southeast-2" --prefix "photos/2026/" --recipe v2 --max-objects 10

# Explicit whole-bucket root
npm run thumbnail:preflight:prd -- --source-bucket "<approved-source>" --source-region "ap-southeast-2" --whole-bucket --recipe v2 --max-objects 100
```

`--prefix` and `--whole-bucket` are mutually exclusive. A nonempty prefix must retain its slash-terminated literal contract; root is represented only by `""` through `--whole-bucket`, never by `/`, a blank value or a normalized path. Preflight retains its read-only credentials and 100/1000 object defaults/limits; preflight opt-in requires `--recipe v2`. Backfill remains capped at 10 examined objects and page size 1-10. Use separate checkpoint/audit paths for root and prefixed jobs.

Task 1B performs mocked tests and documentation only. It does not authorize a live dry-run, execution, policy attachment, credential change or deployment. TEST behavior remains unchanged; PRD rollout requires separate owner approval, verified Wasabi policy behavior, TEST rehearsal and an explicit rollback plan. No live rollback deletes source or derived objects.

## Phase 8 Task 8C-A1 — Recorded findings (October 2026)

The following findings summarize local, read-only inventory across **nine** existing source buckets and representative **local** thumbnail experiments. Figures are aggregate or anonymized: no private bucket names, full object keys, personal filenames, credentials, or photo samples are included. These are measurements and prototype results, **not** confirmation that production thumbnail generation is implemented.

### Source-library inventory

| Measurement | Result |
| --- | ---: |
| Source buckets inventoried | 9 |
| All objects | 80,181 |
| All object bytes | 937,392,086,523 (937.39 GB) |
| Zero-byte objects / folder markers | 136 / 115 |
| Candidate-image objects (measurement-only classifier) | 54,791 |
| Candidate-image bytes | 179,367,379,135 (179.37 GB) |
| Candidate-image source size: p50 / p90 | 3,088,217 / 6,063,451 bytes |
| Largest candidate-image source | 71,672,607 bytes |
| Objects missing an ETag in listing metadata | 0 |

The candidate-image classifier measures common browser-facing image extensions, **not every photographic RAW object** and **not the final production thumbnail allowlist**. Candidates account for approximately 68.3% of object count and 19.1% of total stored bytes. Their source bytes are a planning-scale estimate for a future initial backfill, not a measured transfer bill or a guarantee that every candidate can be decoded.

| Notable source extension | Objects | Bytes | Candidate-image classifier? |
| --- | ---: | ---: | --- |
| `.jpg` | 54,247 | 179,096,170,187 | Yes |
| `.jpeg` | 157 | 3,988,964 | Yes |
| `.png` | 305 | 215,845,437 | Yes |
| `.webp` | 54 | 1,017,738 | Yes |
| `.heic` | 25 | 49,646,136 | Yes, decoder unverified |
| `.gif` | 3 | 710,673 | Yes, policy not decided |
| `.jfif` | 3 | 4,070,556 | No; Sharp locally recognized sampled JFIF as JPEG |
| `.cr2` | 35 | 546,995,926 | No; Canon RAW preview is an additional requirement |
| `.nef` | 22,727 | 245,708,289,897 | No; Nikon RAW support deferred |

Together `.jpg` and `.jpeg` represent about **99.3% of the measured candidate-image count** and **99.85% of candidate-image bytes**. That supports prioritizing conventional photographs while keeping RAW preview support separately pluggable. No `HeadObject` per image or metadata database was needed for the inventory.

### Sharp prototype observations

The initial local baseline was **WebP, maximum 512-pixel edge, quality 80**, preserving aspect ratio, applying orientation metadata, and avoiding enlargement. These settings are a successful *prototype baseline*, not a permanent production constant. Output visual quality was judged good for the tested examples.

| Representative local test | Source bytes | Resulting WebP dimensions | WebP bytes | Byte reduction |
| --- | ---: | --- | ---: | ---: |
| JPEG photograph | 1,869,482 | 288 × 512 (auto-oriented) | 23,238 | 98.76% |
| JFIF/JPEG square image | 2,150,320 | 512 × 512 | 45,532 | 97.88% |
| JFIF/JPEG landscape image | 3,474,697 | 512 × 340 | 7,918 | 99.77% |
| Very large PNG poster (10,394 × 23,622 source pixels) | 71,672,607 | 225 × 512 | 21,338 | 99.97% |

The large PNG result demonstrates useful reduction on the largest *candidate-image object* reported by the inventory; it is not a test of the largest RAW file. No claim is made yet about production Lambda memory/duration, real HEIC decoding, or transparency on representative PNGs. Unit tests separately verify transform bounds, orientation, and no-enlargement behavior.

### Canon CR2 embedded-preview experiment

The installed local Sharp build could **not** decode a sampled `.cr2` source directly. A separate manual experiment with ExifTool 13.59 identified two embedded images: `PreviewImage` (**2,746,504 bytes**, **5,472 × 3,648** pixels) and `ThumbnailImage` (17,201 bytes). The smaller `ThumbnailImage` looked poor; the full-sized `PreviewImage` looked good.

Extracting `PreviewImage` to a separate JPEG and processing it with the existing Sharp prototype produced a **512 × 341 WebP, 40,506 bytes**, a **98.53%** reduction relative to the **embedded JPEG preview**. This percentage must not be interpreted as the reduction relative to the entire CR2 source. No source object was modified.

This proves feasibility for the sampled CR2, **not** that a Node.js / Linux Lambda-compatible preview extractor has been selected or packaged. Production CR2 support remains a requirement for the later thumbnail pipeline: show its derived WebP in the grid when available, retain the original `AccessUrl` for opening/downloading the CR2, and fall back to the generic file icon if no usable preview exists. Do not render the CR2 original in an HTML `<img>`.

### Scope decisions and remaining checks

- **NEF:** Deferred because the Nikon camera is configured to upload separate JPEG versions of those photographs. NEF decoding/extraction is not needed for the current browsing objective.
- **CR2:** In scope for eventual derived thumbnails because equivalent separate JPEGs are not available for these files. Prefer the larger embedded `PreviewImage` when usable; investigate a suitable runtime extraction method before committing to an ExifTool/RAW dependency.
- **HEIC/HEIF:** Present in inventory but not tested against the target worker build. Do not assume support or let it block normal photo thumbnails.
- **JFIF:** Locally decodable as JPEG; final format/eligibility policy is still to be established in A2.
- **Safety (historical A1 scope):** Originals stay authoritative and private. A1 contained only read-only storage metadata tooling and local-file prototypes—no thumbnail bucket writes, SNS/Lambda worker, backfill, API `ThumbnailAccessUrl`, or frontend thumbnail rendering. Phase 8C-D1 later added the optional backend URL field described above; it adds no storage-write path.

**Historical next gate:** A1 was followed by A2, which defined the deterministic key, eligibility policy, and reusable service boundary. Backfill safeguards remain separate; event automation and frontend rendering are outside Phase 8C-D1 and require separate approval.

## Phase 8 Task 8C-A2 — Durable Thumbnail Foundation

This repository includes a minimal backend thumbnail foundation that is intentionally isolated from the Express API and storage adapters. The implementation is a local-only utility layer that defines a deterministic v1 thumbnail identity, performs policy checks before any transformation, and produces a WebP result without writing to Wasabi or modifying source objects.

### Deterministic v1 key contract

`SHA-256(JSON.stringify(["v1", sourceRegion, sourceBucket, completeSourceKey, normalizedETag]))` is used as the derived identity. The ETag is normalized only by trimming whitespace and removing one pair of enclosing double quotes. The resulting key is then stored as `v1/<first-two-hash-characters>/<full-hex-hash>.webp`.

The repository rejects blank region, bucket, source key, or ETag values and does not produce a derived path for unsupported or zero-byte inputs. The key remains separate from the source bucket/key metadata and never stores private values in cleartext.

### Eligibility policy

The production allowlist is intentionally distinct from the A1 evidence classifier. Supported standard formats are `jpg`, `jpeg`, `jfif`, `png`, and `webp`. The `nef` path remains deferred. Unsupported formats and folder markers are treated as nonfatal results rather than failures. This keeps the original object flow unchanged while making thumbnail generation deterministic and safe.

### Transform recipe

The `transformToWebp` utility follows the validated prototype settings: maximum 512-pixel edge, quality 80, `fit: "inside"`, `withoutEnlargement: true`, `rotate()` to honor EXIF orientation, and automatic WebP output without retaining unnecessary metadata. The transform accepts in-memory bytes and returns `image/webp` output with width, height, bytes, and safe metadata for later application logic.

### Memory and CR2 gate

The A2 service remains in-memory only. It accepts source bytes in a Buffer and returns the derived WebP bytes plus metadata. At the time of A2, this was a local-only foundation; Phase 8C-D1 later integrated optional URL signing for already-created allowlisted derivatives. Any future worker must evaluate memory limits and payload size before processing large or exotic source files, especially CR2 preview extraction and large RAW previews. Standard-image support is complete and verified.

The local-only `extract-raw-preview@1.1.0` experiment successfully selected an embedded JPEG from the representative local Canon CR2 sample: 5472 × 3648 pixels and 2,746,504 bytes. Compatibility was demonstrated locally on Node.js 24. The CR2's IFD0 Orientation is 8, while the extracted JPEG has no Orientation tag, so the initial 512 × 341 WebP was sideways. The local probe reads the bounded TIFF IFD0 Orientation and uses it only when the extracted preview has no orientation of its own; preview EXIF orientation takes precedence. The corrected output was 341 × 512 pixels (41,620 bytes), visually confirmed upright. This validates the representative sample only, not all CR2 files or Linux packaging.

The repo includes an optional local-only CR2 probe script for user-supplied RAW files:

```sh
npm run thumbnail:cr2:probe -- "<local-file.CR2>"
npm run thumbnail:cr2:probe -- "<local-file.CR2>" --webp "<separate-output-file.webp>"
```

The script prints sanitized JSON only: success/failure category, selected embedded preview MIME type, dimensions, resulting WebP dimensions, and bytes. It does not upload, modify, or print private path details. The optional output flag creates a separate WebP file and refuses to overwrite an existing file or the source.

### Local design contract

- Do not import backend config or storage credentials in the thumbnail utility layer.
- Keep Sharp and the CR2 preview extractor in development dependencies; Linux worker packaging is not yet validated.
- Return structured nonfatal results for unsupported inputs instead of throwing for ordinary cases.
- At the A2 milestone, the API had no `ThumbnailAccessUrl`; Phase 8C-D1 later added the optional field while preserving original `AccessUrl` semantics and adding no storage-write path.
- The lightweight `src/thumbnail/index.js` remains separate from the processing service and its Sharp/CR2 dependencies.

## Phase 8 Task 8C-A3 — In-Memory CR2 Service Integration

The in-memory `applyThumbnailPolicy()` service now accepts eligible `.cr2` objects, extracts the embedded JPEG, and applies the same fixed v1 512px/quality-80 WebP transform and original-source identity as standard images. Preview EXIF orientation takes precedence; CR2 IFD0 orientation is used only as a fallback, with mirrored orientations rejected. Declined, malformed, or unusable previews return a nonfatal result without a derived key or WebP. Standard formats and the API import graph remain unchanged.

The owner completed the real-file main-service validation locally with Node.js 24: a representative Canon CR2 produced an upright 341 × 512 WebP of 41,620 bytes. Run the local service smoke with Node.js 24:

```powershell
node scripts/thumbnail-cr2-service-smoke.js "<local-file.CR2>"
```

The command uses synthetic identity metadata and prints only eligibility, reason, output dimensions, byte count, and content type. NEF, HEIC/HEIF, unsupported CR2 variants, other RAW formats, and documents/video remain deferred or unsupported. Private derived Wasabi writes/backfill and SNS/Lambda processing remain separate; API `ThumbnailAccessUrl` signing is now covered by Phase 8C-D1, while React grid integration remains out of scope. Linux Lambda packaging, worker memory requirements, and compatibility across CR2 variants are not yet proven.

## Phase 8 Task 8C-B1 — One-Object TEST Thumbnail Pilot

B1 adds a local-only pilot for a single explicitly selected TEST object. Configure `THUMBNAIL_PILOT_STAGE=test`, an allowlisted TEST source bucket, a separate private TEST derived bucket and its Wasabi region, and dedicated least-privilege TEST credentials. The credentials must allow reading only the controlled source and HEAD/conditional PUT in the derived bucket, with no source-object Put/Delete permissions. Do not reuse the Express application's Wasabi credentials.

Run a metadata-only dry run by default:

```powershell
npm run thumbnail:pilot -- --source-bucket <test-source-bucket> --source-key <full-object-key> --source-region <wasabi-region>
```

Recipe `v2` is the fixed 200 x 190-pixel centre crop, encoded as WebP at quality 80. It can be selected explicitly for a metadata-only dry run; `v1` remains the default. This example does **not** authorize live execution:

```powershell
npm run thumbnail:pilot -- --source-bucket <test-source-bucket> --source-key <full-object-key> --source-region <wasabi-region> --recipe v2
```

**Live-write approval warning:** The following commands are syntax examples only. This documentation does not authorize a live TEST write. Run either command only after separate owner approval and confirmation of the TEST source, destination, credentials, and permissions. Both confirmation flags are required.

An explicitly approved live one-object operation using the legacy `v1` recipe requires both confirmation flags:

```powershell
npm run thumbnail:pilot -- --source-bucket <test-source-bucket> --source-key <full-object-key> --source-region <wasabi-region> --recipe v1 --execute --confirm-test-write
```

To select the fixed C1 recipe for an explicitly approved live one-object operation, specify `--recipe v2`:

```powershell
npm run thumbnail:pilot -- --source-bucket <test-source-bucket> --source-key <full-object-key> --source-region <wasabi-region> --recipe v2 --execute --confirm-test-write
```

The pilot checks the deterministic destination key before any source-body download, rejects known oversized objects, and enforces a 25 MiB source stream limit. Source GetObject uses `IfMatch` and checks the returned ETag and size; derived PutObject uses `IfNoneMatch: "*"`. It never falls back to unconditional reads or writes. The owner validated conditional source reads in Sydney and conditional derived creation in Singapore for the B1 TEST pilot. Wasabi's fix rollout remains region-specific as noted above; verify the exact TEST destination before any additional live use.

B1 does not authorize production writes or a backfill, and adds no SNS processing, Lambda worker, API/frontend changes, or cloud resources.

The production backfill requires an explicit --max-objects value. Recipe v1, including the default recipe, permits 1–10 examined objects per invocation. Explicit --recipe v2 permits 1–250. Source listing requests remain limited to 10 objects each, with a default page size of 5. A higher invocation limit does not authorize production execution.

## Phase 8D-D Task 2B — Local PRD v2 backfill campaigns

The local campaign coordinator schedules existing bounded v2 backfill invocations in order. It reuses the production backfill CLI, service, storage adapter, audit journal, checkpoint validation and shared writer lock; it is not an image manifest, a new source authorization mechanism, synchronization, or automated bucket discovery. The campaign plan selects only sources already enrolled by the existing exact `{bucket, region}` PRD configuration. The derived destination and dedicated credentials continue to come only from the validated production environment.

Keep the plan, checkpoints, audit journals, clean-boundary backups and stop signals private and outside the Git working tree. In the backfill container, mount the private Linux-backed state volume at `/state`; the existing Dockerfile sets `HOME=/state`, so the established writer lock is `/state/.wasabi-drive-thumbnail-backfill-prd.lock`. The plan and all per-job state/backup paths must be absolute paths under `/state`. The plan itself must be a private, regular, single-link file.

The plan has exactly these top-level fields. Each job requires a literal `prefix` **or** `wholeBucket: true` (never both); `pageSize` is optional and defaults to 5. Checkpoint, audit and backup paths are base paths: the existing CLI resolves each v2 path by inserting `.v2` before its extension. Paths must be unique after that resolution. `batchLimit` is 1–250; `pageSize` is 1–10; `maxSlices` is a finite campaign-session limit from 1–1000.

```json
{
  "version": 1,
  "stage": "prd",
  "recipe": "v2",
  "maxSlices": 100,
  "jobs": [
    {
      "sourceBucket": "<exact-enrolled-source-bucket>",
      "sourceRegion": "ap-southeast-2",
      "prefix": "photos/2026/",
      "checkpointPath": "/state/library-2026-checkpoint.json",
      "auditPath": "/state/library-2026-audit.jsonl",
      "checkpointBackupPath": "/state/library-2026-checkpoint-backup.json",
      "auditBackupPath": "/state/library-2026-audit-backup.jsonl",
      "batchLimit": 250,
      "pageSize": 5
    }
  ]
}
```

For an explicitly enrolled whole-bucket scan, remove `prefix` and use `"wholeBucket": true`; an absent or empty prefix never means bucket root. Prefixes are literal slash-terminated paths; wildcard characters are rejected. Use one job per non-overlapping source scope and separate state paths for each scan identity. Protected, internal, TEST, excluded and derived buckets are rejected. Unknown fields—including plan-supplied destination or credential values—are rejected.

For a new scan, the four state/backup files must all be absent. On restart of an existing scan, the checkpoint backup must be an exact copy of the current checkpoint, and the audit backup must exactly match the current audit file when one exists (otherwise its backup must be absent). A missing or stale backup stops validation. After a campaign changes state, make a fresh clean-boundary backup before restarting; never overwrite, reset, repair or delete historical state to make validation pass.

Run validation first. This reads the private plan and local configuration and checks any existing checkpoint/audit files against their declared clean-boundary backups. It does not create storage clients, list source objects, acquire a lock, read photo bodies or write files:

```sh
node /app/scripts/thumbnail-backfill-campaign-prd.js --plan /state/campaign.json
# Equivalent explicit validation:
node /app/scripts/thumbnail-backfill-campaign-prd.js --plan /state/campaign.json --validate-plan
```

The following is execution syntax only, **not production authorization**. A live run requires both campaign flags and, independently, the existing paired per-invocation backfill confirmations. The owner must separately approve the actual PRD campaign and environment before using them:

```sh
node /app/scripts/thumbnail-backfill-campaign-prd.js --plan /state/campaign.json --execute-campaign --confirm-prd-campaign
```

To keep the existing Dockerfile entrypoint unchanged, override it only for the campaign command and mount the same private state volume:

```sh
docker run --rm --mount type=bind,source=/private/wasabi-state,target=/state --entrypoint node wasabi-backfill-image /app/scripts/thumbnail-backfill-campaign-prd.js --plan /state/campaign.json
```

The coordinator validates every job and its state before beginning. It runs one bounded invocation at a time, continues only from a valid `paused-cap` result with reconciled counters and an advancing v2 checkpoint, and advances to the next job only after verified `completed` (including an empty scope). Provider/state failures, ambiguous writes, lock conflicts/loss, missing or invalid backups, unexpected CLI output, no progress, stop requests and the finite slice guard stop the campaign; no failed job is silently restarted from a new checkpoint. The shared writer lock remains owned by each existing CLI invocation and is released between slices. Do not run any other backfill writer during a campaign; the lock is not held campaign-wide or distributed across machines.

Use Ctrl+C (`SIGINT`) or a graceful container stop (`SIGTERM`) to request a stop. The coordinator finishes the current bounded slice, then stops before starting another. A `stopped` or `paused-budget` result is not completion. Restart only with the same plan and state, after validating and backing up the current state. Summary JSON contains only job indices, scan-state labels and aggregate counters for this process session; it does not represent totals from earlier runs and never claims a cursor-based resume is a catch-up scan.

For a Sydney catch-up, use new v2 state paths and a fresh lexical scan; do not reuse or alter any `/state/sydney-100/` historical checkpoint or audit. Existing matching v2 derivatives are skipped by the backfill. For the original Tokyo v1 pilot, select that already enrolled source as a separate v2 job with separate state; v1 derivatives and API v1-first serving remain unchanged. Later uploads sorting before a completed cursor require a new scan with new state paths. No campaign or bucket-discovery automation is introduced by this task.

Task 2B is implementation and offline testing only. Validation output, configured credentials, and the paired flags do not authorize Wasabi access, production writes, policy/credential changes, Docker access to real state, deployment, or Git operations.
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

To manually redeploy the current `master` to TEST and apply previously configured TEST Environment variables or secrets, open **Actions** → **Backend Test Deployment** → **Run workflow**, select `master` in the branch selector, then choose **Run workflow**. The workflow runs its tests, deploys using the protected `test` Environment, and performs the deployment smoke checks. A dispatch from any branch other than `master` cannot deploy. Merging this workflow change to `master` will itself trigger the existing automatic TEST deployment, so keep `THUMBNAIL_API_ENABLED=false` until the owner explicitly approves TEST thumbnail enablement.

To roll back TEST thumbnail enrichment, set `THUMBNAIL_API_ENABLED=false` in the protected `test` Environment and manually run **Backend Test Deployment** again from `master`. Preserve `WASABI_INTERNAL_BUCKETS` protection.

Production promotion is manual through the **Backend Production Promotion** workflow. Start it from `master` and provide the exact full 40-character commit SHA that was deployed to and validated in `test`. The workflow verifies that the commit belongs to `master`, checks out that exact commit, and runs `npm ci` and `npm test` before deployment. The GitHub Environment `prd` is the production protection boundary and can require approval.

GitHub OIDC and AWS STS provide short-lived AWS deployment credentials. No permanent AWS deployment access keys are stored in GitHub. The production workflow runs the existing `npm run deploy:prd` command; production configuration is supplied through the protected `prd` environment.

To roll back, identify a known-good commit on `master` and rerun **Backend Production Promotion** with that exact full SHA. The workflow performs the same validation and tests before redeploying that source to production.

Rollback to a commit predating the health/deployment-smoke capability may successfully redeploy the older application but fail the current workflow's post-deployment smoke step because that source does not expose `/health` or support the `deployment-smoke` scope. In that case, verify the rollback manually. After this capability has been production-validated, prefer a known-good SHA that includes it.

## Phase 8C-D1 — Scoped private thumbnail URLs

The backend can optionally add `ThumbnailAccessUrl` to authorized object-list results for exact, approved v1 derivative keys. The existing original `AccessUrl`, pagination, and object metadata remain unchanged. Enrichment is disabled by default; this implementation does not enable production access or perform thumbnail existence checks.

Configure each protected GitHub Environment (`test` and `prd`) independently. `WASABI_INTERNAL_BUCKETS` is required as a nonempty exact bucket-name list for every deployed stage, even while thumbnail enrichment is disabled; it filters those buckets from bucket results and blocks direct region/object browsing. The deployment workflow validates centralized configuration locally before Serverless runs. Local/mock operation without `DEPLOYMENT_STAGE` may omit the internal list, but must not be treated as a deployment configuration.

When explicitly enabled, provide the environment's source bucket, source region, slash-terminated private prefix, derived bucket, Singapore derived region (`ap-southeast-1`), exact verified allowlist (up to 13 v1 keys), dedicated read access-key pair, and URL lifetime. PRD source scope is Tokyo (`ap-northeast-1`); TEST must not use that production source region. Store the source bucket/prefix and exact allowlist, plus both credential pairs, in that stage's protected Environment secrets; keep non-secret regions, bucket configuration and the enablement switch in its Environment variables. The dedicated derived identity must be separate from the API identity and have only `s3:GetObject` on the approved private derivative scope. The signer uses that explicit identity and the fixed derived bucket/region; it has no write, delete, list, or default-credential fallback. Browsing signs only listing candidates that pass source identity, eligibility, and exact allowlist checks. Before approval, verify the actual stage configuration's Serverless variable resolution and Lambda environment-size budget without printing secret values.

Keep `THUMBNAIL_API_ENABLED=false` in both environments until the separate TEST source and private TEST derivatives, dedicated read credentials, source scope, and exact TEST keys are approved. Validate TEST before any PRD promotion. PRD enablement additionally waits for independent read-only verification and reconciliation of the final five objects into the approved 13-key set. Before rollout, an owner-authorized read-only validation must retrieve a genuine signed private WebP, confirm the original `AccessUrl` still works, confirm anonymous raw-object access fails, and confirm unprocessed objects receive no thumbnail URL; a generated URL alone is not sufficient. No live validation is authorized by this documentation.

For rollback, set the stage's `THUMBNAIL_API_ENABLED=false` and redeploy through its existing controlled workflow. Retain `WASABI_INTERNAL_BUCKETS` protection if possible. Do not delete derivatives or alter backfill state.

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

The local production backfill has a separate CLI and dedicated `THUMBNAIL_PRD_BACKFILL_*` credentials. It does not load `.env` or fall back to API (`WASABI_*`), TEST, preflight-audit, AWS profile, metadata-service, or deployment credentials. Configure only the one owner-approved Tokyo source scope and the private Singapore derived bucket in the local process environment; do not put real values in this repository. The intended initial source is the owner's complete 13-image Tokyo prefix validated by B2-B1; that metadata preflight is not itself authorization for this CLI. The CLI requires exact matches for the configured source bucket, Tokyo region (`ap-northeast-1`) and nonempty source prefix. The derived region is fixed to Singapore (`ap-southeast-1`), while its bucket name is supplied through local configuration, not inferred from a name or hardcoded by the tool.

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

```powershell
# NOT YET AUTHORIZED — do not run against Wasabi until the owner approves B2-B3.
npm run thumbnail:backfill:prd -- --source-bucket "<owner-approved-source-bucket>" --source-region "ap-northeast-1" --prefix "<owner-approved-prefix>/" --max-objects 2
```

Execution is a separate owner-controlled gate and requires both confirmation flags plus absolute checkpoint and append-only audit paths in a private directory outside the repository. Paths must be canonical, non-symlink paths; on POSIX, their directory and existing files must be user-private. Windows ACLs are still checked, but **live execution is refused on Windows** because this Node.js implementation cannot establish durable directory-entry syncing after checkpoint rename. Use a POSIX host with directory `fsync` support for live execution until a Windows-specific implementation and its crash behavior are verified. On supported POSIX filesystems, checkpoint data is synced before rename and the containing directory is synced after rename; a sync failure returns failure even though the rename may already be visible. This is a crash-resistance measure, not a guarantee against storage hardware or filesystem failures.

The single production writer lock is stable across checkpoint names, is separate from the TEST lock, and prevents concurrency on this local machine only—not across machines. A stale lock fails closed and is never automatically taken over. The private JSON Lines audit is versioned and append-only. Before each conditional PUT, the tool durably records a `write-intent` with the scope fingerprint, event ID and v1 derived key. After the PUT, it appends `generated`, `not-generated` (a confirmed conditional-write race), or `unknown`. Checkpoint advancement follows a terminal processing result and its required audit events. If the process stops with an intent lacking an outcome, the next execution records `unknown` and stops before source listing. Any `unknown` outcome blocks future runs with those state files. A successful PUT followed by an outcome-append failure therefore cannot be retried and mislabeled as an ordinary `already-present` result. The tool does not claim exact attribution for an unresolved remote write. Existing audit files are validated before processing and before append; missing final newlines, partial records, malformed JSON, invalid transitions, or scope mismatches fail closed. The tool never truncates or repairs audit data automatically.

**Recovery:** stop and preserve byte-for-byte private copies of both the checkpoint and audit file before any manual review; keep the originals unchanged. For a checkpoint durability error, pending/unknown intent, or malformed audit tail, do not reuse those state paths. After reviewing the archived evidence and accepting that the prior attempt remains unattributed, start a deliberate new scan from the beginning with new checkpoint and audit paths. Existing derived objects will be reported as `already-present`; this does not attribute them to the earlier attempt. Retain the original audit alongside the new audit for manual reconciliation. There is no automated rollback or deletion. Source originals are never modified.

```sh
# NOT YET AUTHORIZED — requires a separate owner approval; POSIX host required for live execution.
npm run thumbnail:backfill:prd -- --source-bucket "<owner-approved-source-bucket>" --source-region "ap-northeast-1" --prefix "<owner-approved-prefix>/" --max-objects 2 --checkpoint "/private/wasabi-prd-checkpoint.json" --audit "/private/wasabi-prd-audit.jsonl" --execute --confirm-prd-backfill
```

The implementation preserves the v1 key and current thumbnail policy (maximum 512-pixel edge, WebP quality 80, supported standard image formats and CR2 embedded previews, 25 MiB source cap). NEF and HEIC/HEIF remain unsupported. Destination objects remain private. B2-B2 development and tests use injected mocks only; they do not authorize production access. The owner controls the later rollout gate, including any B2-B3 compatibility check, dry-run and first 1-2 photographs.

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

An explicitly approved live one-object operation requires both confirmation flags:

```powershell
npm run thumbnail:pilot -- --source-bucket <test-source-bucket> --source-key <full-object-key> --source-region <wasabi-region> --execute --confirm-test-write
```

The pilot checks the deterministic destination key before any source-body download, rejects known oversized objects, and enforces a 25 MiB source stream limit. Source GetObject uses `IfMatch` and checks the returned ETag and size; derived PutObject uses `IfNoneMatch: "*"`. It never falls back to unconditional reads or writes. The owner validated conditional source reads in Sydney and conditional derived creation in Singapore for the B1 TEST pilot. Wasabi's fix rollout remains region-specific as noted above; verify the exact TEST destination before any additional live use.

B1 does not authorize production writes or a backfill, and adds no SNS processing, Lambda worker, API/frontend changes, or cloud resources.

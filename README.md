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

Production promotion is manual through the **Backend Production Promotion** workflow. Start it from `master` and provide the exact full 40-character commit SHA that was deployed to and validated in `test`. The workflow verifies that the commit belongs to `master`, checks out that exact commit, and runs `npm ci` and `npm test` before deployment. The GitHub Environment `prd` is the production protection boundary and can require approval.

GitHub OIDC and AWS STS provide short-lived AWS deployment credentials. No permanent AWS deployment access keys are stored in GitHub. The production workflow runs the existing `npm run deploy:prd` command; production configuration is supplied through the protected `prd` environment.

To roll back, identify a known-good commit on `master` and rerun **Backend Production Promotion** with that exact full SHA. The workflow performs the same validation and tests before redeploying that source to production.

Rollback to a commit predating the health/deployment-smoke capability may successfully redeploy the older application but fail the current workflow's post-deployment smoke step because that source does not expose `/health` or support the `deployment-smoke` scope. In that case, verify the rollback manually. After this capability has been production-validated, prefer a known-good SHA that includes it.

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
- **Safety:** Originals stay authoritative and private. A1 contains only read-only storage metadata tooling and local-file prototypes—no thumbnail bucket writes, SNS/Lambda worker, backfill, API `ThumbnailAccessUrl`, or frontend thumbnail rendering.

**Next gate:** Merge/review A1 as an evidence-only change. Task 8C-A2 will define the deterministic versioned key, centralized eligibility policy, reusable service boundary, and a production-compatible CR2-preview strategy in a separate focused change. Backfill, event automation, and frontend/API integration remain later tasks and require separate approval.

## Phase 8 Task 8C-A2 — Durable Thumbnail Foundation

This repository includes a minimal backend thumbnail foundation that is intentionally isolated from the Express API and storage adapters. The implementation is a local-only utility layer that defines a deterministic v1 thumbnail identity, performs policy checks before any transformation, and produces a WebP result without writing to Wasabi or modifying source objects.

### Deterministic v1 key contract

`SHA-256(JSON.stringify(["v1", sourceRegion, sourceBucket, completeSourceKey, normalizedETag]))` is used as the derived identity. The ETag is normalized only by trimming whitespace and removing one pair of enclosing double quotes. The resulting key is then stored as `v1/<first-two-hash-characters>/<full-hex-hash>.webp`.

The repository rejects blank region, bucket, source key, or ETag values and does not produce a derived path for unsupported or zero-byte inputs. The key remains separate from the source bucket/key metadata and never stores private values in cleartext.

### Eligibility policy

The production allowlist is intentionally distinct from the A1 evidence classifier. Supported standard formats are `jpg`, `jpeg`, `jfif`, `png`, and `webp`. The `nef` path remains deferred, and `cr2` is non-eligible through the main service pending owner approval of real-sample extraction evidence. Unsupported formats and folder markers are treated as nonfatal results rather than failures. This keeps the original object flow unchanged while making thumbnail generation deterministic and safe.

### Transform recipe

The `transformToWebp` utility follows the validated prototype settings: maximum 512-pixel edge, quality 80, `fit: "inside"`, `withoutEnlargement: true`, `rotate()` to honor EXIF orientation, and automatic WebP output without retaining unnecessary metadata. The transform accepts in-memory bytes and returns `image/webp` output with width, height, bytes, and safe metadata for later application logic.

### Memory and CR2 gate

The A2 service remains in-memory only. It accepts source bytes in a Buffer and returns the derived WebP bytes plus metadata. This is a deliberate design for local foundation work, but the future worker must evaluate memory limits and payload size before processing large or exotic source files, especially CR2 preview extraction and large RAW previews. Standard-image support is complete and verified.

The local-only `extract-raw-preview@1.1.0` experiment successfully selected an embedded JPEG from the representative local Canon CR2 sample: 5472 × 3648 pixels and 2,746,504 bytes. Compatibility was demonstrated locally on Node.js 24. The CR2's IFD0 Orientation is 8, while the extracted JPEG has no Orientation tag, so the initial 512 × 341 WebP was sideways. The local probe now reads the bounded TIFF IFD0 Orientation and uses it only when the extracted preview has no orientation of its own; preview EXIF orientation takes precedence. The corrected CR2 orientation handling was validated locally on Node.js 24 using a representative Canon CR2 file. The extracted JPEG preview was 5472 × 3648 pixels (2,746,504 bytes), with CR2 IFD0 Orientation 8. The resulting WebP was 341 × 512 pixels (41,620 bytes), and visual inspection confirmed that its orientation matches the original photograph. This validates the representative sample only. Linux Lambda packaging, broader CR2 compatibility, and integration into the production ThumbnailService remain pending. The expected result for this sample is an upright portrait WebP of approximately 341 × 512, with the same high-quality embedded JPEG extraction. This evidence validates the representative sample only, not all CR2 files. The main `ThumbnailService` still deliberately rejects CR2. Linux Lambda packaging and production integration have not been validated.

The repo includes an optional local-only CR2 probe script for user-supplied RAW files:

```sh
npm run thumbnail:cr2:probe -- "<local-file.CR2>"
npm run thumbnail:cr2:probe -- "<local-file.CR2>" --webp "<separate-output-file.webp>"
```

The script prints sanitized JSON only: success/failure category, selected embedded preview MIME type, dimensions, resulting WebP dimensions, and bytes. It does not upload, modify, or print private path details. The optional output flag creates a separate WebP file and refuses to overwrite an existing file or the source.

### Local design contract

- Do not import backend config or storage credentials in the thumbnail utility layer.
- Keep Sharp and any CR2 preview extractor in development-only tooling for this A2 stage.
- Return structured nonfatal results for unsupported inputs instead of throwing for ordinary cases.
- Preserve current API contracts and original `AccessUrl` semantics; this change does not add a `ThumbnailAccessUrl` or storage-write path.
- CR2 integration remains explicitly pending despite the representative local sample result; production eligibility stays disabled until the owner authorizes adoption, and Linux packaging is separately unvalidated.

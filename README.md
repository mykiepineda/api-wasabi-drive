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

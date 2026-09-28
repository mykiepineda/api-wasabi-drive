# Wasabi Drive API

Backend API for browsing Wasabi Drive buckets and generating temporary object access URLs.

## Health endpoint

`GET /health` returns HTTP 200 with the fixed body `{ "status": "ok" }`. It is intentionally unauthenticated and shallow; it does not probe Wasabi, Entra, or other dependencies.

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

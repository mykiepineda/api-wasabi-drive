# Wasabi Drive API

Backend API for browsing Wasabi Drive buckets and generating temporary object access URLs.

## Wasabi regions

`WASABI_SERVICE_URL` and `WASABI_REGION` configure the bootstrap/default S3 client. It uses those settings for account-level bucket listing and initial bucket-region discovery. They are not a guarantee that every bucket is in the same region, and separate environment variables per bucket or region are not needed.

Bucket-specific operations resolve the bucket's region with `GetBucketLocation`. If Wasabi returns a recognized `307 TemporaryRedirect`, the API validates the bucket's Wasabi endpoint and creates a regional client using the canonical endpoint `https://s3.<region>.wasabisys.com`. Region and client information is cached in process memory, so a cold start may repeat discovery. Presigned object URLs are signed by the bucket's regional client and remain valid for one hour.

Regional clients use the configured `WASABI_ACCESS_KEY_ID` and `WASABI_SECRET_ACCESS_KEY` credentials. An empty `GetBucketLocation` location constraint represents `us-east-1`; the legacy `EU` constraint represents `eu-west-1`.
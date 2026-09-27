# Wasabi Drive API — GitHub Copilot Instructions

## Project role

Wasabi Drive is an existing production application and an incremental modernization project.

The developer is the technical owner and architectural decision-maker.

Copilot is an implementation assistant. Make only the explicitly requested change, preserve working behavior, and do not independently redesign the architecture, authentication model, deployment model, AWS configuration, or application structure.

Prefer focused, reviewable changes over broad cleanup.

## Current phase

The broader modernization work is currently in **Phase 6 — CI/CD and Deployment Safety**.

CI/CD = Continuous Integration / Continuous Delivery.

Completed backend deployment-safety work includes:

- backend pull-request CI using Node.js 24, `npm ci`, and `npm test`;
- normalized backend deployment commands;
- automated backend `test` deployment from protected `master`;
- GitHub OIDC-based AWS authentication using short-lived AWS STS credentials;
- Serverless Framework version constrained to the reviewed 4.42 minor line.

The planned Phase 6 work is temporarily paused for an urgent production Wasabi storage hotfix.

Do not start or continue unrelated Phase 6 tasks in this change.

## Active task

Fix production browsing of Wasabi buckets that reside in a different Wasabi storage region from the configured bootstrap/default endpoint.

Recommended branch:

`hotfix/wasabi-multi-region-buckets`

Observed production failure when accessing bucket `klaris-icloud`:

- HTTP status: `307`;
- Wasabi error name/code: `TemporaryRedirect`;
- returned endpoint: `klaris-icloud.s3.ap-southeast-2.wasabisys.com`;
- message asks the client to resend the request to the temporary endpoint.

The current storage implementation constructs one module-level `S3Client` from:

- `WASABI_SERVICE_URL`;
- `WASABI_REGION`.

That one client is currently used for:

- `ListBuckets`;
- `GetBucketLocation`;
- `ListObjectsV2`;
- presigned `GetObject` access URLs.

This single-region assumption is the production defect for bucket-specific operations.

## Objective

Support Wasabi buckets across multiple Wasabi regions while preserving the existing public backend API and separation of concerns.

The configured `WASABI_SERVICE_URL` / `WASABI_REGION` remain the bootstrap/default Wasabi client configuration. Do not require one environment variable per bucket or per region.

Bucket-specific operations must use an S3 client configured for the target bucket's actual Wasabi region.

## Required implementation direction

Keep the implementation inside the existing storage/infrastructure boundary unless a concrete blocker proves another layer must change.

Primary implementation file:

`src/storage/wasabi.js`

Primary test file:

`test/wasabi.storage.test.js`

### 1. Preserve the configured/default client

Keep a configured/default Wasabi `S3Client` built from the existing centralized configuration.

Use it for account-level behavior such as `ListBuckets` and as the initial/bootstrap client for bucket-region discovery.

Do not change existing environment variable names.

### 2. Add bucket-region resolution

Introduce small internal helpers as needed to resolve the actual region for a bucket.

Continue using the existing `GetBucketLocationCommand` behavior rather than introducing a new API or dependency solely for this hotfix.

When `GetBucketLocationCommand` succeeds, normalize the returned `LocationConstraint` into a region string.

Preserve existing region response behavior returned by `getBucketRegion(name)`, including `region`, `longDescription`, and `shortDescription` where currently defined.

Handle an empty/null location constraint safely if encountered instead of calling string methods on `null` or `undefined`.

### 3. Handle Wasabi 307 TemporaryRedirect explicitly

If bucket-region discovery fails with a Wasabi `TemporaryRedirect` response matching the observed production shape:

- status code `307`;
- error name/code `TemporaryRedirect`;
- a Wasabi bucket endpoint in `error.Endpoint`;

extract the target Wasabi region from the endpoint.

Example:

`klaris-icloud.s3.ap-southeast-2.wasabisys.com`

must resolve to:

`ap-southeast-2`

Do not blindly trust or use an arbitrary endpoint URL supplied by an error response.

Validate that the endpoint is a Wasabi S3 endpoint before using it as a region-discovery signal, then construct the regional service endpoint from the validated region.

The normal regional endpoint form is:

`https://s3.<region>.wasabisys.com`

Also handle Wasabi's US East 1 canonical/alias behavior safely if relevant to the helper.

If the error is not the recognized Wasabi regional redirect shape, rethrow the original error. Do not hide unrelated storage failures and do not implement an unbounded retry loop.

Do not use generic HTTP redirect following.

Do not rely on the AWS SDK v3 `followRegionRedirects` option for this hotfix: AWS documents it for S3 `301 PermanentRedirect`; the observed Wasabi response is `307 TemporaryRedirect`.

### 4. Create/reuse regional clients

Create an `S3Client` for the resolved bucket region using:

- the canonical Wasabi regional service URL;
- the resolved region for Signature Version 4 signing;
- the existing configured Wasabi credentials.

Cache resolved bucket regions and/or regional clients in module memory so repeated requests on a warm Lambda instance do not rediscover the same bucket region unnecessarily.

Keep the cache simple and process-local. Do not add Redis, DynamoDB, a database, Parameter Store, Secrets Manager, or another service.

If a cached asynchronous resolution fails, do not permanently poison the cache with a rejected promise.

### 5. Use the regional client for every bucket-specific operation

Update bucket-specific operations so they use the target bucket's resolved regional client:

- `getBucketRegion(name)`;
- `getListObjects(params)`;
- `getObjectAccessUrl({ Bucket, Key })`.

This is especially important for `getObjectAccessUrl`: generating a presigned URL does not make a network request that can receive a redirect, so the URL must be signed with the correct regional client from the start.

Do not change the existing one-hour access URL behavior in this task.

### 6. Preserve existing API and layering

Preserve:

HTTP / Express route
-> application/service layer
-> infrastructure/storage implementation
-> AWS SDK for JavaScript v3
-> Wasabi.

Do not move Wasabi endpoint logic into Express routes or the React frontend.

Do not change response shapes for successful existing API operations.

No frontend change is expected for this hotfix.

## Tests required

Extend `test/wasabi.storage.test.js` with focused regression coverage for the production failure.

At minimum, cover:

1. existing same-region behavior still works;
2. `GetBucketLocation` returning a Wasabi `307 TemporaryRedirect` for a bucket such as `klaris-icloud` resolves `ap-southeast-2` correctly;
3. after region resolution, `ListObjectsV2` uses an `S3Client` configured with region `ap-southeast-2` and endpoint `https://s3.ap-southeast-2.wasabisys.com`;
4. presigned object access for that bucket uses the same correct regional client;
5. repeated operations can reuse cached region/client information rather than rediscovering the bucket each time;
6. malformed or unrelated errors are propagated rather than treated as valid region redirects.

Keep tests deterministic and isolated. Enhance the existing AWS SDK stubs only as much as needed to observe which client/options were used.

Do not weaken or delete existing tests.

Do not make tests depend on live Wasabi access.

## Expected source scope

Expected changed files are normally limited to:

- `src/storage/wasabi.js`;
- `test/wasabi.storage.test.js`;
- `.github/copilot-instructions.md` if this updated instruction file is being committed as part of the hotfix.

Do not change these unless a concrete implementation blocker requires it:

- `src/service/buckets.js`;
- `src/api/buckets.js`;
- `src/app.js`;
- `src/config/index.js`;
- `.env.example`;
- `serverless.yml`;
- `package.json`;
- `package-lock.json`;
- GitHub Actions workflows;
- Bruno scripts or collections;
- authentication or authorization code.

If another source file truly must change, explain why before expanding scope.

## Explicit non-goals

Do not include unrelated cleanup or modernization.

In particular, do not:

- migrate Express;
- migrate CommonJS to ESM;
- introduce TypeScript;
- change Microsoft Entra authentication;
- change trusted-user authorization;
- add API Gateway API keys as authentication;
- change API Gateway type;
- add Lambda authorizers;
- change Serverless Framework versions;
- change AWS deployment roles;
- change GitHub Actions workflows;
- change frontend code;
- change Firebase configuration;
- add a database or cache service;
- add dependencies unless a concrete blocker is first reported;
- implement uploads, deletes, or other new Wasabi features;
- perform broad error-response redesign in this hotfix;
- deploy `test` or `prd` from the feature branch.

The existing raw storage-error serialization can be reviewed separately after the production correctness fix; do not expand this urgent hotfix unless the developer explicitly requests that hardening.

## Current backend architecture

Preserve:

- Node.js 24;
- Express 4;
- CommonJS;
- AWS Lambda;
- API Gateway REST API;
- Serverless Framework v4;
- CloudFormation;
- AWS SDK for JavaScript v3;
- Wasabi S3-compatible storage;
- Microsoft Entra authentication;
- backend stages `test` and `prd`.

Local HTTP startup remains separate from Lambda application construction.

Configuration remains centralized.

## Security invariants

Do not weaken:

- Microsoft Entra authentication is mandatory;
- backend validates OAuth 2.0 access tokens;
- trusted-user authorization remains server-side;
- backend is the security authority;
- Wasabi credentials remain server-side;
- Wasabi objects remain private;
- temporary backend-authorized access URLs remain the object-access mechanism;
- API Gateway API keys are not authentication;
- no MongoDB/custom-password fallback exists.

Do not add secrets, credentials, tokens, passwords, real access URLs, or production data to source or tests.

Do not log Wasabi credentials.

## CI/CD and deployment invariants

`master` is protected.

Do not commit directly to `master`.

Use the focused hotfix branch:

`hotfix/wasabi-multi-region-buckets`

Preserve existing backend PR validation:

- Node.js 24;
- `npm ci`;
- `npm test`.

Preserve automated backend `test` deployment from protected `master`.

GitHub Actions uses GitHub OIDC -> AWS STS temporary credentials -> dedicated backend `test` deployment role -> Serverless Framework.

Do not introduce permanent AWS access keys.

Do not edit deployment workflows in this task.

Do not deploy production from Copilot.

## Validation

Before reporting implementation complete, run in the repository using Node.js 24:

```bash
npm ci
npm test
git diff --check
git status --short
```

All tests must pass.

Do not assume a fixed historical test count because this hotfix adds regression tests.

Review the diff and confirm there is no unrelated formatting, dependency update, audit fix, generated file, secret, or deployment change.

Do not run from the feature branch unless the developer explicitly requests it:

```bash
npm run deploy:test
npm run deploy:prd
```

Do not deploy anything as part of implementation.

## Expected implementation report

When finished, report:

1. files changed;
2. concise description of the region-resolution and client-caching behavior;
3. regression tests added;
4. exact validation commands run and results;
5. any assumptions or edge cases that remain;
6. confirmation that no deployment was performed.

Do not proceed into another task after completing this hotfix.
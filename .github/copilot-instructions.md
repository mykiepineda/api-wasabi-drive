# Wasabi Drive API - Copilot Instructions

## Project status

Wasabi Drive API is an existing production-working Node.js/Express API for browsing files stored in Wasabi Cloud Storage.

The structural refactor, Microsoft Entra identity migration, mandatory-authentication closure, legacy MongoDB authentication removal, and Wasabi storage migration to AWS SDK for JavaScript v3 are complete and production-validated.

Entra authentication is mandatory for protected API access. There is no supported configuration or rollback mode that disables Entra protection for `/buckets`.

Current modernization work is Phase 4: post-Entra security closure. The next approved backend task is authenticated/authorized temporary object access using short-lived Wasabi presigned GET URLs. Keep each task narrowly scoped and do not skip ahead unless explicitly requested.

The developer is the technical owner and architectural decision-maker. Copilot assists implementation and must not independently redesign the system.

## Branch and repository safety

- `master` is the protected integration/release branch.
- Never commit implementation changes directly to `master`.
- Work only in the current workspace and current branch. Do not create branches or worktrees unless explicitly instructed.
- Do not modify this instruction file unless the task explicitly authorizes it.
- Keep commits focused and reviewable.
- Avoid unrelated cleanup.
- Stop after the requested task; do not automatically continue to the next modernization task.

## Current architecture

Preserve these boundaries:

- `src/server.js` owns local HTTP startup and local `.env` loading.
- `src/app.js` constructs the Express application and Lambda handler.
- `src/config` parses values already present in `process.env`.
- `src/authentication/entraTokenVerifier.js` validates Entra access tokens.
- `src/authentication/requireEntraAccessToken.js` is the authentication boundary.
- `src/authentication/requireTrustedUser.js` is the application-authorization boundary.
- Bucket flow is `src/api/buckets.js` -> `src/service/buckets.js` -> `src/storage/wasabi.js` -> AWS SDK -> Wasabi.

Current runtime/deployment stack:

- Node.js 24;
- CommonJS;
- Express 4.22.x;
- Serverless Framework v4;
- AWS Lambda;
- API Gateway REST API;
- `serverless-http`;
- AWS SDK for JavaScript v3;
- Wasabi S3-compatible storage.

Do not migrate Express 5, ESM, TypeScript, API Gateway HTTP API, Terraform, CDK, Kong, or another deployment framework unless explicitly requested.

## Authentication and authorization

Approved identity flow:

React/MSAL
-> Microsoft Entra
-> OAuth 2.0 / OpenID Connect access token
-> API Gateway REST API
-> Express authentication
-> application authorization
-> Wasabi.

Authentication establishes that the bearer access token is valid for this API. Authorization separately establishes that the authenticated Entra principal is trusted to use Wasabi Drive.

The token verifier validates signature, tenant-specific issuer, API audience, expiry, required delegated scope, and explicitly allowed signing algorithm.

The verifier uses dynamic `import("jose")` for AWS Lambda Node.js 24 compatibility. Do not reintroduce runtime `require("jose")`.

The trusted-user boundary consumes verified `req.auth` claims and checks the expected tenant plus the configured Entra user Object ID (`oid`) allow-list.

Use:

- missing/invalid authentication -> `401`;
- authenticated but unauthorized -> `403`.

Do not decode the token again in authorization middleware. Do not use email address, username, frontend state, or API keys as application authorization.

## Mandatory fail-closed security

Required Entra variables:

- `ENTRA_TENANT_ID`;
- `ENTRA_API_CLIENT_ID`;
- `ENTRA_REQUIRED_SCOPE`;
- `ENTRA_TRUSTED_USER_OBJECT_IDS`.

There is no `ENTRA_AUTH_ENABLED` feature flag.

For every `/buckets` request:

1. valid Entra authentication is required;
2. trusted-user authorization is required;
3. missing or invalid required authentication/authorization configuration must fail closed.

`/auth` is not an application endpoint and must never be restored as an Entra fallback or rollback path.

API Gateway API keys are not user authentication. Do not reintroduce `X-Api-Key`, `private: true`, or API-key-required methods as authentication.

## Configuration and secrets

`src/server.js` loads local `.env` before requiring application/configuration modules.

`src/config` must not call `dotenv.config()` or load `.env`, `.env.test`, or `.env.prd`. Unit tests control `process.env`.

Serverless Framework v4 handles stage-specific dotenv loading for `.env.test` and `.env.prd` during deployment.

Wasabi configuration remains explicit:

- `WASABI_SERVICE_URL` is the full absolute HTTPS Wasabi S3 endpoint, for example `https://s3.ap-northeast-1.wasabisys.com`;
- `WASABI_REGION` is the corresponding Wasabi signing/storage region, for example `ap-northeast-1`;
- do not derive the region by parsing the endpoint;
- the endpoint and region must correspond to the same Wasabi region.

Never commit real Object IDs, bearer tokens, passwords, API keys, AWS credentials, Wasabi credentials, or other secrets.

Browser-visible values are not secrets. Wasabi credentials remain server-side.

## Legacy authentication removal

Legacy MongoDB/bcrypt/UUID authentication has been physically removed and must stay removed.

- `/auth` is not an application endpoint and must remain unavailable.
- MongoDB has no approved application/business purpose.
- Do not restore bcrypt, UUID-style legacy auth tokens, or a replacement database without a real persistence requirement.
- Preserve the regression proving `/auth` remains unavailable.
- Legitimate transitive `uuid` packages required by other dependencies are not legacy application authentication.

## Storage boundary and temporary object access

The Wasabi adapter uses AWS SDK for JavaScript v3 through `@aws-sdk/client-s3`.

Preserve the dependency direction:

HTTP / Express route
-> application/service layer
-> storage implementation
-> AWS SDK
-> Wasabi.

AWS SDK and presigning calls belong in `src/storage`. Do not place them directly in Express routes.

The approved next backend task adds short-lived presigned GET access to objects returned by the existing authenticated object-listing flow.

A presigned URL is a cryptographically signed temporary URL granting a specific storage operation for a limited time. It is a bearer capability: anyone possessing an unexpired URL can use the granted operation. Never log complete signed URLs.

For the initial implementation:

- preserve `GET /buckets/:Bucket/objects/:Prefix(*)`;
- preserve the existing Entra authentication and trusted-user authorization boundary;
- keep `wasabi.getListObjects()` as the storage listing operation;
- add a focused storage signing operation such as `getObjectAccessUrl({ Bucket, Key })`;
- use `GetObjectCommand` plus `@aws-sdk/s3-request-presigner` and the existing configured `S3Client`;
- enrich only the final page returned to the client: add `AccessUrl` to each item in `Contents` in the service layer after listing;
- do not add `AccessUrl` to `CommonPrefixes`;
- do not put presigning inside `getListObjects()`, because `getTotalKeyCount()` also calls that function while walking pages and must not generate unused URLs;
- use a fixed initial expiry of 3600 seconds;
- do not add a configuration setting for the expiry yet;
- do not perform `HeadObject` merely to generate a URL;
- if signing fails, surface the failure through the existing error path; never fall back to a raw public Wasabi URL;
- do not proxy file bytes through Lambda;
- do not add a CDN;
- do not make Wasabi objects private during this backend capability task;
- do not modify the frontend during this backend task.

The current frontend will ignore the additional `AccessUrl` property until the dedicated frontend task. This backend-first response enrichment preserves independent backend/frontend deployment.

Do not fix pagination, total-key counting, broad error handling, or unrelated storage behavior while adding presigned access.

## CORS

CORS means Cross-Origin Resource Sharing. It is a browser cross-origin policy, not authentication or authorization.

Current broad CORS behavior is deferred debt. Do not tighten CORS unless explicitly scoped.

## Testing

Authoritative unit regression:

`npm test`

Use Node.js 24.

Do not delete, skip, or weaken tests merely to make changes pass.

Preserve coverage around:

- Entra being mandatory with no disable/fallback path;
- token signature/issuer/audience/expiry/scope validation;
- `401` versus `403`;
- Lambda-compatible `jose` loading;
- trusted-user `oid`/tenant authorization;
- fail-closed required authentication configuration;
- `/auth` remaining unavailable;
- existing Wasabi listing and total-key-count behavior.

For presigned access, add focused tests around the storage signer and service enrichment. Use fake URLs/credentials only. Do not place complete real signed URLs or real credentials in fixtures or logs.

Safe integration regression:

`npm run test:integration`

Protected bucket requests use a short-lived Entra access token supplied at runtime through `INTEGRATION_ACCESS_TOKEN`. Never commit, persist, or log the token.

Bruno reports must continue suppressing request/response bodies and headers, and production-target guards must remain intact.

Do not automate username/password authentication to obtain Entra test tokens.

## Deployment safety

Do not deploy unless explicitly requested.

For material backend changes:

1. run unit tests;
2. deploy to `test` only when explicitly authorized;
3. run the Entra-aware Bruno regression against the deployed `test` API;
4. perform relevant functional checks;
5. deploy to `prd` only after explicit approval.

Entra authentication is mandatory in every deployed stage. Do not use disabling Entra as rollback. Roll back to a reviewed known-good application/deployment version while preserving the Entra security boundary.

Untracked local deployment files are `.env.test` and `.env.prd`.

Explicit deployment scripts:

- `npm run deploy:test`;
- `npm run deploy:prd`.

Do not add a generic deploy command that can silently target production.

AWS deployment credentials belong to the AWS credential provider chain/profile, not application dotenv files.

## Deferred work

Do not opportunistically implement outside the explicitly requested task:

- frontend migration to `AccessUrl` before its dedicated task;
- Wasabi bucket/object privacy cutover;
- CORS hardening;
- Wasabi pagination/performance fixes;
- custom-domain/CDN/file-proxy work for enterprise network compatibility;
- API Gateway REST -> HTTP API migration;
- Lambda authorizers;
- Express 5;
- ESM;
- TypeScript;
- Kong;
- CI/CD;
- broad dependency modernization.

Future CI/CD may use GitHub Actions, protected branches, automated tests/builds, test deployment, integration checks, controlled production approval, and GitHub OIDC for short-lived AWS credentials. OIDC means OpenID Connect. Do not implement CI/CD unless explicitly requested.

## Completion report

For every Copilot implementation task, report:

- current branch;
- commits created;
- files changed/deleted;
- behavior/configuration changed;
- baseline and final `npm test` results;
- `git diff --check` result;
- integration result when applicable;
- deployment performed, if explicitly authorized;
- confirmation that no secret/token or complete real signed URL was committed or logged;
- any issue directly relevant to the requested task;
- recommended next task.

Stop after the requested task.
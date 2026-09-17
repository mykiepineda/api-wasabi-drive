# Wasabi Drive API - Copilot Instructions

## Project status

Wasabi Drive API is an existing production-working Node.js/Express API for browsing files stored in Wasabi Cloud Storage.

The structural refactor and Microsoft Entra identity migration are complete and deployed to production.

Verified in production and AWS `test`:
- React/MSAL signs in through Microsoft Entra.
- The SPA sends a real OAuth 2.0 access token for the Wasabi Drive API.
- API Gateway passes requests without treating an API key as user authentication.
- Missing bearer token -> `401`.
- Invalid bearer token -> `401`.
- Valid token without required API scope -> `403`.
- Valid trusted Entra user -> normal bucket/folder/object behavior succeeds.
- Valid authenticated but untrusted Entra user -> `403`.
- Malformed trusted-user configuration fails closed.
- Legacy `/auth` is not mounted.
- API Gateway API keys and frontend `X-Api-Key` are no longer part of the protected request path.

Entra authentication is mandatory for the Wasabi Drive API. There is no supported configuration or rollback mode that disables Entra protection for `/buckets`.

The current modernization phase is post-Entra security closure. Keep each task narrowly scoped and do not skip ahead to later cleanup/storage tasks unless explicitly requested.

The developer is the technical owner and architectural decision-maker. Copilot assists implementation and does not independently redesign the system.

## Branch and repository safety

`master` is the protected integration/release branch.

Never commit implementation changes directly to `master`.

The developer creates focused branches manually and uses Copilot Chat in the normal workspace. Work only in the current workspace and current branch. Do not create another branch or worktree unless explicitly instructed.

Do not modify this instruction file unless the task explicitly authorizes it.

Do not automatically continue to another modernization task after completing the requested work.

Keep commits focused and reviewable. Avoid unrelated cleanup.

## Current architecture

Preserve these established boundaries:
- `src/server.js` owns local HTTP startup and local `.env` loading.
- `src/app.js` constructs the Express application and Lambda handler.
- `src/config` parses and validates values already present in `process.env`.
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

Authentication establishes that the bearer token is valid for this API.

Authorization separately establishes that the authenticated Entra principal is trusted to use Wasabi Drive.

The token verifier validates:
- signature;
- tenant-specific issuer;
- API audience;
- expiry;
- required delegated scope;
- explicitly allowed signing algorithm.

The verifier uses dynamic `import("jose")` for AWS Lambda Node.js 24 compatibility. Do not reintroduce runtime `require("jose")`.

The trusted-user boundary consumes verified `req.auth` claims and checks the expected tenant plus the configured Entra user Object ID (`oid`) allow-list.

Use:
- missing/invalid authentication -> `401`;
- authenticated but not authorized -> `403`.

Do not decode the token again in authorization middleware.

Do not use email address, username, frontend state, or API keys as application authorization.

## Configuration

Required Entra variables:
- `ENTRA_TENANT_ID`;
- `ENTRA_API_CLIENT_ID`;
- `ENTRA_REQUIRED_SCOPE`;
- `ENTRA_TRUSTED_USER_OBJECT_IDS`.

There is no `ENTRA_AUTH_ENABLED` feature flag. Entra authentication must never fail open or be disabled through configuration.

For every `/buckets` request:
- valid Entra authentication is required first;
- trusted-user authorization is required second;
- missing/invalid required auth configuration must fail closed;
- legacy `/auth` is not mounted.

Real Object IDs, tokens, passwords, API keys, AWS credentials, Wasabi credentials, MongoDB credentials, and other secrets must not be committed.

## Local dotenv behavior

The dotenv/test-isolation fix is complete.

`src/server.js` loads local `.env` before requiring the application/configuration modules.

`src/config` must not call `dotenv.config()` or load `.env`, `.env.test`, or `.env.prd`.

Unit tests control `process.env`.

Serverless Framework v4 handles stage-specific dotenv loading for `.env.test` and `.env.prd` during deployment.

Do not reintroduce dotenv loading into `src/config`.

## Legacy authentication

Legacy MongoDB/bcrypt/UUID authentication remains physically present only as deletion-only legacy code. It is not part of the active production authentication path and `/auth` is not mounted.

Do not improve, extend, or restore the legacy auth architecture. Do not use it as rollback for Entra authentication.

Its approved next cleanup task is to remove legacy `/auth`, MongoDB, bcrypt, UUID, related environment values, related dependencies, and obsolete Bruno legacy-auth requests if no other persistence requirement exists.

Do not add a replacement database without a real business persistence requirement.

## API Gateway and API key

API Gateway API keys are not user authentication.

The clean `test` stack does not require an API key for protected proxy methods.

The frontend no longer sends `X-Api-Key`, and API Gateway API keys are not required for the application request path.

Do not reintroduce `X-Api-Key`, `private: true`, or API-key-required methods as authentication.

## CORS

CORS means Cross-Origin Resource Sharing. It is a browser cross-origin policy, not authentication or authorization.

Current broad CORS behavior is deferred debt.

Do not tighten CORS unless explicitly scoped. CORS is not an authentication control.

## Testing

Standard unit regression:
`npm test`

Use Node.js 24 for authoritative backend test results.

Do not delete, skip, or weaken tests merely to make changes pass.

Preserve coverage around:
- Entra enforcement flag behavior;
- token signature/issuer/audience/expiry/scope validation;
- `401` versus `403`;
- Lambda-compatible `jose` loading;
- trusted-user `oid`/tenant authorization;
- fail-closed trusted-user configuration;
- `/auth` mounted only when Entra enforcement is disabled.

The safe Bruno integration regression command is:
`npm run test:integration`

The current Bruno collection was created before Entra enforcement and must be aligned before production:
- protected bucket requests must support a runtime-provided Entra access token;
- no bearer token may be committed;
- test reports must continue skipping headers and bodies;
- production-target guards must remain intact;
- legacy `/auth` requests must not remain part of the normal protected `test` regression when `/auth` is intentionally unmounted.

Do not build automated username/password handling for Microsoft Entra merely to obtain a test token.

A short-lived access token may be supplied at runtime through an environment variable for the manual pre-production regression workflow.

Do not persist or log that token.

## Deployment safety

Do not deploy unless explicitly requested.

Use `test` before `prd` for material backend changes. Run unit tests first, then the Entra-aware Bruno integration regression against the deployed `test` API before production deployment.

Entra authentication is mandatory in every deployed stage. Do not use disabling Entra as rollback. Roll back with a reviewed known-good application/deployment version while preserving the Entra security boundary.

Do not deliberately configure an untrusted Object ID in production merely to retest `403`; that behavior is already proven in `test`.

## Stage-specific deployment

Untracked local backend deployment files:
- `.env.test`;
- `.env.prd`.

Explicit scripts:
- `npm run deploy:test`;
- `npm run deploy:prd`.

Do not add a generic deploy command that can silently target production.

Shell/process environment variables may override stage dotenv values.

AWS deployment credentials belong to the AWS credential provider chain/profile, not application dotenv files.

## Current known deferred work

Do not opportunistically implement outside the explicitly requested Phase 4 task:
- legacy MongoDB/bcrypt/UUID physical removal until the dedicated cleanup task;
- CORS hardening;
- bucket pagination/performance changes;
- API Gateway REST -> HTTP API migration;
- Kong;
- CI/CD;
- broad dependency modernization.

Approved later Phase 4 work, in separate focused branches, is:
- migrate the Wasabi storage adapter from AWS SDK for JavaScript v2 to v3 while preserving the existing storage boundary;
- add backend-authorized short-lived presigned object URLs;
- move object storage to private access after compatible backend/frontend changes are validated.

Do not place AWS SDK calls directly in Express routes, do not proxy file bytes through Lambda by default, and do not introduce a CDN without a concrete requirement.

## Future CI/CD

CI/CD is not yet implemented.

Future direction is likely GitHub Actions with protected branches, automated unit/build checks, test deployment, integration regression, controlled production approval, and GitHub OIDC for short-lived AWS credentials.

OIDC means OpenID Connect.

Do not implement CI/CD unless explicitly requested.

## Completion report

For every Copilot task report:
- current branch;
- commits created;
- files changed;
- behavior/configuration changed;
- baseline/final tests;
- `git diff --check`;
- integration result when applicable;
- deployment performed, if explicitly authorized;
- confirmation no secret/token was committed;
- remaining issue directly relevant to the task;
- recommended next task.

Stop after the requested task.
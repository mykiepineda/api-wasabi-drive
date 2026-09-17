# Wasabi Drive API - Copilot Instructions

## Project status

Wasabi Drive API is an existing production-working Node.js/Express API for browsing files stored in Wasabi Cloud Storage.

The structural refactor and Microsoft Entra identity migration are complete and deployed. Entra authentication is mandatory for protected API access; there is no supported configuration or rollback mode that disables Entra protection for `/buckets`.

Current modernization work is Phase 4: post-Entra security closure. Keep each task narrowly scoped and do not skip ahead unless explicitly requested.

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

`/auth` is not part of the active application and must never be restored as an Entra fallback or rollback path.

API Gateway API keys are not user authentication. Do not reintroduce `X-Api-Key`, `private: true`, or API-key-required methods as authentication.

## Configuration and secrets

`src/server.js` loads local `.env` before requiring application/configuration modules.

`src/config` must not call `dotenv.config()` or load `.env`, `.env.test`, or `.env.prd`. Unit tests control `process.env`.

Serverless Framework v4 handles stage-specific dotenv loading for `.env.test` and `.env.prd` during deployment.

Never commit real Object IDs, bearer tokens, passwords, API keys, AWS credentials, Wasabi credentials, MongoDB credentials, or other secrets.

Browser-visible values are not secrets. Wasabi credentials remain server-side.

## Legacy authentication cleanup

Legacy MongoDB/bcrypt/UUID authentication is deletion-only code and has no remaining approved application/business purpose.

Until its dedicated cleanup task is complete:

- do not improve, extend, repair, or restore it;
- do not use it as rollback for Entra authentication;
- do not add a replacement database.

The approved cleanup removes the legacy `/auth` implementation, MongoDB code/configuration, bcrypt password utilities, UUID token generation, obsolete legacy-auth tests/Bruno requests, and direct dependencies that are no longer used.

After physical deletion, preserve a regression proving `/auth` remains unavailable.

When removing direct dependencies, do not try to remove legitimate transitive copies required by other packages.

## Storage boundary and later Phase 4 work

The current Wasabi adapter still uses AWS SDK for JavaScript v2. A later, separate task will migrate the adapter to AWS SDK v3 while preserving API behavior and the existing storage boundary.

A later task will add backend-authorized short-lived presigned object URLs so Wasabi objects can become private. A presigned URL is a cryptographically signed temporary URL granting a specific storage operation for a limited time.

Do not implement either change unless explicitly requested.

Do not place AWS SDK calls directly in Express routes. Do not proxy file bytes through Lambda by default. Do not introduce a CDN without a concrete requirement.

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
- fail-closed required configuration;
- `/auth` remaining unavailable.

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
4. deploy to `prd` only after explicit approval.

Entra authentication is mandatory in every deployed stage. Do not use disabling Entra as rollback. Roll back to a reviewed known-good application/deployment version while preserving the Entra security boundary.

Untracked local deployment files are `.env.test` and `.env.prd`.

Explicit deployment scripts:

- `npm run deploy:test`;
- `npm run deploy:prd`.

Do not add a generic deploy command that can silently target production.

AWS deployment credentials belong to the AWS credential provider chain/profile, not application dotenv files.

## Deferred work

Do not opportunistically implement outside the explicitly requested task:

- CORS hardening;
- Wasabi pagination/performance fixes;
- presigned object access before its dedicated task;
- bucket privacy changes;
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
- confirmation that no secret/token was committed;
- any issue directly relevant to the requested task;
- recommended next task.

Stop after the requested task.
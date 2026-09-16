# Wasabi Drive API - Copilot Instructions

## Project status

Wasabi Drive API is an existing production-working Node.js/Express API for browsing files stored in Wasabi Cloud Storage.

The structural refactor and the pre-production Microsoft Entra identity migration are complete in source.

Verified in AWS `test`:
- React/MSAL signs in through Microsoft Entra.
- The SPA sends a real OAuth 2.0 access token for the Wasabi Drive API.
- API Gateway passes requests without treating an API key as user authentication.
- Missing bearer token -> `401`.
- Invalid bearer token -> `401`.
- Valid token without required API scope -> `403`.
- Valid trusted Entra user -> normal bucket/folder/object behavior succeeds.
- Valid authenticated but untrusted Entra user -> `403`.
- Malformed trusted-user configuration fails closed.
- Legacy `/auth` is not mounted while Entra enforcement is enabled.

Production has not yet been cut over to Entra enforcement.

The current backend objective is NOT further application refactoring. The immediate task before production cutover is to align the Bruno integration regression with the now-protected Entra API, then perform controlled production deployment and verification.

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

Current Entra variables:
- `ENTRA_AUTH_ENABLED`;
- `ENTRA_TENANT_ID`;
- `ENTRA_API_CLIENT_ID`;
- `ENTRA_REQUIRED_SCOPE`;
- `ENTRA_TRUSTED_USER_OBJECT_IDS`.

`ENTRA_AUTH_ENABLED` remains strict:
- absent -> disabled;
- `"false"` -> disabled;
- `"true"` -> enabled;
- any other explicit value -> configuration error.

When Entra enforcement is enabled:
- `/buckets` requires valid Entra authentication;
- trusted-user authorization is then required;
- missing/invalid required auth configuration fails closed;
- `/auth` is not mounted.

When Entra enforcement is disabled:
- `/buckets` preserves temporary compatibility behavior;
- legacy `/auth` remains mounted for rollback compatibility until production cutover is proven.

Real Object IDs, tokens, passwords, API keys, AWS credentials, Wasabi credentials, MongoDB credentials, and other secrets must not be committed.

## Local dotenv behavior

The dotenv/test-isolation fix is complete.

`src/server.js` loads local `.env` before requiring the application/configuration modules.

`src/config` must not call `dotenv.config()` or load `.env`, `.env.test`, or `.env.prd`.

Unit tests control `process.env`.

Serverless Framework v4 handles stage-specific dotenv loading for `.env.test` and `.env.prd` during deployment.

Do not reintroduce dotenv loading into `src/config`.

## Legacy authentication

Legacy MongoDB/bcrypt/UUID authentication remains physically present only for temporary rollback compatibility while production Entra cutover is incomplete.

When `ENTRA_AUTH_ENABLED=true`, `/auth` is intentionally not mounted.

Do not improve the legacy auth architecture.

Do not remove MongoDB/bcrypt/UUID in the pre-cutover integration-test task.

After successful production Entra cutover, remove legacy `/auth`, MongoDB, bcrypt, UUID, related environment values, related dependencies, and obsolete Bruno legacy-auth requests if no other persistence requirement exists.

Do not add a replacement database without a real business persistence requirement.

## API Gateway and API key

API Gateway API keys are not user authentication.

The clean `test` stack does not require an API key for protected proxy methods.

The frontend still sends transitional `X-Api-Key` during production compatibility rollout.

Do not reintroduce `private: true` or API-key-required methods as part of identity work.

Before production backend cutover, inspect CloudFormation drift for the production stack. Do not delete/recreate production as a routine cutover step.

Removal of `X-Api-Key` and any API Gateway usage-plan/API-key cleanup are separate post-cutover tasks.

## CORS

CORS means Cross-Origin Resource Sharing. It is a browser cross-origin policy, not authentication or authorization.

Current broad CORS behavior remains transitional during cutover.

Do not tighten CORS during the Bruno integration-test alignment or production identity cutover unless explicitly scoped.

Post-cutover CORS hardening should allow only required frontend origins and headers after the production identity path is stable.

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

Use `test` before `prd`.

The application-refactoring phase is complete. The intended cutover sequence is:
1. align and pass the protected Bruno regression in `test`;
2. run local backend unit tests and frontend test/build gates;
3. run production CloudFormation drift detection and review any drift;
4. verify production frontend build-time configuration;
5. deploy the Entra-enabled frontend to Firebase while production backend Entra enforcement remains disabled;
6. verify production frontend compatibility;
7. enable Entra authentication + trusted-user authorization in `.env.prd`;
8. deploy backend `prd`;
9. verify trusted production access, `401` behavior, and `/auth` not-found behavior;
10. retain rollback by setting `ENTRA_AUTH_ENABLED=false` and redeploying until the cutover is considered stable.

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

Do not opportunistically implement before production cutover:
- legacy MongoDB/bcrypt/UUID physical removal;
- `X-Api-Key` removal;
- API Gateway usage-plan cleanup;
- CORS hardening;
- AWS SDK v2 -> v3 migration;
- bucket pagination/performance changes;
- API Gateway REST -> HTTP API migration;
- Kong;
- CI/CD;
- broad dependency modernization.

The frontend currently opens Wasabi object URLs directly. Whether object content itself must be protected by Entra is an explicit architecture/security requirement decision, not something to silently redesign during cutover.

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
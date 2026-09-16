# Wasabi Drive API - Copilot Instructions

## Project status and current goal

Wasabi Drive API is an existing production-working Node.js/Express API for
browsing files stored in Wasabi Cloud Storage.

The structural refactor, production deployment baseline, Microsoft Entra
authentication implementation, and trusted-user authorization implementation are
complete.

The current phase is **pre-production identity-cutover hardening**.

Verified in AWS `test`:

- the React SPA signs in with Microsoft Entra through MSAL;
- the SPA sends a real OAuth 2.0 access token for the Wasabi Drive API;
- API Gateway passes protected requests to Lambda/Express without requiring an
  API key as user authentication;
- missing bearer token -> `401`;
- invalid bearer token -> `401`;
- valid token from the trusted Entra user -> existing bucket/folder/object
  behavior succeeds;
- valid authenticated user whose `oid` is not in the trusted-user allow-list ->
  `403`;
- trusted-user authorization is therefore proven end-to-end in AWS `test`.

Production has not yet been cut over to Entra enforcement.

The immediate backend work is limited to pre-production hardening that preserves
compatibility and rollback:

1. isolate local `.env` loading from the general configuration boundary so unit
   tests control `process.env` deterministically;
2. stop exposing the legacy `/auth` router when Entra enforcement is enabled,
   while preserving it when enforcement is disabled for temporary production
   compatibility and rollback.

Do not broaden these tasks into legacy-auth redesign, MongoDB cleanup, CORS
hardening, API Gateway migration, Kong adoption, or dependency modernization.

The developer is the technical owner and architectural decision-maker. Copilot
assists implementation; it does not independently redesign the system.

## Branch and repository safety

`master` is the protected integration/release branch.

Never commit implementation changes directly to `master`.

The developer creates the branch manually before using Copilot Chat. Work only
in the current workspace and current branch. Do not create another branch or
worktree unless explicitly instructed.

Keep branches focused, for example:

- `fix/isolate-local-dotenv-loading`;
- `fix/disable-legacy-auth-when-entra-enabled`;
- later cleanup branches only when explicitly requested.

Do not modify this instruction file unless the task explicitly authorizes it.

Do not automatically continue to another modernization task after completing
an approved task.

## Current architecture

Preserve these established boundaries:

- `src/server.js` owns local HTTP startup;
- `src/app.js` constructs the Express application and Lambda handler;
- `src/config` interprets application configuration;
- `src/authentication/entraTokenVerifier.js` validates Entra access tokens;
- `src/authentication/requireEntraAccessToken.js` is the authentication
  middleware boundary;
- `src/authentication/requireTrustedUser.js` is the application-authorization
  middleware boundary;
- bucket flow is:
  `src/api/buckets.js` -> `src/service/buckets.js` -> `src/storage/wasabi.js` ->
  AWS SDK -> Wasabi.

Current runtime/deployment stack:

- Node.js 24;
- CommonJS;
- Express 4.22.x;
- Serverless Framework v4;
- AWS Lambda;
- API Gateway REST API;
- `serverless-http`;
- Wasabi S3-compatible storage.

Do not migrate Express 5, ESM, TypeScript, API Gateway HTTP API, Terraform, CDK,
Kong, or another deployment framework unless explicitly requested.

## Authentication and authorization

Approved identity flow:

React/MSAL
-> Microsoft Entra
-> OAuth 2.0 / OpenID Connect access token
-> API Gateway REST API
-> Express authentication
-> application authorization
-> Wasabi.

Authentication and authorization are separate:

- authentication establishes that the bearer token is valid for this API;
- authorization establishes that the authenticated Entra principal is trusted
  to use Wasabi Drive.

The token verifier currently validates:

- signature;
- tenant-specific issuer;
- audience;
- expiry;
- required delegated scope;
- explicitly allowed signing algorithm.

The verifier loads `jose` through cached dynamic `import()` for AWS Lambda
Node.js 24 compatibility. Do not reintroduce runtime `require("jose")`.

The trusted-user boundary consumes verified `req.auth` claims and checks the
expected tenant plus a configured allow-list of Entra user Object IDs (`oid`).

Use correct HTTP semantics:

- missing/invalid authentication -> `401`;
- authenticated but not application-authorized -> `403`.

Do not decode the bearer token again in authorization middleware.

Do not use email address, username, display name, frontend state, or the legacy
API key as application authorization.

## Current Entra configuration

Current configuration names:

- `ENTRA_AUTH_ENABLED`;
- `ENTRA_TENANT_ID`;
- `ENTRA_API_CLIENT_ID`;
- `ENTRA_REQUIRED_SCOPE`;
- `ENTRA_TRUSTED_USER_OBJECT_IDS`.

`ENTRA_AUTH_ENABLED` semantics must remain strict:

- absent -> disabled;
- `"false"` -> disabled;
- `"true"` -> enabled;
- any other explicit value -> configuration error.

When Entra enforcement is enabled:

- `/buckets` requires valid Entra authentication;
- `/buckets` then requires trusted-user authorization;
- missing/invalid trusted-user authorization configuration fails closed.

When Entra enforcement is disabled, compatibility behavior must remain usable
until production cutover is complete.

Real Object IDs, tokens, credentials, passwords, API keys, and secrets must not
be committed.

## Local dotenv and configuration boundary

The current code still calls `dotenv.config()` inside `src/config/index.js`.
That is a known pre-production issue because unit tests deliberately manipulate
`process.env`, and requiring the config module can repopulate deleted values
from a developer's local `.env` file.

Approved correction:

- `src/config` should parse/validate values already present in `process.env`;
- `src/server.js` should load local `.env` before requiring application/config
  modules;
- unit tests should control their own process environment without being
  silently repopulated from `.env`;
- Serverless v4 remains responsible for stage-specific dotenv behavior during
  deployment;
- AWS Lambda runtime configuration comes from Lambda environment variables.

Do not introduce stage-selection magic into application code.

Do not make `src/config` load `.env.test` or `.env.prd` directly.

## Legacy `/auth` compatibility containment

The legacy MongoDB/bcrypt/UUID authentication path is scheduled for removal,
but production has not yet completed the Entra cutover.

Current legacy endpoints under `/auth` include user-management and password
validation behavior. They must not remain publicly mounted once Entra is the
active security boundary.

Approved temporary containment behavior:

- when `ENTRA_AUTH_ENABLED=false`, keep `/auth` mounted for migration
  compatibility and rollback;
- when `ENTRA_AUTH_ENABLED=true`, do not mount the legacy `/auth` router;
- requests to `/auth/...` in the Entra-enabled state should therefore receive
  normal not-found behavior rather than being routed to legacy MongoDB auth;
- do not spend effort adding Entra authorization to endpoints that are planned
  for deletion.

Do not remove MongoDB, bcrypt, UUID, or the legacy auth implementation in the
same containment PR. Their physical removal is a later cleanup after successful
production Entra cutover.

## API Gateway and API key

The rebuilt AWS `test` stack no longer requires an API key on `/{proxy+}`.
API Gateway API keys are not user authentication.

The frontend may still send the transitional `X-Api-Key` header until the
production compatibility path is verified and any production usage-plan/drift
questions are resolved.

Do not reintroduce `private: true` or API-key-required methods during these
hardening tasks.

Before production cutover, run CloudFormation drift detection against the
production stack. Do not delete/recreate production as a routine cutover step.

## CORS

CORS means Cross-Origin Resource Sharing. It controls which browser origins may
read cross-origin responses; it is not authentication or authorization.

Current broad CORS behavior remains transitional during the identity cutover.
Do not tighten CORS in the dotenv-isolation or legacy-auth-containment tasks.

CORS hardening should be a later, separately tested change after production
identity cutover is stable.

## Stage-specific environment and deployment

Serverless Framework v4 uses native stage-specific dotenv loading.

Local deployment files:

- `.env.test`;
- `.env.prd`.

They are untracked.

Explicit deployment scripts:

- `npm run deploy:test`;
- `npm run deploy:prd`.

Do not reintroduce a generic deployment command that can silently target
production.

Shell/process environment values may override `.env.<stage>` values.

AWS deployment credentials do not belong in application dotenv files.

## Testing gates

Backend regression gate:

`npm test`

Use Node.js 24, matching `package.json` engines.

For each task:

1. run `npm ci` if dependencies are not already in a trustworthy state;
2. run the baseline test suite before the change where practical;
3. implement the smallest scoped change;
4. run `npm test` again;
5. run `git diff --check`;
6. inspect the complete diff.

Do not weaken or skip tests merely to make a change pass.

For local dotenv isolation, tests must prove that a developer `.env` containing
`ENTRA_AUTH_ENABLED=true` cannot silently change tests intended to exercise an
absent/disabled environment.

For legacy `/auth` containment, add application-level coverage proving:

- Entra disabled -> legacy `/auth` remains mounted;
- Entra enabled -> legacy `/auth` is not mounted;
- protected `/buckets` behavior remains unchanged;
- authentication executes before trusted-user authorization.

Do not make tests call live Microsoft Entra, JWKS, AWS, MongoDB, or Wasabi.

The safe Bruno integration regression is normally:

`npm run test:integration`

Keep production-target guards intact. Do not commit bearer tokens.

## Deployment safety

Do not deploy unless the task explicitly authorizes deployment.

For material backend changes, use `test` before `prd`.

The current production backend is not yet considered cut over to Entra solely
because the test stage is proven.

Pre-production sequence is:

- complete backend hardening;
- deploy/validate backend hardening in `test`;
- complete frontend authentication/error-handling hardening;
- verify the production frontend build configuration;
- run production CloudFormation drift detection;
- then plan the controlled production rollout.

Keep a rollback path based on `ENTRA_AUTH_ENABLED=false` until production Entra
behavior is proven.

## Legacy MongoDB authentication freeze

Do not improve the legacy MongoDB/password/UUID architecture.

Do not opportunistically fix:

- MongoDB user CRUD;
- UUID token semantics;
- password account-management behavior;
- refresh behavior;
- MongoDB connection architecture.

Only change the legacy path to contain an immediate exposure or preserve
cutover compatibility.

After successful production Entra cutover, remove the legacy `/auth` code,
bcrypt, UUID authentication, and MongoDB if no remaining business persistence
requirement exists.

Do not add a replacement database without a real persistence requirement.

## Known deferred technical debt

Do not opportunistically fix these during current pre-production hardening:

- Wasabi total-key pagination loses `Prefix` on subsequent pages;
- total-key counting performs expensive full pagination scans;
- AWS SDK for JavaScript v2 is end-of-support;
- route-local error handling is inconsistent;
- request validation is limited;
- observability is minimal;
- API Gateway REST -> HTTP API may later be evaluated;
- Kong may later be evaluated as a learning/architecture spike;
- CI/CD is not yet automated;
- broad CORS is transitional;
- browser-visible `X-Api-Key` remains transitional compatibility debt.

The trusted-user Object-ID parser currently accepts standard UUID-version-style
GUIDs. Do not change that parser during unrelated hardening unless a real Entra
identifier is rejected or a separately approved robustness task requires it.

## Future CI/CD

CI/CD is not yet implemented.

Future direction is likely GitHub Actions with branch protection, automated
unit/build checks, test deployment, integration checks, controlled production
approval, and GitHub OIDC for short-lived AWS credentials.

Do not implement CI/CD unless explicitly requested.

## Dependency discipline

Do not run broad dependency upgrades.

Do not run `npm audit fix` or `npm audit fix --force` as incidental cleanup.

No new runtime dependency is expected for the current hardening tasks.

## Completion report

For each implementation task report:

- current branch;
- commits created;
- files changed;
- configuration changed;
- behavior intentionally changed;
- baseline/final `npm test` result;
- `git diff --check` result;
- integration-test result when applicable;
- deployment performed, if explicitly authorized;
- confirmation that unrelated architecture was not changed;
- remaining issue directly relevant to the task;
- recommended next task.

Stop when the requested task is complete.
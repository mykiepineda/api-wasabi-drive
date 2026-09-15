# Wasabi Drive API - Copilot Instructions

## Project status and current goal

Wasabi Drive API is an existing production-working Node.js/Express API for
browsing files stored in Wasabi Cloud Storage.

The structural-refactoring and initial production-deployment phases are complete.

The current modernization phase is:

**Microsoft Entra identity and API authorization migration.**

The following Entra milestones are now complete:

- backend Entra access-token validation foundation is implemented;
- compatibility-controlled `/buckets` authentication enforcement is implemented;
- the React SPA uses Microsoft Entra/MSAL and obtains an API access token for
  the Wasabi Drive API;
- the AWS `test` stage has been rebuilt cleanly from Serverless/CloudFormation;
- `/buckets` in `test` now requires Entra authentication;
- missing bearer token -> `401`;
- invalid bearer token -> `401`;
- a real Microsoft Entra access token from the SPA has been validated
  successfully by the backend in AWS `test`;
- authenticated bucket/folder/object browsing works end-to-end against the
  protected `test` API.

The immediate backend objective is now:

**introduce the smallest application-level trusted-user authorization layer.**

Authentication is already proven. The next question is whether the
authenticated Entra principal is one of the users explicitly allowed to use
Wasabi Drive.

Do not broaden the task into unrelated modernization.

The developer is the technical owner and architectural decision-maker.
Copilot assists implementation; it does not independently redesign the system.

## Branch and repository safety

`master` is the protected integration/release branch.

Never commit implementation changes directly to `master`.

Use a focused task branch appropriate to the requested task, for example:

- `feature/trusted-user-authorization`;
- `test/entra-authorization`;
- `cleanup/remove-legacy-auth`;
- `cleanup/remove-mongodb`.

VS Code/Copilot Agent worktrees may use an `agents/...` branch. That is
acceptable as long as the branch remains focused and changes reach `master`
through a pull request.

Keep each branch limited to one reviewable responsibility.

Do not automatically continue to another modernization task after completing
the requested work.

Do not make unrelated formatting, cleanup, dependency, or architectural
changes.

## Current architecture

Preserve these established boundaries unless a task explicitly changes them:

- `src/server.js` owns local HTTP startup.
- `src/app.js` constructs the Express application and Lambda handler.
- `src/config` is the application configuration boundary.
- `src/authentication/entraTokenVerifier.js` validates Entra access tokens.
- `src/authentication/requireEntraAccessToken.js` is the Express authentication
  middleware boundary.
- Bucket flow is:

  `src/api/buckets.js`
  -> `src/service/buckets.js`
  -> `src/storage/wasabi.js`
  -> AWS SDK
  -> Wasabi.

- AWS/Wasabi SDK calls belong in the storage/infrastructure layer.
- Application services should not depend directly on Express `req`/`res`.
- Prefer a modular monolith and small explicit boundaries.
- Do not introduce speculative provider factories, dependency-injection
  frameworks, microservices, abstract base classes, or repository layers.

Current supported runtime/deployment stack:

- Node.js 24;
- CommonJS;
- Express 4.22.x;
- Serverless Framework v4;
- AWS Lambda;
- API Gateway REST API;
- `serverless-http`.

Do not migrate Express 5, ESM, TypeScript, API Gateway HTTP API, Terraform,
CDK, Kong, or another deployment framework unless explicitly requested.

## Current Entra authentication state

The approved identity flow is:

React/MSAL
-> Microsoft Entra
-> OAuth 2.0 / OpenID Connect access token
-> API Gateway REST API
-> Express authentication middleware
-> application authorization
-> Wasabi services.

The React SPA uses the OAuth 2.0 / OpenID Connect authorization-code flow with
PKCE through MSAL.

PKCE means Proof Key for Code Exchange. It protects the authorization-code
exchange for public browser clients that cannot safely hold a client secret.

The SPA is a public client and must never contain an Entra client secret.

The Wasabi Drive backend is an OAuth resource server. It validates access
tokens and does not require an Entra client secret merely to perform token
validation.

The backend token verifier validates:

- cryptographic signature;
- tenant-specific issuer;
- API audience;
- expiration;
- required delegated API scope;
- an explicitly allowed signing algorithm.

It rejects otherwise valid signed tokens that do not contain an expiry.

The verifier loads `jose` through dynamic `import()` for compatibility with the
AWS Lambda Node.js 24 runtime. Do not reintroduce runtime `require("jose")`.

Do not weaken token-validation checks.

Do not use an ID token as API authorization.

Do not use API Gateway API keys as user authentication.

Do not add a Lambda authorizer during the current migration unless a separate
approved task explicitly requires it.

Bearer-token authentication is enforced at the existing Express boundary when:

`ENTRA_AUTH_ENABLED=true`

## Authentication versus authorization

Authentication establishes who the caller is.

Authorization separately determines whether that authenticated principal is
allowed to use Wasabi Drive.

Authentication has now been proven end-to-end in AWS `test`.

The next approved authorization model is intentionally simple:

1. authenticate the Entra access token;
2. read the authenticated principal from `req.auth`;
3. require the expected Entra tenant;
4. require a stable Entra user Object ID (`oid`);
5. allow access only when that Object ID is present in an environment-configured
   trusted-user allow-list.

Use the Entra `oid` claim as the stable user identifier.

Do not use email address, username, display name, or frontend state as an
authorization key.

The `oid` claim is tenant-local. Pair authorization conceptually with the
configured tenant (`tid` / `ENTRA_TENANT_ID`).

The existing tenant-specific issuer validation already provides an important
tenant boundary, but application authorization should fail closed if required
identity claims needed for authorization are absent or inconsistent.

Use correct HTTP semantics:

- missing/invalid authentication -> `401`;
- authenticated principal lacking required application authorization -> `403`.

Do not return `401` merely because a valid authenticated user is not trusted.

## Approved trusted-user authorization model

Use a simple environment-configured allow-list.

Approved configuration name:

`ENTRA_TRUSTED_USER_OBJECT_IDS`

The value may contain one or more Entra user Object IDs separated by commas.

Example shape only:

`ENTRA_TRUSTED_USER_OBJECT_IDS=guid-one,guid-two`

Do not put real user Object IDs into tracked example/configuration files unless
explicitly approved. Use placeholders in `.env.example`.

Parse the list centrally through the existing configuration boundary.

Recommended normalization:

- trim surrounding whitespace;
- ignore accidental surrounding whitespace between comma-separated entries;
- compare Object IDs case-insensitively;
- represent parsed IDs as a small immutable/read-only collection where
  practical.

Do not add a database for this allow-list.

Do not call Microsoft Graph merely to determine whether a user is trusted.

Do not introduce Entra groups, application roles, RBAC frameworks, policy
engines, organization models, or tenant-management abstractions unless a later
requirement justifies them.

RBAC means Role-Based Access Control.

## Trusted-user middleware boundary

Keep authentication and application authorization separate.

The intended request pipeline for protected storage routes is:

`requireEntraAccessToken`
-> `requireTrustedUser`
-> existing `/buckets` router
-> service
-> Wasabi storage.

The trusted-user authorization middleware should consume already-verified
identity information from `req.auth`.

It must not:

- decode the raw bearer token again;
- independently fetch signing keys;
- repeat JWT signature validation;
- trust frontend-provided identity fields;
- read authorization identity from query/body/header values supplied by the
  caller.

The backend remains the security authority.

## Authorization configuration and fail-closed behavior

When `ENTRA_AUTH_ENABLED=false`, the existing compatibility behavior remains
unchanged.

When `ENTRA_AUTH_ENABLED=true`, trusted-user authorization must not silently
fall back to allowing every authenticated user.

If the trusted-user allow-list required for authorization is absent, empty, or
invalid while Entra enforcement is enabled, fail closed.

Prefer clear startup/configuration failure over silently exposing authenticated
storage access to unintended users.

Do not make missing trusted-user configuration block application startup when
`ENTRA_AUTH_ENABLED=false`.

Do not introduce a second feature flag merely to avoid configuring the trusted
user allow-list unless an explicit migration requirement justifies it.

## Authorization claim behavior

For an authenticated token reaching trusted-user authorization:

- missing `oid` -> `403`;
- `oid` not in the configured trusted-user allow-list -> `403`;
- missing/inconsistent tenant identity required by the approved design -> fail
  authorization;
- trusted `oid` in the expected tenant -> continue to `/buckets`.

Do not expose the configured allow-list in API responses.

Do not reveal whether a particular Object ID is trusted in detailed client
error messages.

A generic forbidden response is appropriate.

Do not log access tokens.

If authorization logging is later needed, log only safe metadata and avoid
sensitive token contents.

## Compatibility-controlled backend enforcement

Current backend bearer enforcement is controlled by:

`ENTRA_AUTH_ENABLED`

Required semantics are:

- absent -> disabled;
- `"false"` -> disabled;
- `"true"` -> enabled;
- any other explicitly supplied value -> configuration error.

Do not rely on JavaScript truthiness for security-sensitive environment
switches.

When enforcement is disabled:

- `/buckets` preserves compatibility behavior;
- missing Entra/trusted-user configuration must not unnecessarily prevent the
  application from starting.

When enforcement is enabled:

- `/buckets` requires the existing Entra authentication middleware;
- application authorization must then require a trusted user;
- missing/invalid auth -> `401`;
- authenticated but untrusted -> `403`;
- trusted authenticated user -> existing bucket behavior.

Do not protect `/auth` as part of the trusted-user authorization task.

Do not remove legacy authentication, MongoDB, or transitional frontend
compatibility in the same PR.

## Frontend/backend compatibility checkpoint

The Entra-enabled frontend currently sends:

`Authorization: Bearer <access-token>`

and may continue to send:

`X-Api-Key: <existing compatibility value>`

during the transition.

The rebuilt AWS `test` API no longer relies on API Gateway API-key enforcement
for the protected route.

Do not treat `X-Api-Key` as authentication.

Do not remove the frontend compatibility header during an unrelated backend
authorization task.

Its eventual removal is a later cleanup step.

## AWS test-stage checkpoint

The AWS `test` stack was rebuilt from the current Serverless/CloudFormation
definition after API Gateway drift was discovered.

The drift involved `ApiKeyRequired` being manually/out-of-band set to `true`
where CloudFormation expected `false`.

After rebuilding the stack:

- API Gateway no longer blocks `/buckets` on an API key;
- unauthenticated `/buckets` requests reach Express and return `401`;
- invalid bearer tokens return `401`;
- the real Entra-enabled SPA successfully calls the protected API;
- bucket/folder/object browsing works through the authenticated test path.

Treat this as the current integration baseline.

Do not reintroduce API Gateway API-key enforcement merely because an
`X-Api-Key` header still exists in the frontend.

Before production cutover, run CloudFormation drift detection against the
production stack. Do not delete/recreate production merely because test was
recreated.

## Legacy MongoDB authentication freeze

MongoDB currently exists for legacy authentication/users and has no identified
independent Wasabi Drive business-data requirement.

The old MongoDB/password/UUID authentication path is scheduled for removal.

Do not spend effort improving legacy authentication code that is scheduled for
deletion.

Do not opportunistically fix or redesign:

- MongoDB user CRUD;
- MongoDB `_id` update defects;
- UUID token semantics;
- refresh-token behavior;
- MongoDB connection initialization;
- password account-management architecture.

Change legacy authentication only when required to:

- contain an immediate security exposure;
- preserve migration compatibility;
- support a specifically approved cutover step;
- complete approved cleanup after Entra production cutover.

After Entra successfully replaces legacy authentication, remove MongoDB if no
real application persistence requirement remains.

Do not add another database merely for future possibilities.

## Configuration and secrets

All environment interpretation belongs in `src/config`.

Tracked files must never contain:

- Wasabi credentials;
- MongoDB credentials;
- Entra secrets;
- AWS credentials;
- Serverless access credentials;
- real test-user passwords;
- bearer/access tokens;
- private keys.

Keep `.env`, `.env.test`, `.env.prd`, and Serverless build output untracked.

Use environment references in deployment configuration.

Entra tenant IDs, application/client IDs, Object IDs, issuer URLs, and API scope
identifiers are identifiers rather than passwords, but real environment/user
values should still remain in environment-specific local/deployment
configuration rather than being scattered through source.

Current Entra configuration names are:

- `ENTRA_AUTH_ENABLED`;
- `ENTRA_TENANT_ID`;
- `ENTRA_API_CLIENT_ID`;
- `ENTRA_REQUIRED_SCOPE`;
- `ENTRA_TRUSTED_USER_OBJECT_IDS`.

Do not add an Entra client secret.

When Entra enforcement is disabled, missing verifier/authorization values must
not prevent the existing application from starting.

When Entra enforcement is enabled, missing required authentication or
authorization configuration must fail closed.

## Stage-specific environment files

Serverless Framework v4 uses native stage-specific dotenv loading.

Local manual deployment files are:

- `.env.test`;
- `.env.prd`.

These files are untracked.

The explicit deployment scripts are:

- `npm run deploy:test`;
- `npm run deploy:prd`.

Do not reintroduce a generic deployment command that can silently target
production.

Be aware that process/shell environment variables may override values loaded
from `.env.<stage>`.

Do not store AWS deployment credentials in these application environment
files.

AWS credentials belong to the normal AWS credential provider chain/profile
mechanism.

## Serverless/deployment configuration

Serverless Framework remains the backend deployment/IaC mechanism.

IaC means Infrastructure as Code.

Do not hard-code real environment-specific values or credentials in
`serverless.yml`.

Do not make every deployment require Entra/trusted-user values merely to keep
legacy production behavior working when authentication remains disabled.

Supported deployment stages include:

- `test`;
- `prd`.

Use `test` before `prd` for authorization changes.

Do not deploy unless the task explicitly authorizes deployment.

## CORS

Current CORS behavior remains broad transitional behavior.

CORS means Cross-Origin Resource Sharing. It governs browser cross-origin
request permissions; it is not authentication or authorization.

Do not tighten CORS in the trusted-user authorization task.

After Entra authentication/authorization is proven through production cutover,
CORS should later be restricted to explicitly approved frontend origins and
required headers such as `Authorization` and `Content-Type`.

## Unit-test gate

Standard backend regression command:

`npm test`

For behavior-preserving/security migration changes:

1. run tests before the change where the environment permits;
2. record the baseline;
3. run them after the change;
4. preserve all unrelated passing behavior.

Do not delete, skip, or weaken assertions merely to make changes pass.

Preserve authentication coverage including:

- missing bearer token;
- malformed token;
- invalid signature;
- expired token;
- wrong issuer;
- wrong audience;
- missing required scope;
- valid token;
- signed token missing expiry;
- `401` authentication behavior;
- `403` insufficient-scope behavior;
- valid claims attached to `req.auth`;
- Lambda-compatible `jose` loading;
- unexpected verifier/JWKS failures forwarded rather than misreported as bad
  credentials.

For trusted-user authorization, add focused coverage including:

- trusted authenticated user -> allowed;
- untrusted authenticated user -> `403`;
- missing `oid` -> `403`;
- tenant mismatch/missing required tenant identity -> forbidden according to the
  approved authorization boundary;
- allow-list parsing/normalization;
- missing/empty allow-list while authentication enforcement is enabled -> fail
  closed;
- missing allow-list while enforcement is disabled -> does not break legacy
  startup behavior;
- authentication still executes before trusted-user authorization.

Do not dramatically expand tests around legacy password/MongoDB behavior that
will shortly be deleted.

## Bruno integration-test gates

The repository uses the project-local Bruno CLI.

Normal safe regression:

`npm run test:integration`

Automated integration tests must remain restricted to explicitly non-production
targets accepted by the test harness.

Never weaken the production-target guard.

For Entra integration tests:

- never commit bearer tokens;
- never commit interactive user passwords;
- provide tokens through approved runtime/environment configuration;
- keep reports configured so sensitive headers/bodies are not persisted.

Do not fabricate a bearer token for live integration testing.

Do not weaken authentication/authorization merely so old unauthenticated Bruno
requests continue to pass against an enforcement-enabled environment.

Bruno changes should be separately scoped if runtime token handling or test
collection semantics need material adjustment.

## Deployment safety

Backend deployment is manual through Serverless Framework v4.

Do not deploy unless the task explicitly authorizes deployment.

Use `test` before `prd` for material authentication/authorization changes.

`master` must remain deployable.

Production authentication is not yet cut over merely because test-stage
authentication is working.

The current production rollout principle is:

1. prove trusted-user authorization in `test`;
2. deploy/verify the Entra-enabled frontend compatibility path;
3. run production CloudFormation drift detection;
4. explicitly configure production authentication/authorization;
5. perform controlled production cutover;
6. retain a rollback plan.

Do not delete/recreate the production stack as a routine cutover step.

## Future CI/CD status

Automated CI/CD has not yet been implemented.

Do not assume GitHub Actions exists.

Future intended direction is approximately:

feature branch
-> pull request
-> install
-> unit tests
-> required status checks
-> merge to `master`
-> deploy `test`
-> safe integration regression
-> controlled production approval
-> deploy `prd`.

Future AWS CI authentication should prefer GitHub OIDC with short-lived AWS
credentials rather than long-lived AWS access keys.

OIDC means OpenID Connect.

Do not implement CI/CD unless explicitly asked.

## Dependency changes

Do not run broad dependency upgrades.

For an approved dependency task:

- modify only required direct dependencies;
- allow necessary lockfile changes;
- keep `package.json` and `package-lock.json` synchronized;
- do not run broad `npm audit fix` or `npm audit fix --force`;
- report unrelated findings separately.

No new runtime dependency is expected for the trusted-user allow-list.

AWS SDK v2 is known deferred debt.

Do not migrate to AWS SDK v3 during an authorization task unless explicitly
requested.

Express 4 remains the approved version line for the current phase.

## Kong/API gateway experimentation

Kong Gateway may be evaluated later as a separate architecture/learning spike.

Do not introduce Kong into the current Entra authorization migration.

Do not put Kong in front of the existing AWS API Gateway as an unapproved
additional gateway layer.

The current production architecture continues to use API Gateway REST API until
a separate requirement/experiment explicitly evaluates replacement trade-offs.

## Known deferred technical debt

Do not opportunistically fix these during authorization work unless they block
the task:

- Wasabi total-key pagination loses `Prefix` on subsequent pages;
- total-key counting performs expensive full pagination scans;
- AWS SDK for JavaScript v2 is end-of-support;
- route-local error handling is inconsistent;
- request validation is limited;
- production observability remains minimal;
- API Gateway REST -> HTTP API may later be evaluated;
- Kong may later be evaluated as a learning/architecture spike;
- CI/CD is not yet automated;
- broad CORS remains transitional;
- the browser-visible `X-Api-Key` remains temporary compatibility debt.

The MongoDB connection initialization issue and user-update defect are expected
to disappear when legacy authentication is removed. Do not polish code that is
scheduled for deletion.

## Current migration sequence

The approved sequence from the current checkpoint is approximately:

1. keep the proven Entra authentication path stable;
2. add the simple trusted-user authorization allow-list;
3. deploy trusted-user authorization to AWS `test`;
4. verify trusted user succeeds and untrusted authenticated identity is
   rejected with `403`;
5. perform a small frontend configuration fail-fast hardening task;
6. plan the production compatibility deployment;
7. run production CloudFormation drift detection;
8. deploy/verify Entra-enabled frontend production compatibility;
9. explicitly enable backend authentication + authorization in production;
10. validate production cutover and rollback readiness;
11. remove unused legacy frontend authentication artifacts;
12. remove backend MongoDB/bcrypt/UUID authentication if no other persistence
    requirement exists;
13. remove transitional `X-Api-Key` unless a real API Gateway usage-plan
    requirement remains;
14. tighten CORS in a separately controlled step;
15. evaluate later architecture experiments such as Kong only after the identity
    migration is stable.

Do not skip compatibility and rollback planning for production cutover.

Do not implement later sequence items merely because they appear here. Each
requires an explicitly scoped task.

## Refactoring discipline

For each task:

1. read this file in full before changing code;
2. understand the existing responsibility and tests;
3. make the smallest change needed for the approved task;
4. preserve unrelated application behavior;
5. avoid unrelated cleanup and formatting;
6. keep the diff reviewable;
7. make commits independently understandable;
8. stop when the requested task is complete.

The application is already deployed and working. Preserving deployability is
more important than maximizing refactoring scope.

## Completion report

For each implementation task report:

- branch used;
- commits created;
- files changed;
- dependencies/configuration changed;
- baseline/final unit-test result;
- integration-test result when applicable;
- behavior intentionally changed;
- compatibility impact;
- deployment performed, if explicitly authorized;
- remaining issue directly relevant to the task;
- recommended next task.

Do not automatically implement the recommended next task.
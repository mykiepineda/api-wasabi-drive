# Wasabi Drive API - Copilot Instructions

## Project status and current goal

Wasabi Drive API is an existing production-working Node.js/Express API for
browsing files stored in Wasabi Cloud Storage.

The previous structural-refactoring and production-deployment phase is complete.

The current modernization phase is:

**Microsoft Entra identity and API authorization migration.**

The backend Entra access-token validation foundation is already implemented on
`master`.

The frontend React SPA has also migrated to Microsoft Entra/MSAL on its
`master` branch and has been successfully tested locally against the real Entra
tenant. The frontend now acquires a Wasabi Drive API access token and sends:

- `Authorization: Bearer <access-token>`;
- the existing transitional `X-Api-Key` header.

The backend storage routes are **not yet enforcing** the bearer token.

The immediate backend objective is to introduce compatibility-controlled Entra
enforcement for protected storage routes so it can be enabled and validated in
the AWS `test` stage without breaking current production behavior.

Do not broaden the task into unrelated modernization.

The developer is the technical owner and architectural decision-maker.
Copilot assists implementation; it does not independently redesign the system.

## Branch and repository safety

`master` is the protected integration/release branch.

Never commit implementation changes directly to `master`.

Use a focused task branch appropriate to the requested task, for example:

- `feature/entra-test-stage-enforcement`;
- `test/entra-protected-api`;
- `feature/trusted-user-authorization`;
- `cleanup/remove-legacy-auth`;
- `cleanup/remove-mongodb`.

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
CDK, or another deployment framework unless explicitly requested.

## Current Entra authentication state

The approved target is:

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

The backend token-verification foundation already validates:

- cryptographic signature;
- tenant-specific issuer;
- API audience;
- expiration;
- required delegated API scope;
- an explicitly allowed signing algorithm.

It also rejects otherwise valid signed tokens that do not contain an expiry.

Do not weaken these checks.

Do not use an ID token as API authorization.

Do not use API Gateway API keys as user authentication.

Do not add a Lambda authorizer during the current migration unless a separate
approved task explicitly requires it.

Initial bearer-token enforcement belongs at the existing Express boundary.

## Authentication versus authorization

Authentication establishes who the caller is.

Authorization separately decides whether that authenticated principal is
allowed to use Wasabi Drive.

Current Entra middleware provides the authentication boundary and verifies the
required delegated API scope.

A later explicitly scoped task will introduce the initial simple trusted-user
authorization rule.

Do not prematurely build role, organization, tenant, claims-policy, or
database-backed permission systems.

Use correct HTTP semantics:

- missing/invalid authentication -> `401`;
- authenticated principal lacking the required API scope/application permission
  -> `403`.

Do not broadly redesign application error handling merely to implement identity
migration.

## Compatibility-controlled backend enforcement

The Entra-capable frontend source is now on its own `master` branch and has
successfully passed a local real-Entra test, but production deployment/cutover
must still be coordinated.

Backend bearer enforcement must therefore remain explicitly controllable during
the migration.

Use an explicit backend configuration switch:

`ENTRA_AUTH_ENABLED`

The intended behavior is:

- absent/false -> existing storage-route behavior remains unchanged;
- true -> protected storage routes require the existing Entra authentication
  middleware.

The switch must default to **disabled** unless explicitly enabled.

Do not infer production cutover merely from the existence of Entra tenant/client
configuration.

Do not silently fall back to unauthenticated behavior when
`ENTRA_AUTH_ENABLED=true` but required Entra verifier configuration is missing
or invalid. Enforcement-enabled configuration must fail closed rather than
accidentally exposing protected storage routes.

The immediate enforcement boundary is the `/buckets` route family.

Do not protect the legacy `/auth` route in the initial enforcement task because
it remains temporary compatibility/cleanup debt and requires a separate
migration decision.

Do not introduce duplicate `/buckets` implementations or versioned API routes
merely for this transition.

## Rollback principle for enforcement

The initial enforcement change must have a simple operational rollback:

- disable `ENTRA_AUTH_ENABLED`;
- redeploy the affected non-production stage.

Rollback must not require reverting the token-verification implementation or
restoring deleted code.

Do not remove legacy authentication, MongoDB, or the transitional frontend API
key in the same PR that introduces initial backend enforcement.

## Frontend/backend compatibility checkpoint

The frontend currently sends both:

`Authorization: Bearer <access-token>`

and:

`X-Api-Key: <existing compatibility value>`

This is deliberate transitional compatibility.

The backend must validate the bearer token when enforcement is enabled.

The backend must not treat `X-Api-Key` as authentication.

Do not remove the API-key compatibility path during initial enforcement. Its
eventual removal is a later cleanup decision after bearer-token authentication
and production cutover are proven.

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
- complete the approved cleanup after Entra production cutover.

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

Keep `.env` and Serverless build output untracked.

Use environment references in deployment configuration.

Entra tenant IDs, application/client IDs, issuer URLs, and API scope identifiers
are not secrets, but they are environment-specific configuration and should not
be scattered through source files.

Current Entra configuration names are:

- `ENTRA_TENANT_ID`;
- `ENTRA_API_CLIENT_ID`;
- `ENTRA_REQUIRED_SCOPE`.

The staged-enforcement configuration name is:

- `ENTRA_AUTH_ENABLED`.

Do not add an Entra client secret.

When Entra enforcement is disabled, missing Entra verifier values must not
prevent the existing application from starting.

When Entra enforcement is enabled, missing required verifier configuration must
not result in an unprotected fallback.

## Serverless/deployment configuration

Serverless Framework remains the backend deployment/IaC mechanism.

IaC means Infrastructure as Code: deployment/runtime configuration is described
and versioned through `serverless.yml` rather than manually recreating AWS
resources.

Entra Lambda environment settings should be wired through Serverless using
environment references, not hard-coded real values.

Do not make every deployment require new Entra shell variables merely to keep
legacy production behavior working if authentication is still disabled.

The existing separate stages include:

- `test`;
- `prd`.

Use `test` for the first deployed enforcement validation.

Do not enable production bearer enforcement merely by merging code.

Do not deploy unless the task explicitly authorizes deployment.

## Current planned test-stage activation

After the compatibility-controlled enforcement code is reviewed and merged, a
separate explicitly authorized deployment step should:

1. supply the real Entra tenant ID;
2. supply the real backend API application/client ID;
3. supply the required API scope;
4. set `ENTRA_AUTH_ENABLED=true`;
5. deploy to the AWS `test` stage;
6. verify an unauthenticated storage request receives `401`;
7. verify the Entra-enabled frontend can call the protected storage API;
8. verify invalid/insufficient tokens are rejected as designed;
9. retain a rollback path by redeploying with enforcement disabled.

Do not perform these deployment steps automatically as part of a code-only
implementation task.

## CORS

Current CORS behavior is intentionally broad legacy behavior.

CORS means Cross-Origin Resource Sharing. It governs browser cross-origin
request permissions; it is not authentication.

The Entra-enabled frontend has already been tested successfully while sending
the bearer header to the currently unprotected API.

Do not tighten or broadly redesign CORS in the initial backend-enforcement task.

If protected `test`-stage integration reveals a concrete CORS failure, address
that in a separately scoped compatibility correction.

After the Entra frontend/backend flow is proven in `test`, CORS should later be
restricted to explicitly approved frontend origins and required headers such as
`Authorization` and `Content-Type`.

## Unit-test gate

Standard backend regression command:

`npm test`

For behavior-preserving/migration changes:

1. run tests before the change where the environment permits;
2. record the baseline;
3. run them after the change;
4. preserve all unrelated passing behavior.

Do not delete, skip, or weaken assertions merely to make changes pass.

For Entra work, preserve focused coverage including:

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
- unexpected verifier/JWKS failures forwarded rather than misreported as bad
  credentials.

For staged route enforcement, add focused tests that demonstrate the new
configuration/wiring behavior without introducing a broad test framework.

In particular, verify that:

- enforcement defaults disabled;
- enforcement can be explicitly enabled;
- `/buckets` is rejected before storage behavior when enforcement is enabled
  and no bearer token is supplied;
- enabling enforcement with missing verifier configuration does not silently
  expose `/buckets`.

Do not dramatically expand tests around legacy password/MongoDB behavior that
will shortly be deleted.

## Bruno integration-test gates

The repository uses the project-local Bruno CLI.

Normal safe regression:

`npm run test:integration`

Automated integration tests must remain restricted to explicitly non-production
targets accepted by the test harness.

Never weaken the production-target guard.

Current broader/mutating and known-defect suites are legacy tools and may be
deleted once MongoDB authentication is removed, but do not change them during
an unrelated task.

For Entra integration tests:

- never commit bearer tokens;
- never commit interactive user passwords;
- provide tokens through approved runtime/environment configuration;
- add/execute explicit unauthenticated `401` checks when the protected test
  stage is available;
- add authenticated successful storage checks when a suitable runtime token is
  available;
- keep reports configured so sensitive headers/bodies are not persisted.

Do not fabricate a bearer token for integration testing.

Do not weaken authentication merely so existing unauthenticated Bruno storage
requests continue to pass against an enforcement-enabled environment.

Bruno changes should be separately scoped if runtime token handling or test
collection semantics need material adjustment.

## Deployment safety

Backend deployment is currently manual through Serverless Framework v4.

Do not deploy unless the task explicitly authorizes deployment.

Use `test` before `prd` for material authentication changes.

Do not create unnecessary persistent feature stages.

If a temporary stage is explicitly created, remove its AWS/CloudFormation
resources after the task.

`master` must remain deployable.

Until production cutover is explicitly approved, the mere presence of Entra
verification code must not unintentionally force production storage-route
enforcement.

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

No new authentication dependency is expected merely to activate the existing
Entra verifier/middleware.

AWS SDK v2 is known deferred debt.

Do not migrate to AWS SDK v3 during an Entra enforcement task unless explicitly
requested.

Express 4 remains the approved version line for the current phase.

## Known deferred technical debt

Do not opportunistically fix these during authentication work unless they block
the task:

- Wasabi total-key pagination loses `Prefix` on subsequent pages;
- total-key counting performs expensive full pagination scans;
- AWS SDK for JavaScript v2 is end-of-support;
- route-local error handling is inconsistent;
- request validation is limited;
- production observability remains minimal;
- API Gateway REST -> HTTP API may later be evaluated;
- CI/CD is not yet automated;
- broad CORS remains transitional;
- the browser-visible `X-Api-Key` remains temporary compatibility debt.

The MongoDB connection initialization issue and user-update defect are expected
to disappear when legacy authentication is removed. Do not polish code that is
scheduled for deletion.

## Current migration sequence

The approved sequence from the current checkpoint is approximately:

1. keep the existing token-verification foundation stable;
2. add compatibility-controlled `/buckets` bearer enforcement;
3. merge that code without automatically enabling production enforcement;
4. explicitly deploy the backend to AWS `test` with Entra enforcement enabled;
5. validate unauthenticated and authenticated behavior against the protected
   `test` API;
6. introduce the simple trusted-user authorization layer;
7. validate the complete authorization path in `test`;
8. plan and perform a controlled production cutover;
9. remove legacy frontend authentication remnants;
10. remove backend MongoDB/bcrypt/UUID authentication if no other persistence
    requirement exists;
11. remove the transitional `X-Api-Key` unless a genuine API Gateway usage-plan
    requirement remains;
12. tighten CORS in a separately controlled step.

Do not skip compatibility and rollback planning for enforcement or production
cutover.

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
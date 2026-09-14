# Wasabi Drive API - Copilot Instructions

## Project status and current goal

Wasabi Drive API is an existing production-working Node.js/Express API for
browsing files stored in Wasabi Cloud Storage.

The previous structural-refactoring and RC1 deployment phase is complete.

The current modernization phase is:

**Microsoft Entra identity and API authorization migration.**

The objective is to replace the legacy MongoDB/bcrypt/UUID authentication
system with standards-based Entra authentication while preserving a working,
deployable application throughout the migration.

Do not broaden the task into unrelated modernization.

The developer is the technical owner and architectural decision-maker.
Copilot assists implementation; it does not independently redesign the system.

## Branch and repository safety

`master` is the protected integration/release branch.

Never commit implementation changes directly to `master`.

Use a focused task branch such as:

- `feature/entra-token-validation`
- `feature/entra-protected-storage-routes`
- `test/entra-bruno-auth`
- `cleanup/remove-legacy-auth`
- `cleanup/remove-mongodb`

Keep each branch limited to one reviewable responsibility.

Do not automatically continue to another modernization task after completing
the requested work.

Do not make unrelated formatting, cleanup, dependency or architectural changes.

## Current architecture

Preserve these established boundaries unless a task explicitly changes them:

- `src/server.js` owns local HTTP startup.
- `src/app.js` constructs the Express application and Lambda handler.
- `src/config` is the application configuration boundary.
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
  frameworks, microservices, abstract base classes or repository layers.

Current supported runtime/deployment stack:

- Node.js 24;
- CommonJS;
- Express 4.22.x;
- Serverless Framework v4;
- AWS Lambda;
- API Gateway REST API;
- `serverless-http`.

Do not migrate Express 5, ESM, TypeScript, API Gateway HTTP API, Terraform,
CDK or another deployment framework unless explicitly requested.

## Approved authentication direction

The current MongoDB/password/UUID login is legacy and is scheduled for removal.

The approved target is:

React/MSAL
-> Microsoft Entra
-> OAuth/OIDC access token
-> API Gateway REST API
-> Express authentication middleware
-> application authorization
-> Wasabi services.

The React SPA must use the OAuth 2.0 / OpenID Connect authorization-code flow
with PKCE through MSAL. PKCE means Proof Key for Code Exchange and protects the
authorization-code exchange for public clients such as browser SPAs that cannot
safely hold a client secret.

Do not use the legacy implicit flow.

The React SPA is a public client and must not use or contain an Entra client
secret. Do not add client secrets, certificates or other confidential-client
credentials to frontend code or Firebase-hosted frontend configuration.

The API must eventually validate Entra-issued access tokens including the
security properties required by the approved design, such as:

- signature;
- issuer;
- audience;
- expiration/not-before as applicable;
- required API scope.

Authentication identifies the principal.

Authorization separately determines whether the authenticated principal is
allowed to use Wasabi Drive.

For the initial trusted-user application, keep authorization simple. Do not
build speculative role, organization, tenant or database-backed permission
systems unless explicitly requested.

Do not use API Gateway API keys as authentication.

Do not introduce a Lambda authorizer or migrate REST API to HTTP API during the
current Entra migration unless a separate approved task explicitly does so.

Initial Entra token enforcement should use the existing Express application
boundary.

The Wasabi Drive API currently acts as an OAuth resource server. Validating
Entra access tokens through issuer, audience, signature, expiry and scope checks
does not require an Entra client secret. Do not introduce an API client secret
unless a later approved requirement requires the backend itself to authenticate
to Microsoft Entra or another Microsoft API.

## Compatibility-first auth migration

The production frontend currently uses the legacy authentication contract.

Do not make an existing protected-storage contract breaking change unless the
task explicitly represents the cutover step.

Prefer staged compatibility:

1. add and test token-validation capability;
2. introduce protected API behavior without removing the existing working
   frontend contract;
3. validate the protected path in the AWS `test` stage;
4. allow the frontend repository to migrate;
5. verify frontend/backend integration;
6. only then remove legacy unauthenticated behavior;
7. remove legacy MongoDB authentication after successful cutover.

`master` must remain deployable.

Do not merge backend behavior that requires an Entra bearer token while the
production frontend on `master` has no compatible way to send one unless a
short-lived transitional design has explicitly been approved.

Breaking changes require an explicit migration/rollback plan.

## Legacy MongoDB authentication freeze

MongoDB currently exists for legacy authentication/users and has no identified
independent Wasabi Drive business-data requirement.

Do not spend effort improving legacy auth code that is scheduled for deletion.

Do not opportunistically fix or redesign:

- MongoDB user CRUD;
- MongoDB `_id` update defects;
- UUID token semantics;
- refresh-token behavior;
- MongoDB connection initialization;
- password account-management architecture.

Change legacy auth only when required to:

- contain an immediate security exposure;
- support the Entra migration;
- preserve the working frontend during transition;
- complete the approved cleanup after cutover.

After Entra successfully replaces legacy auth, remove MongoDB if no real
application persistence requirement exists.

Do not add another database merely for future possibilities.

## API authorization rules

Protected storage APIs must ultimately require:

`Authorization: Bearer <access-token>`

Do not treat the browser-visible `X-Api-Key` as user authentication or as a
secret.

The existing frontend API key is temporary compatibility debt.

Once bearer-token authentication is fully deployed, remove the API-key header
unless an explicitly approved API Gateway usage-plan requirement exists.

Use correct conceptual semantics:

- missing/invalid authentication -> `401`;
- authenticated principal lacking application permission -> `403`.

Do not broadly redesign all error handling merely to implement authentication.

## CORS

Current CORS behavior is intentionally broad legacy behavior.

Do not tighten CORS in the same initial task that introduces token validation.

CORS is not authentication.

After the Entra frontend/backend flow is proven in the `test` environment,
CORS should be restricted to explicitly approved frontend origins and required
headers such as `Authorization` and `Content-Type`.

Do not break the currently deployed frontend by changing CORS prematurely.

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

Frontend/client IDs, issuer URLs and API audience identifiers may not be
secrets, but they must still be environment-specific and configured through
the established configuration boundary.

Never print access tokens or secret values in logs, tests, reports or responses.

## Unit-test gate

Standard backend regression command:

`npm test`

For behavior-preserving changes:

1. run tests before the change where the environment permits;
2. record the baseline;
3. run them after the change;
4. preserve all unrelated passing behavior.

Do not delete, skip or weaken assertions merely to make changes pass.

For Entra authentication work, add focused tests for the behavior in scope,
including as appropriate:

- missing Authorization header;
- malformed bearer token;
- invalid signature;
- expired token;
- wrong issuer;
- wrong audience;
- missing required scope;
- valid token;
- valid but unauthorized user.

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
- add explicit unauthenticated `401` tests;
- add authenticated successful storage tests when a suitable test identity is
  available;
- keep reports configured so sensitive headers/bodies are not persisted.

## Deployment safety

Backend deployment is currently manual through Serverless Framework v4.

Do not deploy unless the task explicitly authorizes deployment.

Supported deployment environments include separate Serverless stages such as:

- `test`;
- `prd`.

Use `test` for authentication integration before production.

Do not create unnecessary persistent feature stages.

If a temporary stage is explicitly created, remove its AWS/CloudFormation
resources after the task.

Serverless Framework remains the deployment/IaC mechanism.

Future GitHub Actions should invoke Serverless rather than replacing it with a
second infrastructure framework without explicit approval.

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
-> safe Bruno regression
-> controlled production approval
-> deploy `prd`.

Future AWS CI authentication should prefer GitHub OIDC with short-lived AWS
credentials rather than long-lived AWS access keys.

Do not implement CI/CD unless explicitly asked.

## Dependency changes

Do not run broad dependency upgrades.

For an approved dependency task:

- modify only required direct dependencies;
- allow necessary lockfile changes;
- keep `package.json` and `package-lock.json` synchronized;
- do not run broad `npm audit fix` or `npm audit fix --force`;
- report unrelated findings separately.

AWS SDK v2 is known deferred debt.

Do not migrate to AWS SDK v3 during an Entra task unless explicitly requested.

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
- CI/CD is not yet automated.

The MongoDB connection initialization issue and user-update defect are expected
to disappear when legacy authentication is removed. Do not polish code that is
scheduled for deletion.

## Refactoring discipline

For each task:

1. understand the existing responsibility and tests;
2. make the smallest change needed for the approved task;
3. preserve unrelated application behavior;
4. avoid unrelated cleanup and formatting;
5. keep the diff reviewable;
6. make commits independently understandable;
7. stop when the requested task is complete.

The application is already deployed and working. Preserving deployability is
more important than maximizing refactoring scope.

## Completion report

For each implementation task report:

- branch used;
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
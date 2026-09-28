# Wasabi Drive Backend — GitHub Copilot Instructions

## Project role

Wasabi Drive is an existing production application and an incremental modernization project.

The developer is the technical owner and architectural decision-maker.

Copilot is an implementation assistant. Make only the explicitly requested change, preserve working behavior, and do not independently redesign the backend, authentication model, AWS architecture, deployment model, Serverless configuration, storage integration, or CI/CD model.

Prefer focused, reviewable changes over broad cleanup.

## Current phase

Current modernization phase:

**Phase 6 — CI/CD and Deployment Safety**

CI/CD = Continuous Integration / Continuous Delivery.

Completed work:

- 6A — backend pull-request CI;
- 6B — frontend pull-request CI;
- 6C — deployment command normalization;
- 6D — automated backend `test` deployment using GitHub Actions, GitHub OIDC, AWS STS, and Serverless Framework;
- 6E — backend test-stage verification;
- 6F — stable frontend test Firebase Hosting environment;
- 6G — automated frontend `test` deployment using GitHub OIDC and Google Workload Identity Federation;
- 6H-A — controlled backend production promotion using an exact tested `master` SHA;
- Serverless Framework version constrained to the approved 4.42.x line.

The active task is:

**Task 6H-A.1 — Health endpoint and automated deployed-API smoke verification**

Do not start Task 6H-B frontend production promotion.

## Latest authoritative backend state

Treat the latest `master` source as authoritative.

The current backend uses:

- Node.js 24;
- Express 4;
- CommonJS;
- AWS Lambda;
- API Gateway REST API;
- Serverless Framework v4.42.x;
- CloudFormation;
- AWS SDK for JavaScript v3;
- Wasabi S3-compatible object storage;
- stages `test` and `prd`.

Current HTTP construction is in `src/app.js`.

Protected bucket routes are mounted at `/buckets` behind:

1. Microsoft Entra access-token authentication;
2. trusted-user authorization;
3. `src/api/buckets.js`.

The backend currently has no health route.

The current Bruno integration runner is:

`scripts/run-integration.js`

The current target validator is:

`scripts/integration-target.js`

The current integration script is:

`npm run test:integration`

The current Bruno collection already contains a read-only unauthorized check:

`bruno/wasabi-drive-api/buckets/unauthorized.bru`

It expects:

```text
GET /buckets/
-> 401
-> { "error": "Unauthorized" }
```

The current full `regression` integration scope is intentionally limited to:

- `local`;
- `development`;
- `test`.

For `INTEGRATION_TARGET=test`, the full regression scope requires a short-lived delegated Entra access token.

Do not change that authentication model during this task.

## Architecture and security invariants

Preserve the established separation of concerns:

HTTP / Express route
-> application/service layer
-> infrastructure/storage implementation
-> Wasabi / AWS SDK.

The health route is an HTTP operational concern and does not require a new application service, storage method, framework, abstraction, or dependency.

Preserve:

React SPA
-> MSAL
-> Microsoft Entra
-> OAuth 2.0 / OpenID Connect access token
-> API Gateway
-> Express authentication
-> application authorization
-> Wasabi.

The backend remains the security authority.

Do not restore:

- MongoDB authentication;
- bcrypt password authentication;
- UUID authentication;
- API Gateway API-key authentication;
- frontend-only authorization.

Do not weaken authentication on `/buckets`.

Do not add a CI-specific Entra application identity or app role.

Do not store:

- user passwords;
- refresh tokens;
- bearer tokens;
- Entra client secrets;
- long-lived AWS access keys

in GitHub merely to automate integration testing.

## Task 6H-A.1 objective

Add a deliberately shallow, unauthenticated health endpoint and use Bruno after backend deployments to verify two deployment-critical behaviors:

```text
GET /health
-> 200
-> { "status": "ok" }

GET /buckets/
without Authorization
-> 401
-> { "error": "Unauthorized" }
```

These checks verify different boundaries.

`/health` verifies:

```text
API Gateway
-> Lambda
-> Express startup
-> HTTP routing
```

The unauthorized `/buckets/` check verifies:

```text
protected route
-> Entra authentication middleware is active
-> missing access token is rejected
```

The automated deployment smoke scope must not call Wasabi and must not require a user token.

The existing full authenticated Bruno regression remains a manual `test`-stage promotion gate for now.

## Health endpoint contract

Add:

```http
GET /health
```

Expected response:

```json
{
  "status": "ok"
}
```

Expected HTTP status:

`200`

The endpoint must be unauthenticated.

Place it so that it is not wrapped by the `/buckets` Entra authentication and trusted-user authorization middleware.

Do not add:

- Wasabi calls;
- Microsoft Entra calls;
- AWS calls;
- database calls;
- downstream dependency probes;
- environment dumps;
- version dumps;
- account IDs;
- tenant IDs;
- secrets;
- stack traces.

Do not introduce `/liveness`, `/readiness`, or a health-check framework.

The endpoint should remain intentionally shallow.

No `serverless.yml` change should be needed because the existing API Gateway proxy routing already forwards application paths to Express.

If implementation appears to require a Serverless/API Gateway configuration change, stop and report why.

## Health endpoint unit/regression test

Add or extend backend tests so that `npm test` proves:

1. `/health` responds with HTTP `200`;
2. the JSON body is exactly or equivalently `{ status: "ok" }`;
3. no bearer token is required.

Prefer extending the existing application-enforcement test structure if that remains simple and focused.

Do not weaken or delete existing authentication tests.

Existing `/buckets` authentication enforcement must continue to pass.

## Bruno deployment-smoke scope

Add a new integration scope:

`deployment-smoke`

The existing scope remains:

`regression`

Update `scripts/run-integration.js` so its supported scope map includes:

```text
regression
deployment-smoke
```

`regression` must continue to select the existing `regression` Bruno tag.

`deployment-smoke` must select a new Bruno tag:

`deployment-smoke`

Unknown scopes must still fail closed.

Do not change the default scope from `regression`.

## Bruno health request

Add a new Bruno request for:

```text
GET {{baseUrl}}/health
```

with:

- no authentication;
- tag `deployment-smoke`;
- assertion that status is `200`;
- assertion that response body represents `{ "status": "ok" }`.

A suitable location is:

`bruno/wasabi-drive-api/health/health.bru`

Do not add the health request to the full authenticated `regression` scope unless there is a concrete reason. The purpose here is deployed-service smoke verification.

## Bruno unauthorized request

Preserve the existing `regression` tag on:

`bruno/wasabi-drive-api/buckets/unauthorized.bru`

Add the new tag:

`deployment-smoke`

The request itself must remain unauthenticated.

Preserve its current contract:

```text
GET {{baseUrl}}/buckets/
-> 401
-> { "error": "Unauthorized" }
```

Do not change the protected endpoint to make the smoke test pass.

## Integration target safety model

The current target validator deliberately prevents the full regression suite from targeting production.

Preserve that protection.

Update `scripts/integration-target.js` so target permission is scope-aware.

Required target matrix:

```text
scope = regression

local        allowed
development  allowed
test         allowed
prd          forbidden


scope = deployment-smoke

local        allowed
development  allowed
test         allowed
prd          allowed
```

For `local` and `development`, preserve the localhost / `127.0.0.1` restriction.

For `test`, require:

- HTTPS;
- API Gateway hostname shape;
- stage path `test`.

For `prd`, when and only when scope is `deployment-smoke`, require:

- HTTPS;
- API Gateway hostname shape;
- stage path `prd`.

A production API Gateway URL must remain rejected for scope `regression`.

A `/test` URL must not be accepted when target is `prd`.

A `/prd` URL must not be accepted when target is `test`.

Do not weaken target validation to a generic arbitrary HTTPS URL.

Do not allow the full regression suite to run against `prd`.

## Integration target tests

Extend `test/integration-target.test.js` to cover the new behavior.

At minimum test:

- existing local target remains accepted;
- existing test API Gateway target remains accepted for `regression`;
- production target remains rejected for `regression`;
- test API Gateway URL is accepted for `deployment-smoke`;
- production API Gateway `/prd` URL is accepted for `deployment-smoke` with target `prd`;
- production target rejects a `/test` URL;
- test target rejects a `/prd` URL;
- malformed/missing `BASE_URL` remains rejected;
- unknown/unsupported scope fails closed if validation handles scope directly.

Do not weaken existing tests.

## Access-token rules

Preserve the current full-regression token rule:

```text
scope = regression
target = test
-> non-blank INTEGRATION_ACCESS_TOKEN required
```

For:

```text
scope = deployment-smoke
target = test or prd
```

do **not** require `INTEGRATION_ACCESS_TOKEN`.

The deployment-smoke requests must not use an access token.

Do not add any GitHub secret for an Entra user token.

Do not introduce username/password automation.

## GitHub Environment prerequisite

The workflows should read a new non-secret GitHub Environment variable:

`INTEGRATION_BASE_URL`

The technical owner will configure it externally.

Expected values for the current environments are the stable API Gateway stage roots, with no trailing slash:

```text
test:
https://xsfyrajqg5.execute-api.ap-southeast-2.amazonaws.com/test

prd:
https://5s4gzdceqa.execute-api.ap-southeast-2.amazonaws.com/prd
```

Do not hardcode these URLs in workflow source.

Map the GitHub variable to the runner's existing variable name:

```yaml
BASE_URL: ${{ vars.INTEGRATION_BASE_URL }}
```

The URLs are configuration, not secrets.

## Backend test deployment workflow

Update:

`.github/workflows/backend-test-deploy.yml`

Preserve all existing deployment/security behavior.

After the existing successful:

```text
npm run deploy:test
```

add a deployed-API smoke step.

Use:

```yaml
env:
  INTEGRATION_TARGET: test
  BASE_URL: ${{ vars.INTEGRATION_BASE_URL }}
```

Run:

```bash
npm run test:integration -- deployment-smoke
```

The smoke step must execute only after the deployment step succeeds.

Do not provide:

`INTEGRATION_ACCESS_TOKEN`

to the automated smoke scope.

Do not automatically run the full authenticated `regression` scope in GitHub Actions.

Do not change the AWS test deployment role or credentials model.

## Backend production promotion workflow

Update:

`.github/workflows/backend-prd-deploy.yml`

Preserve all existing 6H-A controls:

- manual `workflow_dispatch` only;
- required full `source_sha`;
- `master`-only execution;
- GitHub Environment `prd`;
- exact SHA validation;
- full-history checkout;
- detached exact-SHA checkout;
- `npm ci`;
- `npm test`;
- GitHub OIDC;
- dedicated production AWS deploy role;
- `npm run deploy:prd`;
- production concurrency;
- no permanent AWS deployment keys.

After the existing successful:

```text
npm run deploy:prd
```

add a deployed-API smoke step.

Use:

```yaml
env:
  INTEGRATION_TARGET: prd
  BASE_URL: ${{ vars.INTEGRATION_BASE_URL }}
```

Run:

```bash
npm run test:integration -- deployment-smoke
```

Do not provide `INTEGRATION_ACCESS_TOKEN`.

Do not run the full authenticated Bruno `regression` scope against production.

If smoke verification fails after deployment, the workflow should fail visibly. Do not automatically broaden IAM, retry indefinitely, redeploy, or roll back.

## AWS credential exposure during smoke

The smoke test does not need AWS credentials.

Do not deliberately pass Serverless, Wasabi, or application secrets into the smoke step.

The existing Serverless/Wasabi/Entra deployment configuration remains scoped to the deploy step.

If the AWS OIDC action's temporary AWS session environment remains available to later steps automatically, do not add new code solely to redesign the whole workflow for credential isolation during this task.

Do not explicitly copy AWS credentials into the smoke step.

## Bruno documentation

Update:

`bruno/wasabi-drive-api/README.md`

Document both scopes clearly.

### Full regression

```bash
npm run test:integration
```

or explicitly:

```bash
npm run test:integration -- regression
```

Safety:

- read-only;
- `local`, `development`, or `test` only;
- never `prd`;
- `test` requires a short-lived delegated Entra access token;
- remains a manual test-stage promotion gate.

### Deployment smoke

```bash
npm run test:integration -- deployment-smoke
```

Safety:

- contains only `/health` 200 and unauthenticated `/buckets/` 401 checks;
- no access token required;
- no Wasabi read/write operation;
- permitted against `local`, `development`, `test`, and `prd` only when the scope-aware target/base URL validation matches;
- CI uses it for post-deployment verification of `test` and `prd`.

Do not document real bearer tokens or secrets.

## Main README documentation

Update `README.md` to document:

- `GET /health`;
- response `{ "status": "ok" }`;
- it is intentionally unauthenticated and shallow;
- it does not probe Wasabi or Entra;
- backend `test` deployment now runs automated post-deployment smoke verification;
- production promotion also runs the same non-destructive smoke verification;
- smoke verifies health `200` and protected-route `401`;
- the full authenticated Bruno regression remains manual against `test`;
- the full regression scope remains blocked from `prd`;
- production rollback remains the existing known-good exact-SHA promotion process.

Keep documentation concise.

## GitHub Actions pins

Do not change approved action versions or pins during this task unless a concrete defect requires review.

Current approved actions include:

```text
actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd
```

Do not introduce additional third-party GitHub Actions.

## Expected source changes

Expected Task 6H-A.1 changes are limited to files such as:

- `src/app.js`;
- `test/app-enforcement.test.js` or one narrowly focused health test file;
- `scripts/integration-target.js`;
- `scripts/run-integration.js`;
- `test/integration-target.test.js`;
- `bruno/wasabi-drive-api/health/health.bru`;
- `bruno/wasabi-drive-api/buckets/unauthorized.bru`;
- `bruno/wasabi-drive-api/README.md`;
- `.github/workflows/backend-test-deploy.yml`;
- `.github/workflows/backend-prd-deploy.yml`;
- `.github/copilot-instructions.md`;
- `README.md`.

No changes are expected to:

- `src/api/buckets.js`;
- application/service bucket logic;
- storage/Wasabi implementation;
- authentication token validation;
- trusted-user authorization;
- `serverless.yml`;
- `package.json`;
- `package-lock.json`;
- `.env.example`;
- AWS IAM;
- Entra app registrations.

If implementation appears to require those changes, stop and report why instead of expanding scope automatically.

## Branch and change management

Use branch:

`ci/backend-health-smoke`

Do not commit directly to `master`.

Keep this as one focused PR.

Do not perform unrelated cleanup.

Do not remediate npm audit findings in this task.

Do not upgrade dependencies.

## Local validation

Before commit run:

```bash
npm ci
npm test
git diff --check
git status --short
```

Also validate the new smoke scope locally without touching cloud environments.

With the local backend running and appropriate required backend configuration, use:

```text
INTEGRATION_TARGET=local
BASE_URL=http://localhost:8080
npm run test:integration -- deployment-smoke
```

The local smoke scope should require no `INTEGRATION_ACCESS_TOKEN`.

Do not run a cloud deployment from the feature branch.

Do not run:

```bash
npm run deploy:test
npm run deploy:prd
```

Do not run the deployment-smoke scope against `test` or `prd` from the feature branch merely to validate the code.

## Static workflow review

Before completion, confirm:

1. `/health` is unauthenticated;
2. `/health` returns 200 and `{ status: "ok" }`;
3. `/health` does not call Wasabi, Entra, AWS, or another dependency;
4. `/buckets` remains protected;
5. existing unauthorized Bruno request still expects 401;
6. unauthorized Bruno request has both `regression` and `deployment-smoke` tags;
7. health Bruno request has `deployment-smoke` tag;
8. default integration scope remains `regression`;
9. `regression` cannot target `prd`;
10. `deployment-smoke` can target only correctly matched local/development/test/prd URLs;
11. `/prd` API URL is required for `INTEGRATION_TARGET=prd`;
12. `/test` API URL is required for `INTEGRATION_TARGET=test`;
13. `deployment-smoke` does not require an access token;
14. `regression` targeting `test` still requires an access token;
15. test deployment runs smoke only after successful test deploy;
16. production promotion runs smoke only after successful production deploy;
17. production workflow remains manual and exact-SHA controlled;
18. no full Bruno regression is added to production;
19. no user credential/token secret is introduced;
20. no AWS IAM changes are made;
21. no Entra authorization changes are made;
22. no dependency changes are made;
23. no feature-branch cloud deployment occurred;
24. Task 6H-B was not started.

## First cloud validation after merge

Before merging, the technical owner must configure:

```text
GitHub Environment test:
INTEGRATION_BASE_URL = test API Gateway stage URL

GitHub Environment prd:
INTEGRATION_BASE_URL = production API Gateway stage URL
```

After merge to `master`:

1. normal backend PR CI must already have passed;
2. the existing automatic backend `test` deployment runs;
3. after deployment, `deployment-smoke` must pass:
   - `/health` = 200;
   - unauthenticated `/buckets/` = 401;
4. manually run the existing authenticated full Bruno regression against `test`;
5. verify the frontend test site;
6. promote the exact tested SHA using the existing **Backend Production Promotion** workflow;
7. production deployment must finish;
8. production `deployment-smoke` must pass:
   - `/health` = 200;
   - unauthenticated `/buckets/` = 401;
9. perform the normal production frontend smoke verification.

If health or 401 smoke fails, report the exact response/status and stop. Do not weaken authentication or target validation to make the check pass.

## Non-goals

Do not implement during Task 6H-A.1:

- Task 6H-B frontend production promotion;
- Entra service-principal/app-role CI authentication;
- storing user access tokens in GitHub;
- automatic authenticated Bruno regression in CI;
- full regression against production;
- Wasabi dependency health checks;
- readiness/liveness frameworks;
- observability platform integration;
- API Gateway health-check infrastructure;
- AWS IAM changes;
- Serverless migration;
- API Gateway migration;
- dependency upgrades;
- npm audit remediation;
- application feature work;
- CORS changes;
- unrelated refactoring.

## Completion report

When implementation is complete, stop and report:

- branch used;
- exact files changed;
- health endpoint path/status/body;
- confirmation health is unauthenticated;
- health unit/regression test added;
- Bruno health request path/tags/assertions;
- unauthorized Bruno request tags/assertions;
- integration scopes supported;
- exact target matrix enforced;
- token requirement behavior by scope/target;
- integration-target tests added/updated;
- test deployment workflow smoke step;
- production promotion workflow smoke step;
- GitHub Environment variable referenced;
- confirmation no access-token secret was introduced;
- confirmation full regression remains blocked from `prd`;
- README changes;
- Bruno README changes;
- `npm ci` result;
- `npm test` result and test count;
- local `deployment-smoke` result if run;
- `git diff --check` result;
- `git status --short` result;
- confirmation `serverless.yml` was unchanged;
- confirmation `package.json` and `package-lock.json` were unchanged;
- confirmation authentication/authorization code was unchanged;
- confirmation storage/application bucket code was unchanged;
- confirmation no feature-branch cloud deployment occurred;
- confirmation Task 6H-B was not started;
- any unexpected issue.

Do not commit unless explicitly instructed.

Do not continue beyond Task 6H-A.1.
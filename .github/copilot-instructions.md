# Wasabi Drive API - Copilot Instructions

## Current project phase

Wasabi Drive is an existing production-working application.

The current backend modernization phase is:

**Phase 5 — Browse Correctness and Pagination Scalability.**

The developer is the technical owner and architectural decision-maker.

Copilot should implement only the requested task and must not independently redesign the application.

Preserve a working deployable system.

## Branch safety

`master` is the protected integration/release branch.

Never commit implementation changes directly to `master`.

Use a focused task branch such as:

* `fix/pagination-prefix`;
* `refactor/remove-total-key-count`;
* another explicitly approved Phase 5 branch.

Do not automatically continue to another task after completing the requested work.

Avoid unrelated cleanup, formatting, dependency upgrades or architectural changes.

## Current production architecture

Backend:

* Node.js 24;
* Express 4;
* CommonJS;
* AWS Lambda;
* API Gateway REST API;
* Serverless Framework v4;
* CloudFormation;
* AWS SDK for JavaScript v3;
* Wasabi S3-compatible storage;
* `test` and `prd` stages.

Preserve the established dependency direction:

HTTP / Express route
-> application/service layer
-> storage/infrastructure implementation
-> AWS SDK
-> Wasabi.

AWS SDK calls belong in the storage/infrastructure layer.

Application services should not depend directly on Express `req`/`res`.

Local HTTP startup must remain separate from Lambda application construction.

Environment interpretation remains centralized.

Do not introduce speculative provider abstractions, dependency-injection frameworks, microservices, databases, queues, or new frameworks.

## Established security architecture

Microsoft Entra authentication is mandatory.

Current request flow:

React/MSAL
-> Microsoft Entra
-> OAuth 2.0 API access token
-> API Gateway
-> Express token validation
-> trusted-user authorization
-> application/service layer
-> Wasabi.

Never create an unauthenticated fallback for `/buckets`.

Never reintroduce:

* API-key authentication;
* MongoDB authentication;
* bcrypt login;
* UUID auth tokens;
* optional Entra enforcement.

Trusted-user authorization is an established production boundary.

Do not redesign it during pagination work.

## Established object security

Wasabi objects are private.

The backend generates short-lived presigned `AccessUrl` values after authentication and authorization.

The frontend consumes those URLs.

Never:

* make objects publicly readable;
* construct permanent public object URLs;
* expose Wasabi credentials;
* proxy file bytes through Lambda without an explicitly approved architectural reason.

Preserve `AccessUrl` behavior during Phase 5.

## Current pagination problem

The current backend has two known problems.

### Prefix correctness

The full-count pagination path historically passes `Prefix` on the first storage request but loses it on continuation requests.

Every request belonging to the same logical prefixed listing must preserve the original `Prefix`.

Tests must reflect correct behavior, not preserve the defect.

### Full-list count

Normal browsing currently calculates `TotalKeyCount` by traversing the entire logical listing before retrieving the requested visible page.

This causes navigation cost to grow with total folder size.

Phase 5 will remove this architecture after the frontend no longer requires exact totals.

Do not replace it with a database or another expensive exact-count mechanism.

Native S3/Wasabi cursor pagination is the target model.

## Phase 5 task sequence

### Task 5A

Fix Prefix handling only.

Preserve the current API response and `TotalKeyCount`.

Do not change frontend compatibility.

### Task 5C

After the frontend no longer relies on `TotalKeyCount`, remove the full-list count traversal.

Normal page requests should require approximately one `ListObjectsV2` page plus local presigned-URL generation.

Do not perform Task 5C during Task 5A unless explicitly requested.

## Continuation-token rules

S3/Wasabi continuation tokens are opaque values.

Do not parse or infer structure from them.

When handling token input:

* preserve values exactly;
* allow normal URL/query decoding at the HTTP boundary;
* do not log tokens unnecessarily;
* pass the token to the storage adapter unchanged.

## Prefix/key handling

Object prefixes and keys may contain:

* spaces;
* Unicode;
* `%`;
* `#`;
* `?`;
* other URL-sensitive characters.

Do not assume simple ASCII filenames.

Do not introduce unsafe manual URL assumptions at the backend boundary.

## Page-size validation

Where explicitly included in an approved Phase 5 task, validate page-size inputs simply and explicitly.

Do not add a validation framework solely for one integer.

A page size should be:

* a valid integer;
* greater than zero;
* within an application-approved upper bound.

Do not rely solely on Wasabi/S3 to reject malformed user input.

## Tests

Standard regression command:

`npm test`

Safe integration regression:

`npm run test:integration`

For behavior-preserving backend changes:

1. establish baseline test state where practical;
2. make the smallest requested change;
3. run unit tests again;
4. preserve unrelated behavior.

For the Prefix fix, ensure tests cover a multi-page prefixed listing and verify that `Prefix` is present on continuation requests.

When `TotalKeyCount` is eventually removed, update tests deliberately rather than weakening assertions.

Do not delete or skip tests merely to make changes pass.

## Bruno

Bruno integration tests are part of deployment validation.

Keep production-target guards intact.

Do not commit access tokens.

Do not weaken Entra-aware integration safeguards.

Modify Bruno expectations only when an explicitly approved API-contract change requires it.

## Deployment

Deployment is currently manual.

Do not deploy unless explicitly requested.

Use:

`test`

before:

`prd`

for material changes.

Serverless Framework v4 remains the deployment and IaC mechanism.

Do not replace Serverless with CDK, Terraform, SAM, or another framework during Phase 5.

CI/CD has not yet been implemented.

Do not assume GitHub Actions currently performs deployment.

## Presigned URL expiry

Current production code uses a one-hour presigned URL lifetime.

Do not change this during pagination work unless explicitly requested.

Do not build URL-refresh infrastructure as part of Phase 5.

## Deferred work

Do not opportunistically address:

* thumbnail generation;
* SNS/SQS image processing;
* broad CORS;
* CI/CD;
* production observability;
* API Gateway REST -> HTTP API;
* central error refactoring;
* Create React App;
* frontend UI redesign;
* database introduction;
* Entra app roles;
* Kong.

AWS SDK v3 migration is already complete.

Legacy MongoDB authentication is already removed.

Do not repeat completed modernization work.

## Change discipline

For every task:

1. inspect the current implementation and tests;
2. confirm the exact defect/requirement;
3. make the smallest correct change;
4. preserve security boundaries;
5. preserve unrelated API behavior;
6. avoid unrelated cleanup;
7. keep commits reviewable;
8. run required tests;
9. stop when the requested task is complete.

## Completion report

At the end of each implementation task report:

* branch used;
* files changed;
* exact behavior changed;
* API compatibility impact;
* tests added/updated;
* baseline/final `npm test` result;
* integration result if run;
* deployment performed if explicitly authorized;
* rollback/compatibility concern;
* recommended next task.

Do not automatically implement the next task.
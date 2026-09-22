# Wasabi Drive API - GitHub Copilot Instructions

## Current project phase

Wasabi Drive is an existing production application.

The current backend modernization phase is:

**Phase 5 — Browse Correctness and Pagination Scalability.**

The active implementation task is:

**Task 5C — Remove full-list `TotalKeyCount` traversal.**

The developer is the technical owner and architectural decision-maker.
Copilot is an implementation assistant. Implement only the explicitly requested task; do not independently redesign the application or broaden scope.

Task 5A is complete: continuation requests used by the old count path preserve `Prefix` correctly.

Task 5B is complete and production-validated: the frontend now uses native cursor pagination based on `IsTruncated`, `NextContinuationToken`, and local previous-token history. It no longer requires exact `TotalKeyCount`.

This production compatibility milestone is what makes Task 5C safe to implement now.

## Branch and change safety

`master` is the protected integration/release branch.

For Task 5C use the focused branch:

`refactor/remove-total-key-count`

Never commit implementation changes directly to `master`.

Do not automatically continue to another task after Task 5C.

Keep commits focused and reviewable. Avoid unrelated cleanup, formatting changes, dependency upgrades, framework changes, or architectural redesign.

Do not deploy unless explicitly requested by the technical owner.

## Current production architecture

Backend:

* Node.js 24;
* Express 4;
* CommonJS;
* AWS Lambda;
* API Gateway REST API;
* Serverless Framework v4;
* CloudFormation;
* AWS SDK for JavaScript v3 (Software Development Kit; the code library used to call the S3-compatible storage API);
* Wasabi S3-compatible object storage (S3 = Amazon Simple Storage Service API compatibility);
* `test` and `prd` stages.

Preserve the established dependency direction:

HTTP / Express route
-> application/service layer
-> storage/infrastructure implementation
-> AWS SDK
-> Wasabi.

AWS SDK calls belong in the storage/infrastructure layer.

Application services must not depend directly on Express `req`/`res`.

Local HTTP startup must remain separate from Lambda application construction.

Configuration interpretation remains centralized.

Do not introduce speculative provider abstractions, dependency-injection frameworks, microservices, databases, caches, queues, or new frameworks.

## Established authentication and authorization

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

MSAL = Microsoft Authentication Library. OAuth 2.0 is the access-token protocol used by the frontend to call the protected backend.

Authentication proves the caller identity. Authorization determines whether that authenticated identity is allowed to use Wasabi Drive. Preserve both boundaries.

Never create an unauthenticated fallback for `/buckets`.

Never reintroduce:

* API-key authentication;
* MongoDB authentication;
* bcrypt login;
* UUID authentication tokens;
* optional Entra enforcement.

Trusted-user authorization is an established production boundary. Do not redesign it during Task 5C.

## Established object security

Wasabi objects are private.

The backend generates short-lived presigned `AccessUrl` values only after authentication and authorization. The frontend consumes those URLs directly.

Never:

* make Wasabi objects publicly readable;
* construct permanent public object URLs;
* expose Wasabi credentials;
* proxy file bytes through Lambda without an explicitly approved architectural reason.

Preserve current `AccessUrl` generation and expiry behavior during Task 5C.

## Task 5C objective

Normal bucket/folder browsing currently does two logically separate operations:

1. traverse the entire logical listing to calculate exact `TotalKeyCount`;
2. request the visible page and presign the objects on that page.

The first operation is no longer required by the production frontend and makes browse cost grow with total folder size.

Task 5C removes that full-list counting operation.

Target normal browse cost:

* approximately one `ListObjectsV2` request for the requested page;
* local presigning for objects returned on that page.

Do not replace `TotalKeyCount` with a database, cache, counter table, background job, or another exact-count mechanism.

Exact totals are intentionally being removed from the normal browse contract.

## Required API contract after Task 5C

The object-listing response must continue to preserve native Wasabi/S3 pagination metadata required by the production frontend, including when supplied by Wasabi:

* `IsTruncated`;
* `NextContinuationToken`;
* `ContinuationToken`;
* `KeyCount`;
* `MaxKeys`;
* `Prefix`;
* `CommonPrefixes`;
* `Contents`.

Do not synthesize continuation tokens.

Do not calculate page counts.

Do not return `TotalKeyCount` from the normal object-listing response after this task.

`Contents` objects must continue to receive backend-generated `AccessUrl` values exactly as they do today.

Common prefixes must not be presigned.

Empty/absent `Contents` behavior must remain valid.

## Required implementation boundary

Inspect first, then make the smallest changes needed. Expected relevant files include:

* `src/service/buckets.js`;
* `src/storage/wasabi.js`;
* `test/buckets.service.test.js`;
* `test/wasabi.storage.test.js`;
* `bruno/wasabi-drive-api/buckets/list-objects.bru`;
* `bruno/wasabi-drive-api/buckets/list-objects-next-page.bru`.

Other files may be changed only if the existing implementation genuinely requires it for Task 5C.

### Service layer

Remove the call to `wasabi.getTotalKeyCount()` from normal browsing.

Call `wasabi.getListObjects(params)` only once for the visible page.

Return the storage listing metadata without adding `TotalKeyCount`.

Preserve the current `AccessUrl` enrichment for returned objects.

### Storage layer

If `getTotalKeyCount()` has no remaining production callers after the service change, remove the function and remove it from module exports.

Do not retain dead count traversal code for hypothetical future use.

Do not change `getListObjects()` continuation-token or prefix behavior except where required for the explicitly approved page-size validation below.

### Tests

Update tests deliberately to describe the new contract.

Do not merely delete assertions. Replace old count-based assertions with useful assertions about:

* exactly one visible-page listing request at service level;
* native pagination metadata being passed through;
* `TotalKeyCount` being absent;
* `AccessUrl` still being added to each returned object;
* common prefixes not being signed;
* empty/absent `Contents` remaining valid;
* signing failures still propagating according to existing behavior.

Remove obsolete storage tests for `getTotalKeyCount()` when the function is removed.

Do not weaken authentication or trusted-user tests.

## Continuation-token rules

S3/Wasabi continuation tokens are opaque cursor values.

Do not:

* parse them;
* infer structure from them;
* modify them;
* decode/re-encode them in the service or storage layers;
* log them unnecessarily.

Normal URL/query decoding occurs at the HTTP boundary. Pass the resulting token through the application and storage layers unchanged.

## Prefix and key handling

Prefixes and object keys may contain spaces, Unicode, `%`, `#`, `?`, and other URL-sensitive characters.

Do not add manual URL assumptions or key transformations in Task 5C.

Preserve the current `Prefix` exactly through the service/storage call path.

## Optional secondary item: simple `MaxKeys` validation

Simple page-size validation is approved within Task 5C only if it remains a small, focused change after the count traversal is removed.

If implemented:

* validate only when `MaxKeys` is supplied;
* require a whole decimal integer;
* require `MaxKeys > 0`;
* require `MaxKeys <= 1000`;
* reject partial numeric strings such as `25abc` rather than accepting them through `parseInt`;
* absence of `MaxKeys` must remain allowed;
* do not introduce a validation framework;
* place the rule at an application/API contract boundary rather than relying solely on Wasabi to reject malformed input;
* add focused unit tests for valid, absent, zero, negative, non-integer, partial-string, and over-limit values.

If this validation materially expands the diff or conflicts with an existing API contract discovered during inspection, do not force it. Complete the core Task 5C change and report the validation issue separately.

Do not change continuation-token validation; tokens are opaque.

## Bruno integration contract

Bruno integration tests are part of deployment validation.

The existing list-object Bruno requests currently assert that `TotalKeyCount` exists. Update those expectations for the intentional Task 5C contract change.

For object-listing responses, useful integration assertions include:

* HTTP 200;
* `TotalKeyCount` is absent;
* native cursor metadata such as `IsTruncated` and `KeyCount` is present;
* when `IsTruncated === true`, `NextContinuationToken` is present.

Do not make integration tests depend on exact object totals.

Keep production-target guards intact.

Do not commit access tokens or other secrets.

Do not weaken Entra-aware integration safeguards.

## Required local gates

Before making changes, establish the current unit-test baseline where practical:

`npm test`

After implementation run:

`npm test`

Do not deploy as part of implementation.

Once the technical owner later deploys Task 5C to the `test` stage, the expected integration gate is:

`npm run test:integration`

## Deployment and rollback safety

Deployment remains manual.

Do not deploy unless explicitly requested.

For Task 5C the intended rollout is:

backend `test`
-> Bruno regression
-> manual frontend browse regression against `test`
-> explicit production approval
-> backend `prd`
-> production validation.

The production frontend has already been upgraded to the cursor-based Task 5B contract.

After Task 5C is deployed, the older pre-5B frontend may no longer be compatible because it required `TotalKeyCount`.

Therefore rollback order after Task 5C must be documented and preserved:

1. rollback backend first so the old response contract containing `TotalKeyCount` is restored;
2. only then rollback frontend if a frontend rollback is also required.

Never recommend rolling the frontend back first while the Task 5C backend is still serving the new response contract.

Serverless Framework v4 remains the deployment and Infrastructure as Code (IaC) mechanism. IaC means deployment infrastructure is defined in version-controlled configuration.

Do not replace Serverless with CDK, Terraform, SAM, or another framework during Phase 5.

CI/CD (Continuous Integration / Continuous Delivery) has not yet been implemented. Do not assume GitHub Actions performs deployment.

## Phase 5 non-goals

Do not during Task 5C:

* change Microsoft Entra/MSAL architecture;
* change trusted-user authorization;
* change private-object security;
* change presigned URL architecture or expiry;
* change API Gateway REST API;
* add Lambda authorizers;
* add a database or cache;
* add thumbnail generation;
* add SNS/SQS/image-processing workflows;
* implement CI/CD;
* tighten CORS;
* migrate the frontend or Create React App;
* redesign error handling broadly;
* add broad observability work;
* perform unrelated dependency upgrades or code cleanup.

## Completion report

At completion, stop and report:

* branch used;
* files changed;
* exact full-count traversal removed;
* confirmation that normal browsing performs only the requested page listing at the service/storage boundary;
* confirmation that `getTotalKeyCount()` was removed if unused;
* new object-listing response contract;
* confirmation that native cursor metadata is preserved;
* confirmation that `AccessUrl` behavior is preserved;
* whether `MaxKeys` validation was implemented and its exact contract;
* tests changed/added;
* baseline `npm test` result;
* final `npm test` result;
* Bruno expectations changed;
* deployment impact;
* compatibility impact;
* rollback order;
* anything requiring technical-owner review.

Do not continue to another phase or deploy automatically.
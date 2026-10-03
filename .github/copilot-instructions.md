# Wasabi Drive Backend - GitHub Copilot Instructions

## Ownership and working agreement

Wasabi Drive is a deployed personal application and an enterprise-architecture/cloud-engineering learning project. The developer is the technical owner and architectural decision-maker. ChatGPT assists with architecture, task specifications and review; Copilot implements only the selected task.

Prefer small, reviewable changes. Do not independently redesign architecture, expand a task, change cloud permissions, upgrade dependencies or deploy. When explaining a newly introduced acronym or technology, expand it and briefly explain its relevance to Wasabi Drive.

Read the current source and the owner's latest task prompt before editing. Source is authoritative for existing behavior; the owner's task specification defines the intended change. Report a material conflict rather than guessing. A roadmap item is not permission to implement it.

## Current phase and active task

Current phase: **Phase 7 - Production Reliability and Observability**.

Completed and production-validated:

- Microsoft Entra authentication and trusted-user authorization;
- private Wasabi object access with server-generated `AccessUrl` values;
- AWS SDK for JavaScript v3;
- cursor pagination and opaque continuation-token handling;
- multi-region Wasabi bucket discovery/client reuse;
- Phase 6 Continuous Integration / Continuous Delivery (CI/CD);
- Task 7A API error boundary and `MaxKeys` validation.

The active implementation task is **Task 7B - Structured backend request/error logging** on branch `feat/structured-request-logging`.

Implement only Task 7B when explicitly instructed. Stop for review afterward. Do not start Task 7C or frontend Tasks 7D/7E.

## Established architecture

- Node.js 24, Express 4, CommonJS JavaScript.
- Amazon Web Services (AWS) Lambda runs the application; API Gateway REST API forwards requests to Express.
- `serverless-http` adapts the Express application to Lambda.
- Serverless Framework v4 and CloudFormation manage deployment; preserve `frameworkVersion: "~4.42.0"`.
- AWS Software Development Kit (SDK) for JavaScript v3 accesses Wasabi's Simple Storage Service (S3)-compatible private storage.
- Separate `test` and `prd` stages.
- Existing CloudWatch Logs are the initial observability destination.

Preserve dependency direction:

`HTTP / Express route -> application/service -> storage/infrastructure -> AWS SDK -> Wasabi`

Logging is a cross-cutting API/runtime concern. Do not make the service or storage layers depend on Express or HTTP logging infrastructure.

Current source map:

- `src/app.js`: parsers, Cross-Origin Resource Sharing (CORS), health route, protected bucket mount, final error handler and Lambda adapter export.
- `src/api/buckets.js`: bucket HTTP routes.
- `src/api/errorHandler.js`: Task 7A final HTTP error mapping and current minimal `5xx` diagnostics.
- `src/errors.js`: small application-owned error model.
- `src/service/buckets.js`: service orchestration and object `AccessUrl` generation.
- `src/storage/wasabi.js`: SDK calls, region discovery/cache, regional clients, provider error translation and signing.
- `src/authentication/`: Entra token validation and trusted-user authorization.
- `src/config/index.js`: centralized application configuration.
- `serverless.yml`: Lambda/runtime configuration.
- `.github/workflows/backend-test-deploy.yml`: automatic `test` deployment after merge to `master`.
- `.github/workflows/backend-prd-deploy.yml`: manual exact-SHA production promotion.
- `test/`: Node.js built-in test runner tests.
- `bruno/wasabi-drive-api/`: read-only integration requests.

## Security invariants

Microsoft Authentication Library (MSAL) obtains the frontend's Microsoft Entra OAuth 2.0 access token. OAuth 2.0 authorizes API access; OpenID Connect (OIDC) provides the identity layer used by sign-in and deployment federation. The backend validates the bearer access token and then enforces trusted-user authorization.

Preserve:

- mandatory Entra validation for `/buckets`;
- signature, issuer, audience, expiry and required-scope checks;
- trusted tenant/user Object ID checks and fail-closed configuration;
- authentication before authorization and bucket-query validation;
- `401` with `{ "error": "Unauthorized" }` for missing/invalid authentication;
- `403` with `{ "error": "Forbidden" }` for missing required scope or unauthorized authenticated users;
- unexpected verifier failures remaining `500`, not being relabeled as invalid credentials.

The backend is the security authority. CORS is a browser access policy, not authentication. API Gateway API keys are not user authentication. Do not restore legacy MongoDB/password/bcrypt/UUID authentication, frontend-only authorization, or an authentication bypass.

Wasabi credentials stay server-side. Objects stay private. `AccessUrl` is generated server-side; never introduce public/raw object URLs or browser signing. Preserve the current 3600-second signing duration.

`GET /health` remains shallow, unauthenticated and exactly `200` with `{ "status": "ok" }`. Do not add dependency probes or release information to the health response.

## Task 7A behavior is now an invariant

Preserve the production-validated Task 7A error model:

| Condition | Status | Body |
| --- | --- | --- |
| Invalid `MaxKeys` | 400 | `{ "error": "MaxKeys must be an integer between 1 and 1000." }` |
| Missing/invalid authentication | 401 | `{ "error": "Unauthorized" }` |
| Authenticated but unauthorized / missing required scope | 403 | `{ "error": "Forbidden" }` |
| Unexpected application/configuration/local-signing error | 500 | `{ "error": "Internal Server Error" }` |
| Recognized Wasabi service/transport failure | 502 | `{ "error": "Bad Gateway" }` |

Do not expose raw provider errors, messages, stacks, causes, SDK metadata or arbitrary status fields. Keep the explicit parser compatibility behavior for safe `400`, `413` and `415` responses and malformed encoded routes. Preserve `res.headersSent` delegation.

`MaxKeys` remains optional. Supplied input is one ASCII-decimal string resolving to a safe integer from 1 through 1000; invalid input is rejected after authentication/authorization and before service/storage invocation. Do not add a validation framework.

Recognized Wasabi service/transport failures are wrapped only at SDK request boundaries. Valid `307 TemporaryRedirect` region discovery is handled before terminal failure wrapping. Provider `401`/`403` never become Entra responses. Local signing/programming/configuration failures remain `500`.

## Storage and pagination invariants

The configured Wasabi endpoint/region is the bootstrap client for account-level listing and bucket-region discovery, not a claim that all buckets use that region.

Preserve:

- `GetBucketLocation` discovery;
- validated `307 TemporaryRedirect` handling;
- bucket-specific Wasabi hostname validation and canonical HTTPS regional endpoints;
- region/client caches and eviction of failed discovery promises;
- existing empty-location, `EU`, and US East 1 alias handling;
- correct regional client use for listing and presigning;
- `ListObjectsV2`, `Delimiter: "/"`, prefixes and opaque continuation tokens;
- all successful response fields and per-object `AccessUrl`;
- no `TotalKeyCount` or full-list traversal.

Never follow arbitrary provider endpoints, broaden redirect acceptance, add a new retry loop, decode/reconstruct continuation tokens or change caching policy in 7B.

## Task 7B design

Task 7B adds a deliberately small structured logging boundary using ordinary `console` output and existing CloudWatch Logs. Do not add a logging library unless the owner explicitly changes this decision.

### Request identifier

Use the existing AWS Lambda invocation identifier as the request correlation identifier. `serverless-http` supports a request customization hook receiving the Express request, Lambda event and Lambda context. Attach only the safe Lambda request ID (`context.awsRequestId`) needed by logging; do not attach or expose the full Lambda event/context to application code.

Do not generate a second UUID in Lambda. For local Express execution where no Lambda context exists, the request ID may be absent; local operation must continue normally.

### Request lifecycle logging

Add one global request-lifecycle logging middleware early enough to observe parser, authentication, authorization, route and error responses. Emit **one structured completion record per completed HTTP response**. Avoid duplicate route/service/storage logging.

Use fixed/allowlisted fields only. The intended schema is:

- `level`: `info`, `warn`, or `error`;
- `requestId`: Lambda invocation request ID when available;
- `method`: HTTP method;
- `route`: safe route template/group, never the raw URL;
- `operation`: fixed application operation when known;
- `status`: final HTTP status;
- `durationMs`: non-negative request duration in milliseconds;
- `stage`: configured deployment stage when available;
- `releaseSha`: validated deployed Git SHA when available;
- `errorCategory`: only for failures (`client`, `authentication`, `authorization`, `application`, or `storage`);
- `storageOperation`: fixed SDK/storage operation only for `StorageProviderError` when applicable;
- `providerStatus`: valid numeric provider HTTP status only when already safely available.

Use `console.log` for successful/non-error completions, `console.warn` for `4xx`, and `console.error` for `5xx`. The serialized message itself must be JSON.

Do not log raw `req.path`, `req.originalUrl`, query strings or parameter values. Use fixed route templates/groups such as `/health`, `/buckets`, `/buckets/:name/region`, and `/buckets/:Bucket/objects/:Prefix(*)`. For authentication/authorization failures before the bucket router resolves a specific route, `/buckets` is sufficient.

Use fixed application operation names. Do not put bucket names, prefixes, object keys or continuation tokens into `operation` or route metadata.

### Error integration

Task 7A currently emits a minimal `5xx` record in the final error handler. Task 7B should fold that safe information into the single request-completion log rather than produce duplicate records.

The final error handler may store only sanitized classification metadata for the lifecycle logger before returning the existing public response. Preserve all Task 7A response mappings exactly.

For storage failures, keep the fixed storage operation and valid numeric provider status if present. Never copy raw error objects, `cause`, SDK responses, stacks or messages into logging context.

### Release/stage attribution

Inject runtime deployment metadata without creating a new release system.

- `DEPLOYMENT_STAGE` comes from the Serverless stage (`test` or `prd`) in `serverless.yml`.
- `RELEASE_SHA` comes from the **actual checked-out Git commit** in the deployment workflow.
- Add these Lambda environment values through the existing Serverless configuration.
- Centralize runtime reads in `src/config/index.js` rather than reading arbitrary environment variables throughout logging code.
- Treat `releaseSha` as present only when it is a full 40-character hexadecimal Git commit SHA. Local execution without it must still work.

For both deployment workflows, derive `RELEASE_SHA` from `git rev-parse HEAD` after checkout/verification and export it for subsequent deployment steps. Do not rely on production `github.sha`, because a manually promoted historical `master` commit can differ from the workflow-dispatch commit.

Workflow edits are authorized **only** for this narrow release-SHA propagation. Preserve every existing checkout validation, pinned action, permission, OIDC role, Environment, concurrency rule, test gate, deploy command and smoke check.

### Never log

Never log or serialize:

- bearer/access tokens or `Authorization` headers;
- raw headers or request/response bodies;
- Microsoft Entra claims, tenant/user Object IDs or allowlists;
- Wasabi access keys/secrets or AWS credentials;
- private keys or environment-secret dumps;
- bucket names, prefixes, object keys or continuation tokens;
- complete presigned `AccessUrl` values or their query parameters;
- raw AWS SDK/Wasabi error objects;
- raw error messages, stacks, causes, `$response`, or unfiltered `$metadata`;
- full request URLs or query strings.

## CI/CD: preserve, except approved 7B metadata propagation

Pull requests to protected `master` run tests only and have no deployment capability. Merge to `master` automatically deploys `test`. Production remains a manual exact-full-SHA promotion from `master` history with detached checkout, SHA verification, re-testing, the protected `prd` Environment and serialized deployment. Rollback remains promotion of a known-good historical `master` SHA.

GitHub OIDC exchanges workflow identity for short-lived AWS Security Token Service (STS) credentials through dedicated test/production Identity and Access Management (IAM) roles. Preserve that separation. Do not introduce permanent AWS deployment keys, broaden IAM or automatically deploy production on merge.

Do not modify the PR workflow. Do not change deployment identities, permissions, action versions, Serverless version, smoke-test scope or integration target safety.

## Tests and change management

Use branch `feat/structured-request-logging`; never commit directly to `master`, use a Phase 7 mega-branch, force-push, discard user changes, or deploy unless explicitly requested.

Before implementation inspect branch/status and record the starting commit. Start from current `master` using fast-forward-only synchronization when safe. Do not silently move a dirty worktree.

Run on Node.js 24:

```text
npm ci
npm test
# Implement only Task 7B, then:
npm test
git diff --check
git status --short
```

Use existing `node:test` and `node:assert/strict` patterns, local HTTP servers and stubs. No new test framework is needed.

Add focused tests proving at least:

- one structured completion record is emitted for a successful request;
- Lambda `context.awsRequestId` reaches the structured record through the `serverless-http` request hook;
- `durationMs` and final HTTP status are present;
- configured stage and valid release SHA are emitted when present;
- local/missing runtime metadata does not break requests;
- `401`, `403`, client `4xx`, unexpected `500`, and storage `502` keep their existing response contracts and receive the correct safe category;
- storage `502` retains safe storage operation/provider status metadata without raw provider details;
- only fixed route templates/groups and fixed operations are logged;
- bearer tokens, authorization headers, query values, continuation tokens, bucket/object/prefix values, presigned URLs, credentials, raw errors/messages/stacks/causes and Entra identifiers do not appear in captured logs;
- the existing `/health` response remains unchanged;
- existing multi-region, pagination, signing, authentication, authorization and Task 7A tests continue to pass.

Bruno full regression (`npm run test:integration`) remains read-only, manual and restricted to `local`, `development` or `test`; never `prd`. Use it only when a safe configured target and permission are available. Otherwise report that it was not run and why.

`deployment-smoke` remains only `/health` 200 and unauthenticated `/buckets/` 401 and retains approved production use. Do not add authenticated/provider requests to that smoke scope.

## Expected Task 7B areas

Expected changes are limited to areas such as:

- a small `src/observability/` request-logging helper/middleware;
- `src/app.js` for early logging middleware, fixed route-group metadata and the `serverless-http` request hook;
- `src/api/buckets.js` only for fixed safe route/operation metadata if needed;
- `src/api/errorHandler.js` to feed sanitized error context to the single completion log instead of independently logging;
- `src/config/index.js` for centralized stage/release metadata;
- `serverless.yml` for runtime `DEPLOYMENT_STAGE` and `RELEASE_SHA` injection;
- `.github/workflows/backend-test-deploy.yml` and `.github/workflows/backend-prd-deploy.yml` only to export the actual checked-out SHA for deployment;
- focused tests and concise README documentation.

No package or lockfile changes are expected.

## Explicit non-goals

Do not implement Task 7C alarms/dashboards, AWS X-Ray, OpenTelemetry, distributed tracing, an external observability SaaS, a logging framework, log shipping, retention-policy changes or CloudWatch infrastructure changes.

Do not redesign Entra/MSAL, CORS, API Gateway, Lambda authorizers, Serverless architecture, multi-region storage, pagination, signing, error response contracts, frontend code, dependency versions, Express 5, TypeScript, ECMAScript modules, Create React App, thumbnails, SNS/SQS, databases, viewer features or Phase 8 work.

Do not add user identity to logs.

## Completion report

Stop after Task 7B. Report:

- branch and starting/base SHA;
- exact files changed;
- final structured log schema and level/category rules;
- how Lambda request ID is propagated;
- how `DEPLOYMENT_STAGE` and exact checked-out `RELEASE_SHA` reach Lambda;
- confirmation that production historical-SHA promotion still works;
- tests added and exact commands/results/counts;
- evidence that secrets/private values/raw errors are absent from logs;
- integration tests run or omitted and why;
- `git diff --check` and `git status --short` results;
- confirmation that package files, dependencies, security architecture, successful API contracts, deployment permissions/identities and frontend are unchanged;
- proposed focused commit messages;
- any remaining issues.

Do not commit, push, create/merge a PR, deploy, or continue to Task 7C unless separately instructed.

# Wasabi Drive Backend - GitHub Copilot Instructions

## Ownership and working agreement

Wasabi Drive is a deployed personal application and an enterprise-architecture/cloud-engineering learning project. The developer is the technical owner and architectural decision-maker. ChatGPT assists with architecture, task specifications and review; Copilot implements only the selected task.

Prefer small, reviewable changes. Do not independently redesign architecture, expand a task, change cloud permissions, upgrade dependencies or deploy. When explaining a newly introduced acronym or technology, expand it and briefly explain its relevance to Wasabi Drive.

Read the current source and the owner's latest task prompt. Source is authoritative for existing behavior; the owner's task specification defines the intended change. Report a material conflict rather than guessing. A roadmap item is not permission to implement it.

## Current phase and task gate

Current phase: **Phase 7 - Production Reliability and Observability**.

Identity modernization, private-object access, cursor pagination, multi-region bucket support, and Phase 6 Continuous Integration / Continuous Delivery (CI/CD) are complete. Do not repeat them.

The initial implementation task is **Task 7A - Backend API error boundary and request validation**, on `refactor/api-error-boundary`. Implement only 7A when explicitly instructed. Stop for review afterward.

Later backend tasks, requiring separate approval and branches:

- 7B: structured request/error logging, `feat/structured-request-logging`.
- 7C: evaluate minimal operational visibility, `ops/backend-runtime-alerts`.

Frontend tasks 7D/7E belong to the frontend repository and are not backend work.

## Established architecture

- Node.js 24, Express 4, CommonJS JavaScript.
- Amazon Web Services (AWS) Lambda runs the application; API Gateway REST API forwards requests to Express.
- Serverless Framework v4 and CloudFormation manage deployment. `serverless.yml` enforces `frameworkVersion: "~4.42.0"`; preserve the existing manifest and lockfile rather than changing their ranges in 7A.
- AWS Software Development Kit (SDK) for JavaScript v3 accesses Wasabi's Simple Storage Service (S3)-compatible private storage.
- Separate `test` and `prd` deployment stages.

Preserve this dependency direction:

`HTTP / Express route -> application/service -> storage/infrastructure -> AWS SDK -> Wasabi`

Hypertext Transfer Protocol (HTTP) response mapping belongs at the API boundary, not in the storage implementation. Services and storage must not import Express or HTTP route modules.

Current source map:

- `src/app.js`: parsers, Cross-Origin Resource Sharing (CORS), health route, protected bucket mount, Lambda adapter export.
- `src/api/buckets.js`: bucket routes.
- `src/service/buckets.js`: service orchestration and adding object `AccessUrl` values.
- `src/storage/wasabi.js`: SDK calls, region discovery/cache, regional clients and signing.
- `src/authentication/`: Entra token validation and trusted-user authorization.
- `test/`: existing Node.js test runner tests.
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
- unexpected verifier failures continuing to the server-error boundary, not being mislabeled as invalid credentials.

The backend is the security authority. CORS is a browser access policy, not authentication. API Gateway API keys are not user authentication. Do not restore MongoDB/password/bcrypt/UUID authentication, frontend-only authorization, or an authentication bypass.

Wasabi credentials stay server-side. Objects stay private. `AccessUrl` is generated server-side; never introduce public/raw object URLs or browser signing. Preserve the current 3600-second signing duration.

`GET /health` remains shallow, unauthenticated and exactly `200` with `{ "status": "ok" }`. It must not call Wasabi or Entra, or expose configuration or release details in 7A.

## Storage and pagination invariants

The configured Wasabi endpoint/region is the bootstrap client for account-level listing and bucket-region discovery, not a claim that all buckets use that region.

Preserve the implemented multi-region behavior:

- `GetBucketLocation` discovery;
- recognition of the existing validated `307 TemporaryRedirect` response before error translation;
- bucket-specific Wasabi hostname validation and canonical HTTPS regional endpoints;
- region/client caches and eviction of a failed region-discovery promise;
- existing empty-location, `EU`, and US East 1 alias handling;
- use of the correct regional client for listing and presigning.

Never follow an arbitrary provider-supplied endpoint, broaden redirect acceptance, add a new retry loop or change caching policy in 7A.

Preserve `ListObjectsV2`, `Delimiter: "/"`, prefixes, opaque continuation tokens, all successful response fields, and per-object `AccessUrl`. An opaque token is provider-owned data: do not decode, interpret, reconstruct or validate it as a filename. Do not restore `TotalKeyCount` or full-list traversal. A warm browse normally uses one listing page plus local signing; initial region discovery may add a request.

## Task 7A design constraints

Use a small application-owned error model: at most `InputValidationError` and `StorageProviderError`, with no hierarchy/framework. Place shared errors outside HTTP route modules. Retain an original provider error as an internal `cause`, never as public response data.

Use one final Express error-handling middleware after routes. Express 4 asynchronous handlers must explicitly forward caught errors with `next(error)`. Delegate with `next(error)` when `res.headersSent` is true; do not send twice or swallow startup failures.

The selected public contract is JSON (JavaScript Object Notation) with one `error` string:

| Condition | Status | Body |
| --- | --- | --- |
| Invalid `MaxKeys` | 400 | `{ "error": "MaxKeys must be an integer between 1 and 1000." }` |
| Missing/invalid authentication | 401 | `{ "error": "Unauthorized" }` |
| Authenticated but unauthorized / missing required scope | 403 | `{ "error": "Forbidden" }` |
| Unexpected application/configuration/local signing error | 500 | `{ "error": "Internal Server Error" }` |
| Recognized Wasabi service/transport failure | 502 | `{ "error": "Bad Gateway" }` |

Use `502`, not a blanket `503`: this task represents failure at the storage boundary, without asserting a maintenance window, transient overload or known retry interval. Do not invent `Retry-After`, automatic retries, or a provider-to-client status translation catalog.

Recognize remote SDK/service and known transport failures narrowly at SDK call boundaries. Do not wrap every exception in the storage module as a provider failure. Local programming, credential-configuration and local signing defects must still be `500`. Handle valid region redirects before wrapping failures. Provider `401`/`403` must never become Entra authentication/authorization responses.

Never derive a public status/message from arbitrary `error.status`, `error.statusCode`, `error.message`, `$metadata`, `$response` or `cause`. Only application-owned errors and the task's narrow existing-parser error allowlist may select a public client response. Preserve existing parser/routing client-error semantics rather than turning malformed input or body-limit errors into `500`. The focused task prompt defines that allowlist.

Do not change existing authentication modules just to make their already-stable `401`/`403` responses pass through the new handler. Successful responses and existing not-found routing behavior remain unchanged.

### MaxKeys

Validate at the bucket HTTP boundary, after existing authentication/authorization and before the service/storage call:

- omitted means omitted; do not introduce a new default;
- supplied input must be one string containing only ASCII decimal digits;
- convert once to a safe integer in the inclusive range 1 through 1000;
- leading zeroes are allowed; whitespace, signs, decimals, exponent/hex notation, junk suffixes, empty values, arrays, objects and repeated parameters are rejected;
- pass the resulting number to service/storage; remove permissive `parseInt` coercion there;
- do not clamp, silently replace invalid input, change query-parser configuration or add a validation library.

### Minimal diagnostics in 7A

The error boundary may emit one minimal server-side record per `5xx`, using ordinary `console` and an allowlist of fixed category, selected HTTP status, fixed SDK operation and numeric provider status. Do not add request lifecycle logging, correlation IDs, release injection, telemetry dependencies or cloud configuration in 7A.

Never log or return raw request/response/error objects, headers, bodies, bearer tokens, credentials, private keys, continuation tokens, object keys, full query strings or complete presigned URLs. Do not dump an unsanitized stack/message/cause: those can contain sensitive data. Keep raw causes internal and emit only deliberately selected safe fields. Avoid duplicate logging in route/service/storage catches.

## Later observability tasks: reference only

When separately approved, 7B should use structured JSON and existing Amazon CloudWatch Logs, AWS's existing log destination for this Lambda. Prefer ordinary application logging unless a library has a concrete benefit.

Evaluate an existing API Gateway/Lambda request identifier before inventing a correlation ID. A correlation ID ties events to one request. Evaluate stage, route template, operation, status, duration and deployed Git commit SHA (Secure Hash Algorithm-based commit identifier). A release identifier ties runtime errors to the exact deployed source and workflow.

For production, the deployed source SHA may differ from the workflow-dispatch SHA. Use the verified checked-out commit, not an assumption about `github.sha`. No workflow or runtime-configuration edits are authorized by this reference section.

7C should assess useful Lambda/API failure signals and cost before adding alarms. Practical documented CloudWatch checks may be enough for a personal project. No external observability platform, broad dashboard suite or distributed-tracing infrastructure is pre-approved.

## Completed CI/CD: preserve

Do not modify `.github/workflows/*`, deployment scripts, `serverless.yml`, GitHub Environments or cloud permissions unless the owner explicitly authorizes a concrete change for the selected task.

Preserve pinned actions, Node.js 24 and clean `npm ci`:

- pull requests (PRs) to protected `master`: tests only, no deployment capability;
- merge to `master`: automatic backend `test` deployment and deployed smoke checks;
- production: manual full 40-character source-SHA promotion from `master` history, detached checkout, SHA verification, re-testing, protected `prd` Environment and serialized deployment;
- rollback: manually promote a known-good historical `master` SHA, preferably one including the current health/smoke capability.

GitHub OIDC exchanges workflow identity for short-lived AWS Security Token Service (STS) credentials through dedicated test/production Identity and Access Management (IAM) roles. Preserve that separation. Do not introduce permanent AWS deployment keys, broaden IAM or automatically deploy production on merge.

## Tests, integration safety and change management

Use one focused branch per task; never commit to `master`, use a Phase 7 mega-branch, force-push, discard user changes, or create a temporary integration branch without approval.

Before implementation inspect branch/status and record the starting commit. Start from current `master` using fast-forward-only synchronization when safe. Do not silently move a dirty worktree. Do not commit, push, create/merge a PR or deploy unless explicitly requested.

For 7A run on Node.js 24:

```text
npm ci
npm test
# Implement only the approved task, then:
npm test
git diff --check
git status --short
```

Use the existing `node:test` and `node:assert/strict` patterns, local HTTP test servers and SDK/dependency stubs. No test framework/dependency is needed. Test actual route wiring as well as helpers. Restore mocks, module caches and environment changes; close local servers.

Preserve all security, pagination, signing, regional-routing and integration-target tests. Assertions about raw error identity may be updated to assert the approved wrapper and original `cause`; do not remove their retry/cache/redirect safety assertions. Numeric internal `MaxKeys` fixtures may change with the deliberate boundary normalization.

Bruno full regression (`npm run test:integration`) remains read-only, manual and restricted to `local`, `development` or `test`; never `prd`. The `test` target requires a short-lived delegated Entra access token. Use it only when a safe target/configuration and the owner's permission are available. Do not print/store tokens or weaken target validation. Otherwise report that integration was not run and why.

`deployment-smoke` remains only `/health` 200 and unauthenticated `/buckets/` 401, with no token or Wasabi operation. Its existing scope/target checks and approved production use are unchanged. Do not add authenticated requests to that tag.

Expected 7A areas: `src/app.js`, `src/api/buckets.js`, narrowly scoped error/validation helpers, SDK failure translation in `src/storage/wasabi.js`, focused tests, and concise README/Bruno documentation. Service orchestration should normally remain unchanged. No package/lockfile changes are expected.

Prefer proposed commits such as `refactor(api): centralize error handling`, `fix(api): validate MaxKeys`, and `test(api): cover provider and validation failures`. Do not actually commit without instruction.

## Explicit non-goals and completion

No Entra/MSAL redesign, CORS changes, Lambda authorizers, API Gateway migration, Express 5, TypeScript, ECMAScript modules (ESM), new database, dependency upgrades, audit auto-fixes, deployment redesign, frontend changes, thumbnails, queue/event infrastructure, viewer features or Phase 8 work.

For 7A also exclude full structured request logging, correlation/release configuration, alarms and changes to workflows or cloud resources.

Stop after the selected task. Report branch/base SHA, exact files changed, error mapping, validation rules, preservation of multi-region behavior, security/non-leakage tests, exact commands/results/counts, integration omissions, diff/status checks, unchanged protected areas, proposed commits and remaining issues. Do not claim tests/deployments that did not run. Do not continue to 7B automatically.

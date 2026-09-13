# Wasabi Drive API - Copilot Instructions

## Project context

Wasabi Drive API is an existing Node.js/Express API for browsing and previewing
files stored in Wasabi Cloud Storage.

The application is currently intended for a small number of trusted users, but
it may eventually evolve into a multi-user product.

This project is also being used to learn and apply enterprise-level software
architecture and engineering practices.

## Modernization approach

Modernize the application incrementally.

Do not perform large-scale rewrites unless explicitly requested.

Prefer small, reviewable changes that preserve existing behavior unless a
behavior change has been explicitly approved.

The developer remains responsible for architectural decisions. For significant
changes, inspect the current implementation, explain the problem and proposed
boundary, and obtain approval before broad implementation when the prompt asks
for an assessment first.

Do not opportunistically fix unrelated issues during a scoped task.

## Current phase

The project is in Phase 2: Structural Refactoring, with a pre-deployment
hardening checkpoint in progress.

Completed architectural changes include:

- Express application construction is separated from local server startup.
- Environment configuration is centralized under `src/config`.
- Deployment secrets are not stored as literal values in tracked
  `serverless.yml`.
- AWS Lambda targets Node.js 24.
- Serverless Framework v4 is used.
- Bucket routes call an application service rather than the Wasabi SDK
  implementation directly.
- Wasabi/AWS SDK code is isolated under `src/storage/wasabi.js`.
- A Node built-in unit-test suite exists.
- A Bruno API integration-test collection exists.

Do not undo these boundaries without an explicitly approved architectural
reason.

## Runtime and deployment conventions

The supported Node.js major version is Node 24, as declared in `package.json`.

The project uses:

- CommonJS (`require` / `module.exports`);
- Express;
- Serverless Framework v4;
- AWS Lambda;
- API Gateway REST API;
- `serverless-http`.

Do not migrate CommonJS to ESM, JavaScript to TypeScript, Express to another
framework, API Gateway REST API to HTTP API, or Serverless to another
infrastructure framework unless explicitly requested.

Do not deploy or create/update AWS resources unless the task explicitly
authorizes deployment.

## Configuration and secrets

Application configuration is centralized in `src/config`.

Application modules outside the configuration boundary should not directly
interpret application environment variables unless explicitly justified.

Local development configuration may come from ignored `.env` files.

Tracked files must never contain real:

- Wasabi access keys;
- Wasabi secret keys;
- MongoDB passwords or authenticated connection strings;
- AWS credentials;
- Serverless access/license keys;
- other secrets or tokens.

`serverless.yml` should reference environment variables rather than contain
literal secrets.

`.env` and `.serverless` artifacts must remain untracked.

Do not print, log, commit, copy into test reports, or reproduce secret values.

If a secret is discovered in tracked source or Git history, report the type and
location without displaying the value and recommend credential rotation.

## Architectural direction

The API is a modular monolith with clear responsibility boundaries.

Prefer this dependency direction:

Express routes
-> application/service logic
-> infrastructure/storage implementation
-> external SDK/service

For bucket/storage functionality, the intended flow is:

`src/api/buckets.js`
-> `src/service/buckets.js`
-> `src/storage/wasabi.js`
-> AWS SDK
-> Wasabi

### HTTP boundary

Express route modules should own HTTP concerns such as:

- route registration;
- request parameter extraction;
- HTTP status codes;
- response serialization.

Application services should not depend on Express `req` or `res` objects.

### Application/service boundary

Application services should own use-case orchestration and application logic.

They should not:

- import Express;
- configure AWS SDK clients;
- read Wasabi credentials;
- depend on HTTP request/response objects.

### Storage boundary

`src/storage/wasabi.js` currently owns Wasabi/AWS SDK infrastructure concerns.

Other application modules should not import `aws-sdk` directly unless an
explicitly approved migration changes this boundary.

Do not introduce a generic provider framework, provider factory, dependency
injection framework, abstract base class, or speculative interface solely for
future extensibility.

## Refactoring rules

For a significant refactoring:

1. Identify the current responsibility of the affected code.
2. Identify the actual structural or maintenance problem.
3. Explain the proposed responsibility/boundary change.
4. Prefer the smallest useful change.
5. Identify behavior and risks that must be verified.
6. Keep unrelated behavior unchanged.
7. Keep the change small enough to review and commit independently whenever
   practical.

Avoid speculative abstractions and design-pattern usage for its own sake.

Do not perform unrelated formatting or cleanup in a scoped refactor.

## Automated unit-test regression gate

The existing unit tests are a required regression gate.

The standard unit-test command is:

`npm test`

For behavior-preserving refactors and dependency changes:

1. Run `npm test` before modifying production code.
2. Record the baseline result.
3. Run `npm test` after the change.
4. Existing passing tests must remain passing.
5. Do not delete, skip, weaken, or rewrite assertions merely to make a change
   pass.

If tests fail before the requested change, report the baseline failure instead
of hiding it.

If a behavior change is explicitly approved, update or add tests only when the
old assertion no longer represents the approved contract.

Add focused tests when a change affects important behavior that is not
adequately protected, but do not turn every scoped task into a broad testing
initiative.

## Bruno integration-test regression gate

The repository contains a Bruno collection under
`bruno/wasabi-drive-api`.

The npm integration command is:

`npm run test:integration`

Integration testing requires live external dependencies and must be treated
differently from isolated unit tests.

Before running Bruno tests:

- verify that the target is local or explicitly non-production;
- verify the required environment variables are configured;
- verify that Wasabi and MongoDB resources used for testing are safe for the
  test;
- never run mutating user requests against production data;
- use unique/disposable integration-test user data where required.

If the required integration environment is unavailable, report that the
integration suite was not run. Do not fabricate results and do not modify tests
merely to bypass unavailable infrastructure.

For applicable refactors, run the same safe integration scope before and after
the change and compare results.

### Current integration-test limitation

The current Bruno collection includes mutating authentication requests and an
`Update user` scenario that exposes a known existing API defect.

Do not redefine the defect as successful behavior, weaken the assertion, or
silently ignore a new failure.

Until the test harness or defect is explicitly addressed:

- clearly distinguish passing regression scenarios from known-defect scenarios;
- do not claim the entire integration suite is green if the known defect still
  fails;
- do not run destructive requests against production;
- report baseline known failures separately from newly introduced regressions.

## Test artifacts

Generated test reports should not be committed unless explicitly intended as
versioned project artifacts.

Do not expose secrets, passwords, tokens, authorization headers, or sensitive
response bodies in committed test reports.

## Security posture

Security-sensitive behavior must not be changed incidentally during structural
refactoring.

Known security/deployment concerns should be handled as explicit tasks with
their own review and tests.

Do not assume CORS is authentication or authorization.

Do not expose password hashes, tokens, credentials, or secret configuration in
logs, reports, example files, or Copilot responses.

## Known issues / modernization backlog

The following issues are known. Do not opportunistically fix them during an
unrelated task:

- API authorization is not yet implemented for the public endpoints.
- User-management responses currently expose database documents too directly.
- The user update flow has an existing MongoDB `_id` update defect.
- The Wasabi total-key pagination flow currently loses `Prefix` on subsequent
  pages.
- MongoDB connection initialization currently occurs during module import.
- AWS SDK for JavaScript v2 is end-of-support and should eventually migrate to
  v3.
- Express and some related dependencies require security/maintenance updating.
- Error handling is still route-local and inconsistent.
- Broad CORS behavior needs to be reconsidered as part of security hardening.

Treat each as a separate, explicitly approved task unless the current prompt
specifically scopes it in.

## Dependency changes

Do not run broad dependency upgrades.

For dependency-security or runtime tasks:

- change only dependencies required by the approved task;
- allow necessary transitive lockfile changes;
- do not run `npm audit fix --force`;
- do not use audit findings as permission to upgrade unrelated packages;
- report remaining findings for separate review.

Major-version upgrades require explicit approval.

## Scope constraints

Unless explicitly requested, do not introduce:

- microservices;
- a new database;
- authentication-provider redesign;
- new AWS or Azure infrastructure;
- Terraform or CDK;
- CI/CD redesign;
- TypeScript migration;
- ESM migration;
- major UI work;
- framework replacement;
- speculative multi-cloud support;
- unrelated dependency upgrades.

## Completion expectations

For an implementation task, provide a concise completion report containing:

- files changed;
- responsibilities or behavior changed;
- tests run before and after;
- unit-test results;
- applicable integration-test results or a clear reason they could not safely
  run;
- assumptions and limitations;
- any remaining known issues relevant to the task.

Do not proceed automatically to the next modernization task after completing
the requested scope.

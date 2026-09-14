# Wasabi Drive API - Copilot Instructions

## Project goal

Wasabi Drive API is an existing Node.js/Express API for browsing files in
Wasabi Cloud Storage.

The immediate goal is **a stable, tested, frontend-compatible RC1 that can be
deployed before the developer's limited GitHub Copilot credits are exhausted**.
Do not try to finish every modernization item before RC1.

Prioritize only:

1. RC1 deployment blockers;
2. security patches required for RC1;
3. regressions that affect the existing frontend.

Defer optional modernization until after RC1 unless explicitly requested.
Prefer one small implementation task over speculative assessment/refactoring.
Do not automatically continue to the next task.

## Preserve the existing frontend contract for RC1

Unless explicitly approved, do not change:

- route paths or HTTP methods;
- request/query parameter names;
- successful response shapes;
- status-code behavior;
- bucket/object response structures;
- current login/validation response shapes;
- CORS behavior;
- the current legacy authentication contract.

If a requested change is likely to break the existing frontend, stop and report
the compatibility risk before changing behavior.

## Current architecture

Keep these established boundaries:

- `src/server.js` owns local HTTP startup.
- `src/app.js` constructs the Express application and Lambda handler.
- `src/config` is the application configuration boundary.
- Bucket flow is:
  `src/api/buckets.js` -> `src/service/buckets.js` ->
  `src/storage/wasabi.js` -> AWS SDK -> Wasabi.
- Only the storage/infrastructure layer should use the AWS SDK directly.
- Application services should not depend on Express `req`/`res` objects.

Prefer a modular monolith and small, concrete boundaries. Do not introduce
provider factories, DI frameworks, abstract base classes, microservices, or
other speculative abstractions.

## Runtime/deployment conventions

Current supported stack:

- Node.js 24 (`package.json` is the runtime contract);
- CommonJS;
- Express 4 for RC1;
- Serverless Framework v4;
- AWS Lambda;
- API Gateway REST API;
- `serverless-http`.

Do not migrate to Express 5, ESM, TypeScript, HTTP API, Terraform/CDK, or another
framework unless explicitly requested.

Do not deploy or modify AWS resources unless the task explicitly authorizes it.

## Configuration and secrets

Configuration is centralized in `src/config`.

Tracked files must never contain real credentials, passwords, authenticated
MongoDB URIs, AWS credentials, Serverless keys, or other secrets.

Keep:

- `.env` untracked;
- `.serverless` untracked;
- `serverless.yml` using `${env:...}` references.

Do not print or copy secret values into logs, reports, examples, or responses.
If a secret is found in source/history, report only its type/location and
recommend rotation.

## Microsoft Entra authentication direction

The React SPA must use the OAuth 2.0 / OpenID Connect authorization-code flow
with PKCE through MSAL. The SPA is a public client and must never contain an
Entra client secret.

The backend is an OAuth resource server. It does not require an Entra client
secret merely to validate access tokens.

## Legacy MongoDB authentication freeze

The current MongoDB/password/UUID authentication is temporary and is expected
to be replaced after RC1 by Microsoft Entra ID.

Do **not** spend RC1 effort refactoring the legacy auth implementation merely
for cleanliness or long-term design.

Do not introduce new auth repositories/controllers, improve UUID token design,
add refresh-token behavior, or restructure the users collection unless a task
explicitly requires it.

Only change legacy auth before Entra when it is:

- an RC1 blocker;
- a regression used by the current frontend; or
- an explicitly approved immediate security containment fix.

After RC1, Entra should be designed as a coordinated frontend/backend change;
MongoDB should be removed if auth is its only remaining use.

## Refactoring discipline

For each scoped change:

1. understand the existing responsibility;
2. make the smallest useful change;
3. preserve unrelated behavior;
4. avoid unrelated cleanup/formatting;
5. keep the diff reviewable and independently committable;
6. stop when the requested task is complete.

Do not opportunistically fix known defects during unrelated work.

## Unit-test regression gate

Standard command:

`npm test`

For behavior-preserving refactors/dependency changes:

1. run it before the change;
2. record the baseline;
3. run it after the change;
4. existing passing tests must remain passing.

Do not delete, skip, weaken, or rewrite assertions merely to make a change pass.
If the baseline already fails, report it rather than hiding it.

## Bruno integration-test regression gates

The project uses the project-local `@usebruno/cli`.

### Normal green regression gate

`npm run test:integration`

This scope must remain:

- read-only;
- expected to pass;
- free of known-defect scenarios;
- non-production.

All automated scopes require:

`INTEGRATION_TARGET=local`, `development`, or `test`.

Production/unknown targets must be rejected.

If the safe integration environment is unavailable, report that limitation;
do not fabricate results or weaken the tests.

### Broader mutating scope

`npm run test:integration:full`

This is not the normal green gate. It may mutate MongoDB and requires:

`INTEGRATION_ALLOW_MUTATIONS=true`

Run it only against disposable non-production data.

### Known-defect scope

`npm run test:integration:known-defects`

The `known-defect-flow` tag reproduces the existing user-update defect. This
command may fail while the defect remains and is not part of the normal green
gate.

Do not redefine the defect as successful behavior during unrelated work.

### Report safety

`bruno-results.xml` must remain ignored.
Keep Bruno reporter settings that suppress request/response bodies and headers
so sensitive data is not persisted in reports.

## Dependency changes

Do not run broad dependency upgrades.

For an approved dependency/security task:

- change only the requested direct dependency;
- allow required transitive lockfile changes;
- keep `package.json` and `package-lock.json` consistent;
- do not run `npm audit fix` or `npm audit fix --force` automatically;
- report unrelated audit findings separately;
- major-version upgrades require explicit approval.

For RC1 remain on Express 4.

## RC1 work queue

Unless a new blocker is found, prioritize:

1. upgrade Express within the Express 4 line to the approved secure target;
2. verify unit tests and the safe Bruno regression scope;
3. freeze non-essential backend refactoring;
4. perform an explicitly authorized non-production deployment checkpoint;
5. test the existing frontend end-to-end against that deployment;
6. fix only concrete RC1 blockers discovered by deployment/frontend testing.

Do not start Entra, AWS SDK v3 migration, centralized error handling, MongoDB
lifecycle refactoring, CI/CD, or other optional modernization before RC1 unless
explicitly requested.

## Known deferred issues

Do not opportunistically fix these during unrelated RC1 work:

- legacy API authorization will later be replaced by Entra;
- user responses expose database documents too directly;
- user update has a MongoDB `_id` update defect;
- Wasabi total-count pagination loses `Prefix` on subsequent pages;
- MongoDB connects during module import;
- AWS SDK v2 is end-of-support and should later migrate to v3;
- route-local error handling is inconsistent;
- broad CORS behavior should be reconsidered with the future auth/frontend
  design.

Some MongoDB/auth issues may disappear when legacy auth is removed; do not
refactor code scheduled for replacement unless it blocks RC1.

## Completion report

For implementation tasks, report only what is useful for review:

- files changed;
- versions/dependencies changed when relevant;
- unit-test baseline/final result;
- safe integration-test baseline/final result, or why it could not safely run;
- any application behavior intentionally changed;
- remaining RC1 blocker relevant to the task.

Do not continue to another modernization item without being asked.
# Wasabi Drive API — GitHub Copilot Instructions

## Current project phase

Wasabi Drive is an existing production application.

The current modernization phase is:

**Phase 6 — CI/CD and Deployment Safety.**

CI/CD = Continuous Integration / Continuous Delivery or Deployment.

The active implementation task is:

**Task 6A — Backend pull-request CI.**

The developer is the technical owner and architectural decision-maker.

Copilot is a narrow implementation assistant. Implement only the explicitly requested task. Do not independently redesign the application, change deployment architecture, alter authentication, or continue into later Phase 6 work.

Do not automatically continue to Task 6B or any deployment task after Task 6A.

## Branch and change safety

`master` is the protected integration/release branch.

For Task 6A use:

`ci/backend-pr-checks`

Never commit implementation work directly to `master`.

Do not deploy unless explicitly requested.

Keep commits focused and reviewable.

Avoid unrelated:

* application refactoring;
* dependency upgrades;
* formatting changes;
* security architecture changes;
* framework changes;
* API contract changes;
* deployment changes.

## Task 6A objective

Introduce GitHub Actions pull-request validation for the backend repository with **zero deployment capability**.

The workflow must prove that the backend can be reproduced and tested from a clean CI environment.

Target flow:

checkout
-> Node.js 24
-> `npm ci`
-> `npm test`

This is a Continuous Integration check only.

It must not deploy anything.

## Current repository facts

The current backend uses:

* Node.js 24;
* Express 4;
* CommonJS;
* AWS Lambda;
* API Gateway REST API;
* Serverless Framework v4;
* CloudFormation;
* AWS SDK for JavaScript v3;
* Wasabi S3-compatible private storage;
* Microsoft Entra authentication;
* `test` and `prd` deployment stages.

`package.json` currently declares Node:

`>=24 <25`

Existing relevant scripts include:

* `npm test`;
* `npm run test:integration`;
* `npm run deploy:test`;
* `npm run deploy:prd`.

Task 6A must execute only the normal unit/regression test command:

`npm test`

Do not run deployment scripts or the Bruno integration suite.

## Architecture invariants

Preserve the current backend dependency direction:

HTTP / Express route
-> application/service layer
-> storage/infrastructure implementation
-> AWS SDK
-> Wasabi.

Do not alter application architecture for CI.

Local HTTP startup remains separate from Lambda application construction.

Configuration remains centralized.

## Security invariants

Microsoft Entra authentication remains mandatory.

The backend remains the security authority.

Never:

* add an authentication bypass for CI;
* weaken trusted-user authorization;
* reintroduce API-key authentication;
* reintroduce MongoDB/custom-password authentication;
* expose Wasabi credentials;
* make Wasabi objects public;
* commit bearer/access tokens;
* commit AWS credentials;
* commit Microsoft user credentials;
* add CI-only backdoors.

Task 6A must not require:

* AWS credentials;
* Wasabi credentials;
* Firebase credentials;
* Serverless access credentials;
* Microsoft Entra user credentials;
* access tokens.

Unit tests must continue using their existing controlled mocks/test configuration.

## Required workflow

Create a workflow under:

`.github/workflows/`

Use a clear filename such as:

`.github/workflows/backend-pr-checks.yml`

The workflow must:

* run for pull requests targeting `master`;
* use the normal `pull_request` event;
* use Node.js 24;
* use `npm ci`;
* run `npm test`;
* use a GitHub-hosted Ubuntu runner;
* explicitly use least-privilege GitHub token permissions;
* have no deployment steps;
* consume no repository or environment secrets;
* request no AWS OIDC identity-token permission;
* have no Firebase capability;
* have no Serverless deployment capability.

Do not use `pull_request_target`.

Do not use `npm install` as a fallback.

Do not suppress or bypass clean-install failures.

Do not run `npm run test:integration`.

Do not deploy the `test` or `prd` stages.

## GitHub Action dependency security

Prefer official GitHub-maintained actions.

When practical, pin workflow action dependencies to reviewed full commit SHAs and include a comment identifying the corresponding release version.

Do not introduce unnecessary third-party actions.

## Package and lockfile handling

`npm ci` is intentionally the reproducibility gate.

Do not change `package.json` or `package-lock.json` merely to make CI green.

If `npm ci` fails:

1. inspect and report the actual cause;
2. determine whether `package.json` and `package-lock.json` disagree;
3. determine whether a dependency is incompatible with Node.js 24;
4. make only the minimum justified package/lockfile correction if genuinely required.

Do not replace `npm ci` with `npm install`.

Do not delete tests or weaken assertions to obtain a passing workflow.

## Expected files

Expected Task 6A changes are limited to:

* `.github/workflows/backend-pr-checks.yml`;
* this `.github/copilot-instructions.md` update.

Change other files only if an actual clean-install or Node-24 compatibility defect is demonstrated and explain why the additional change is required before making it.

Application source changes are not expected.

## Validation

Before completing Task 6A, verify:

1. the workflow triggers for pull requests targeting `master`;
2. Node.js 24 is selected;
3. dependency installation uses exactly `npm ci`;
4. tests use the existing `npm test`;
5. the workflow does not execute Serverless;
6. the workflow does not execute Bruno integration tests;
7. the workflow declares no AWS OIDC permission;
8. no secrets or cloud credentials are referenced;
9. no application runtime behavior has changed.

Run from a clean Node.js 24 environment:

`npm ci`

then:

`npm test`

If clean installation or tests fail, diagnose the failure rather than bypassing it.

## Non-goals

Do not implement during Task 6A:

* backend test deployment;
* AWS OIDC;
* Serverless deployment authentication;
* Bruno automation;
* frontend CI;
* Firebase deployment;
* frontend environment configuration;
* production promotion;
* GitHub Environment configuration;
* CORS changes;
* error-handling refactors;
* MaxKeys changes;
* pagination changes;
* MSAL changes;
* authentication changes;
* observability changes;
* thumbnail processing;
* dependency modernization.

## Completion report

Stop after Task 6A.

Report:

* branch used;
* workflow file added;
* trigger conditions;
* Node.js version;
* commands executed;
* whether clean `npm ci` succeeded;
* `npm test` result;
* any dependency or lockfile issue discovered;
* workflow permissions;
* confirmation that no deployment credentials or deployment capability exist;
* files changed;
* commit structure;
* any remaining review concern.

Do not automatically start frontend CI or cloud deployment.
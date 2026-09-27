# Wasabi Drive API — GitHub Copilot Instructions

## Project role

Wasabi Drive is an existing production application and an incremental modernization project.

The developer is the technical owner and architectural decision-maker.

Copilot is an implementation assistant. Make only the explicitly requested change, preserve working behavior, and do not independently redesign the architecture, authentication model, deployment model, AWS configuration, or application structure.

Prefer focused, reviewable changes over broad cleanup.

## Current phase

Current modernization phase:

**Phase 6 — CI/CD and Deployment Safety**

CI/CD = Continuous Integration / Continuous Delivery.

Completed tasks:

- 6A — backend pull-request CI;
- 6B — frontend pull-request CI;
- 6C — normalized deployment commands;
- 6D — automated backend `test` deployment using GitHub Actions, GitHub OIDC, AWS STS temporary credentials, and Serverless Framework;
- 6E — test-stage verification, including frontend-against-test validation and Bruno integration regression.

The next planned phase task is 6F, but **do not start 6F in this task**.

## Active task

Perform a small deployment-reproducibility hardening change before Phase 6F.

Branch:

`ci/constrain-serverless-version`

The current `serverless.yml` contains:

```yaml
frameworkVersion: "4"
```

During GitHub Actions deployment, `npm ci` installs the repository's Serverless Framework dependency, but Serverless v4 then updates itself to the latest compatible v4 release before deployment.

This has already been observed during the automated `test` deployment:

- repository dependency resolved Serverless 4.42.0;
- deployment upgraded to Serverless 4.43.0;
- the update added unnecessary deployment time;
- the deployment therefore used a newer minor release than the one reviewed with the repository source.

The objective is to constrain Serverless Framework to the current 4.42 minor line.

## Required change

Change only:

`serverless.yml`

Change:

```yaml
frameworkVersion: "4"
```

to:

```yaml
frameworkVersion: "~4.42.0"
```

`~4.42.0` allows compatible 4.42.x patch releases while preventing automatic movement to 4.43.x or later minor releases.

Do not change the value to an unrestricted major version.

Do not independently choose another Serverless version.

## Scope

Expected source change:

- `serverless.yml` only.

Do not modify:

- `package.json`;
- `package-lock.json`;
- application source;
- tests;
- GitHub Actions workflows;
- AWS IAM policies;
- GitHub Environment configuration;
- authentication or authorization;
- Entra configuration;
- Wasabi configuration;
- Lambda configuration;
- API Gateway configuration;
- deployment stage names;
- deployment commands;
- Bruno integration scripts;
- frontend source.

If a concrete blocker appears that would require another file to change, stop and report it instead of expanding scope.

## Current backend architecture

Preserve:

- Node.js 24;
- Express 4;
- CommonJS;
- AWS Lambda;
- API Gateway REST API;
- Serverless Framework v4;
- CloudFormation;
- AWS SDK for JavaScript v3;
- Wasabi S3-compatible storage;
- Microsoft Entra authentication;
- backend stages `test` and `prd`.

Preserve the established dependency direction:

HTTP / Express route
-> application/service layer
-> infrastructure/storage implementation
-> AWS SDK
-> Wasabi.

Local HTTP startup remains separate from Lambda application construction.

Configuration remains centralized.

## Security invariants

Do not weaken:

- Microsoft Entra authentication is mandatory;
- backend validates OAuth 2.0 access tokens;
- trusted-user authorization remains server-side;
- backend is the security authority;
- Wasabi credentials remain server-side;
- Wasabi objects remain private;
- temporary backend-authorized access URLs remain the object-access mechanism;
- API Gateway API keys are not authentication;
- no MongoDB/custom-password fallback exists.

Do not add secrets, credentials, tokens, or passwords to source.

## CI/CD invariants

Preserve the existing backend pull-request validation:

- Node.js 24;
- `npm ci`;
- `npm test`.

Preserve automated backend `test` deployment from protected `master`.

Do not modify the deployment workflow in this task.

GitHub Actions uses:

GitHub OIDC
-> AWS STS temporary credentials
-> dedicated backend `test` deployment role
-> Serverless Framework
-> `npm run deploy:test`.

OIDC = OpenID Connect.

AWS STS = AWS Security Token Service.

Do not introduce permanent AWS access keys.

Do not deploy production.

## Deployment behavior

Existing deployment scripts are authoritative:

```text
npm run deploy:test
npm run deploy:prd
```

Do not change those scripts.

Do not run a manual deployment from the feature branch.

After merge to `master`, the existing GitHub Actions workflow will perform the normal automated `test` deployment.

That deployment will be used to confirm that the constrained Serverless version behaves correctly.

## Validation

Before reporting completion, run:

```bash
npm ci
npm test
git diff --check
```

Expected backend regression result:

```text
47/47 tests passing
```

Also verify:

```bash
git status --short
```

The only intended source modification must be:

```text
serverless.yml
```

Do not run:

```bash
npm run deploy:test
npm run deploy:prd
npm run test:integration
```

for this feature-branch validation.

The first deployment validation should occur automatically after the reviewed PR is merged to protected `master`.

## Git/change-management rules

`master` is protected.

Do not commit directly to `master`.

Use:

`ci/constrain-serverless-version`

Keep the PR focused on this one configuration change.

Do not include unrelated formatting, dependency updates, audit fixes, refactoring, or cleanup.

Do not weaken tests to make the change pass.

Do not create a production deployment.

## Non-goals

Do not implement:

- Phase 6F frontend test deployment;
- Phase 6G Firebase CI authentication;
- Phase 6H production promotion;
- GitHub Actions caching;
- Serverless dependency upgrades;
- npm vulnerability remediation;
- Node.js dependency modernization;
- authentication changes;
- authorization changes;
- API Gateway migration;
- Lambda authorizers;
- observability;
- frontend changes;
- Bruno automation;
- production approval workflows;
- TypeScript;
- ESM;
- Express 5.

Do not proceed into another modernization task after this change.

## Expected diff

The intended functional diff is:

```diff
 service: api-wasabi-drive
-frameworkVersion: "4"
+frameworkVersion: "~4.42.0"
```

No other functional source change is expected.

## Completion report

When finished, stop and report:

- branch used;
- exact file changed;
- previous `frameworkVersion`;
- new `frameworkVersion`;
- `npm ci` result;
- `npm test` result;
- test count;
- `git diff --check` result;
- `git status --short` result;
- confirmation that no other source files changed;
- confirmation that no deployment was performed;
- confirmation that Phase 6F was not started.

Do not commit unless explicitly instructed to commit.

Do not continue beyond this task.
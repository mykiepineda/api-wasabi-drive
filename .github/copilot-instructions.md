# Wasabi Drive API — GitHub Copilot Instructions

## Current project phase

Wasabi Drive is an existing production application.

The current modernization phase is:

**Phase 6 — CI/CD and Deployment Safety**

CI/CD = Continuous Integration / Continuous Delivery or Deployment.

The active implementation task is:

**Task 6D — Automated backend `test` deployment**

The developer is the technical owner and architectural decision-maker.

Copilot is a narrow implementation assistant. Implement only the explicitly requested task. Do not independently redesign application architecture, authentication, deployment strategy, AWS IAM architecture, or environment strategy.

Do not automatically continue into Task 6E or any production-deployment task.

## Branch and change safety

`master` is the protected integration/release branch.

Use:

`ci/backend-test-deploy`

Never commit implementation work directly to `master`.

Do not deploy from the feature branch.

The first cloud deployment for this task must occur only after the reviewed pull request is merged to `master`.

Keep commits focused and reviewable.

Avoid unrelated:

- application refactoring;
- dependency upgrades;
- authentication changes;
- API changes;
- frontend changes;
- production deployment changes;
- observability changes;
- formatting-only cleanup.

## Task 6D objective

Introduce automatic deployment of the backend `test` stage after a reviewed change is merged to protected `master`.

Target flow:

push to `master`
-> GitHub Environment `test`
-> checkout
-> Node.js 24
-> `npm ci`
-> `npm test`
-> GitHub OIDC
-> temporary AWS credentials
-> Serverless Framework
-> `npm run deploy:test`

OIDC = OpenID Connect. GitHub OIDC allows GitHub Actions to authenticate to AWS without storing permanent AWS access keys.

AWS STS = AWS Security Token Service. AWS STS issues temporary credentials after the GitHub workflow is authorized to assume the deployment role.

This task introduces Continuous Delivery to the backend `test` stage.

It must not deploy production.

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
- Wasabi S3-compatible private storage;
- Microsoft Entra authentication;
- `test` and `prd` stages.

Preserve the existing dependency direction:

HTTP / Express route
-> application/service layer
-> storage/infrastructure implementation
-> AWS SDK
-> Wasabi.

Local HTTP startup remains separate from Lambda application construction.

Configuration remains centralized.

Do not refactor application architecture for CI/CD.

## Existing deployment command

The backend already provides:

`npm run deploy:test`

which maps to the existing Serverless Framework `test` deployment.

Use this existing script.

Do not replace Serverless Framework with AWS CDK, Terraform, SAM, or another IaC tool.

IaC = Infrastructure as Code.

Do not rewrite `serverless.yml` merely to make CI work unless a concrete compatibility defect is demonstrated and reviewed.

## Existing pull-request CI

Backend pull-request CI already exists and validates:

checkout
-> Node.js 24
-> `npm ci`
-> `npm test`

Preserve it.

Do not modify the existing pull-request workflow unless a concrete defect is discovered.

Task 6D adds a separate deployment workflow for pushes to `master`.

## Security invariants

Never weaken:

- Microsoft Entra authentication is mandatory;
- backend validates API access tokens;
- trusted-user authorization remains server-side;
- Wasabi credentials remain server-side;
- Wasabi objects remain private;
- file access uses temporary backend-authorized `AccessUrl`;
- API keys are not part of the security model;
- no MongoDB/custom-password fallback exists;
- backend remains the security authority.

Never introduce an authentication bypass for CI/CD.

Never commit or print:

- permanent AWS access keys;
- Serverless access keys;
- Wasabi access keys;
- Wasabi secret keys;
- Microsoft Entra secrets;
- Microsoft user passwords;
- bearer/access tokens;
- private keys.

## AWS authentication model

GitHub Actions must authenticate to AWS using GitHub OIDC.

Do not store these in GitHub:

- `AWS_ACCESS_KEY_ID`;
- `AWS_SECRET_ACCESS_KEY`;
- long-lived AWS session credentials.

The workflow should obtain temporary AWS credentials by assuming a dedicated IAM deployment role.

IAM = AWS Identity and Access Management.

The AWS OIDC trust must be restricted to:

- the intended GitHub repository;
- the GitHub `test` environment;
- audience `sts.amazonaws.com`.

The expected OIDC subject is conceptually:

`repo:mykiepineda/api-wasabi-drive:environment:test`

Do not broaden the trust policy to arbitrary repositories, pull requests, branches, or environments.

Do not grant AdministratorAccess merely to make deployment work.

Treat AWS `AccessDenied` errors as evidence of a missing specific permission. Diagnose the required permission instead of broadly expanding access.

Pay particular attention to `iam:PassRole`. It must be restricted to the specific role or roles required by the existing Serverless/CloudFormation deployment.

## GitHub Environment

Use the GitHub Environment:

`test`

The deployment workflow must reference:

`environment: test`

The `test` environment should be restricted to deployment from protected `master`.

No manual approval is required for `test`.

Production approval is a later Phase 6 concern.

## GitHub Environment values

Use GitHub Environment secrets only for actual credentials.

### Secrets

Expected environment secrets:

- `SERVERLESS_ACCESS_KEY`;
- `WASABI_ACCESS_KEY_ID`;
- `WASABI_SECRET_ACCESS_KEY`.

`SERVERLESS_ACCESS_KEY` authenticates the Serverless Framework CLI and is separate from AWS authentication.

GitHub OIDC authenticates to AWS.

Do not confuse these two mechanisms.

### Variables

Expected GitHub Environment variables:

- `AWS_ACCOUNT_ID`;
- `AWS_DEPLOY_ROLE_ARN`;
- `WASABI_SERVICE_URL`;
- `WASABI_REGION`;
- `ENTRA_TENANT_ID`;
- `ENTRA_API_CLIENT_ID`;
- `ENTRA_REQUIRED_SCOPE`;
- `ENTRA_TRUSTED_USER_OBJECT_IDS`.

These are configuration values rather than secrets.

Do not move public/non-secret configuration into GitHub Secrets merely because it is environment-specific.

## Required deployment workflow

Create:

`.github/workflows/backend-test-deploy.yml`

The workflow must:

- trigger only on `push` to `master`;
- use the GitHub Environment `test`;
- run on a GitHub-hosted Ubuntu runner;
- use Node.js 24;
- use `npm ci`;
- run the existing `npm test` before obtaining cloud deployment credentials;
- authenticate to AWS using GitHub OIDC;
- obtain short-lived AWS credentials;
- invoke the existing `npm run deploy:test`;
- serialize test deployments;
- not cancel an in-progress deployment;
- record deployment traceability information;
- deploy only the backend `test` stage.

Do not add `workflow_dispatch` during this task.

Do not trigger deployment from pull requests.

Do not deploy production.

## Workflow permissions

The deployment workflow should explicitly request only:

- `contents: read`;
- `id-token: write`.

`id-token: write` is required only so GitHub can request an OIDC identity token for AWS federation.

It does not itself grant AWS authorization.

Do not add broader GitHub token permissions unless a concrete requirement is demonstrated.

## GitHub Actions dependency safety

Use official maintained actions.

Use the same reviewed full-SHA-pinned versions already approved for backend Task 6A where appropriate.

For checkout:

- use the approved pinned `actions/checkout`;
- retain `persist-credentials: false`.

For Node:

- use the approved pinned `actions/setup-node`;
- use Node.js 24;
- retain `package-manager-cache: false` for the current reproducibility model.

For AWS authentication:

- use `aws-actions/configure-aws-credentials`;
- use the current reviewed v6.3.0 release;
- pin the action to its reviewed full commit SHA;
- do not leave a floating version tag in the final workflow.

Do not introduce unnecessary third-party Actions.

## AWS credential configuration

Use:

`vars.AWS_DEPLOY_ROLE_ARN`

for the role to assume.

Use AWS region:

`ap-southeast-2`

Use:

`vars.AWS_ACCOUNT_ID`

to verify the expected account.

Use a traceable role session name that includes:

`github.run_id`

Mask the AWS account ID in action output where supported.

Do not reference permanent AWS credential secrets.

## Deployment concurrency

Only one backend `test` deployment should execute at a time.

Use GitHub Actions concurrency.

Do not cancel an already-running test deployment merely because a newer merge occurs.

The newer deployment should wait.

This prevents overlapping Serverless/CloudFormation updates to the same `test` stack.

## Deployment environment scope

Do not expose deployment secrets at workflow level unless required.

Prefer supplying:

- `SERVERLESS_ACCESS_KEY`;
- Wasabi credentials;
- Wasabi configuration;
- Entra configuration

only to the Serverless deployment step.

The earlier:

- checkout;
- dependency installation;
- test

steps do not need application/deployment secrets.

AWS credentials are obtained only after tests pass.

## Deployment traceability

Before deployment, record non-secret deployment context in the job logs:

- Git SHA;
- stage = `test`;
- GitHub workflow run identifier or run URL.

Do not print:

- credentials;
- secrets;
- bearer tokens;
- raw OIDC tokens.

Rollback later should be based on deliberately redeploying a known-good source reference.

## Tests

Before deployment execute:

`npm ci`

then:

`npm test`

Do not replace `npm ci` with `npm install`.

Do not weaken or skip tests merely to allow deployment.

Do not execute:

`npm run test:integration`

during Task 6D.

Bruno test-stage verification belongs to Task 6E.

## Serverless and configuration

Use the existing Serverless Framework v4 deployment architecture.

Do not modify deployment stage naming.

Test stage remains:

`test`

Production remains:

`prd`

The existing `.env.test` developer-local workflow must not be committed to support CI.

GitHub Environment configuration should provide the variables required by the existing Serverless configuration.

Do not commit environment files containing credentials.

## Non-goals

Do not implement during Task 6D:

- production deployment;
- production approval;
- frontend deployment;
- Firebase CI;
- Google Workload Identity Federation;
- Bruno automation;
- delegated Entra user-token automation;
- authentication bypasses;
- Lambda authorizers;
- API Gateway migration;
- API-key authentication;
- CORS changes;
- central error handling;
- MaxKeys validation;
- thumbnail processing;
- SNS/SQS;
- observability refactoring;
- dependency upgrades;
- TypeScript;
- ESM;
- Express 5;
- Create React App migration.

Do not automatically continue to Task 6E.

## Expected source changes

Expected Task 6D source changes are limited to:

- `.github/workflows/backend-test-deploy.yml`;
- this `.github/copilot-instructions.md` update.

Do not modify:

- application source;
- `package.json`;
- `package-lock.json`;
- `serverless.yml`;
- tests

unless an actual compatibility defect is demonstrated and reviewed before the change.

## External prerequisites

Before merging the deployment workflow, the technical owner must have configured:

1. GitHub Environment `test`;
2. `test` environment restricted to `master`;
3. required environment variables and secrets;
4. GitHub OIDC identity provider in AWS, reusing it if it already exists;
5. dedicated AWS IAM test deployment role;
6. narrow OIDC trust policy;
7. least-privilege AWS deployment permissions.

Do not attempt to provision these IAM resources by modifying application source.

If external IAM setup is not complete, report that the workflow must not yet be merged.

## Validation before commit

Run locally under Node.js 24:

`npm ci`

`npm test`

Perform static workflow review confirming:

1. trigger is only `push` to `master`;
2. job uses `environment: test`;
3. permissions are only `contents: read` and `id-token: write`;
4. Checkout does not persist credentials;
5. Node.js 24 is used;
6. `npm ci` runs;
7. `npm test` runs before AWS authentication;
8. AWS authentication uses OIDC and role assumption;
9. no permanent AWS access-key secrets are referenced;
10. only `npm run deploy:test` performs deployment;
11. no production stage exists;
12. no frontend deployment exists;
13. no Bruno integration exists;
14. no application runtime behavior has changed.

Do not manually execute:

`npm run deploy:test`

from the feature branch merely to validate the workflow.

The first automated cloud deployment should be triggered by the reviewed merge to protected `master`.

## Recommended workflow shape

The workflow should conceptually resemble:

```yaml
name: Backend Test Deployment

on:
  push:
    branches:
      - master

permissions:
  contents: read
  id-token: write

concurrency:
  group: backend-test-deployment
  cancel-in-progress: false

jobs:
  deploy-test:
    name: Deploy test
    runs-on: ubuntu-latest
    timeout-minutes: 20
    environment: test

    steps:
      - name: Checkout
        uses: actions/checkout@<APPROVED_FULL_SHA>
        with:
          persist-credentials: false

      - name: Set up Node.js 24
        uses: actions/setup-node@<APPROVED_FULL_SHA>
        with:
          node-version: "24"
          package-manager-cache: false

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@<REVIEWED_V6_3_0_FULL_SHA>
        with:
          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ap-southeast-2
          allowed-account-ids: ${{ vars.AWS_ACCOUNT_ID }}
          role-session-name: WasabiDriveTest-${{ github.run_id }}
          mask-aws-account-id: true

      - name: Record deployment context
        run: |
          echo "Git SHA: $GITHUB_SHA"
          echo "Stage: test"
          echo "Workflow run: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

      - name: Deploy test
        env:
          SERVERLESS_ACCESS_KEY: ${{ secrets.SERVERLESS_ACCESS_KEY }}

          WASABI_SERVICE_URL: ${{ vars.WASABI_SERVICE_URL }}
          WASABI_REGION: ${{ vars.WASABI_REGION }}
          WASABI_ACCESS_KEY_ID: ${{ secrets.WASABI_ACCESS_KEY_ID }}
          WASABI_SECRET_ACCESS_KEY: ${{ secrets.WASABI_SECRET_ACCESS_KEY }}

          ENTRA_TENANT_ID: ${{ vars.ENTRA_TENANT_ID }}
          ENTRA_API_CLIENT_ID: ${{ vars.ENTRA_API_CLIENT_ID }}
          ENTRA_REQUIRED_SCOPE: ${{ vars.ENTRA_REQUIRED_SCOPE }}
          ENTRA_TRUSTED_USER_OBJECT_IDS: ${{ vars.ENTRA_TRUSTED_USER_OBJECT_IDS }}
        run: npm run deploy:test
```

The final implementation must use reviewed full commit SHAs for Actions rather than placeholders.

## Completion report

Stop after Task 6D.

Report:

- branch used;
- workflow file added;
- trigger conditions;
- GitHub Environment used;
- GitHub token permissions;
- Node version;
- commands executed before deployment;
- OIDC authentication action/version/SHA;
- AWS role source;
- AWS region;
- concurrency behavior;
- GitHub Environment variables/secrets referenced;
- confirmation that no permanent AWS credentials are used;
- confirmation that no production stage is deployed;
- confirmation that no Bruno integration is run;
- local `npm ci` result;
- local `npm test` result;
- files changed;
- commits created;
- any external prerequisite still incomplete;
- any IAM permission failure requiring developer review.

Do not automatically start Task 6E.
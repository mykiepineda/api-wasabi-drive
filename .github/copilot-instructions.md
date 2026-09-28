# Wasabi Drive Backend — GitHub Copilot Instructions

## Project role

Wasabi Drive is an existing production application and an incremental modernization project.

The developer is the technical owner and architectural decision-maker.

Copilot is an implementation assistant. Make only the explicitly requested change, preserve working behavior, and do not independently redesign the backend, authentication model, AWS architecture, deployment model, Serverless configuration, or storage integration.

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
- Serverless Framework version constrained to the approved 4.42.x line.

The active task is:

**Task 6H-A — Controlled backend production promotion**

The external Task 6H-A prerequisites are complete. Work on `ci/backend-prd-promotion` only; do not run either deployment command from this feature branch.

Do not start Task 6H-B frontend production promotion.

## Current backend architecture

Treat the latest `master` source as authoritative.

Preserve:

- Node.js 24;
- Express 4;
- CommonJS;
- AWS Lambda;
- API Gateway REST API;
- Serverless Framework v4;
- CloudFormation;
- AWS SDK for JavaScript v3 where currently used;
- Wasabi S3-compatible object storage;
- stages `test` and `prd`.

Preserve the established backend separation of concerns:

HTTP / Express route
-> application/service layer
-> infrastructure/storage implementation
-> Wasabi / AWS SDK.

Local HTTP startup remains separate from Lambda application construction.

Configuration remains centralized.

Do not introduce new frameworks, databases, queues, services, or architectural layers.

## Current identity and security model

Preserve:

React SPA
-> Microsoft Authentication Library (MSAL)
-> Microsoft Entra
-> OAuth 2.0 / OpenID Connect
-> access token
-> API Gateway
-> Express authentication
-> application authorization
-> Wasabi.

OIDC = OpenID Connect.

AWS STS = AWS Security Token Service. GitHub OIDC exchanges the GitHub workload identity for short-lived AWS credentials through STS.

The backend remains the security authority.

Do not restore:

- MongoDB authentication;
- bcrypt password authentication;
- UUID authentication;
- API Gateway API-key authentication;
- frontend-only authorization.

Do not place long-lived AWS access keys in GitHub.

Do not commit secrets.

Wasabi credentials remain externalized.

## Existing deployment state

The backend already has:

- pull-request CI for PRs to `master`;
- automatic deployment of `master` to the backend `test` stage;
- GitHub OIDC -> dedicated AWS `test` deploy role;
- a GitHub Environment named `test`;
- `npm run deploy:test`;
- `npm run deploy:prd`;
- backend regression command `npm test`;
- safe integration regression command `npm run test:integration`.

The working backend `test` deployment workflow and its security choices are approved.

Do not refactor or broaden the existing `test` workflow during Task 6H-A.

## Task 6H-A objective

Add an explicit, controlled production promotion workflow.

Target release flow:

feature branch
-> pull request
-> backend PR CI
-> protected `master`
-> automatic backend `test` deployment
-> technical-owner validation in `test`
-> manually start production workflow
-> provide exact tested `master` commit SHA
-> GitHub Environment `prd`
-> validate requested SHA is a commit from `master`
-> checkout that exact SHA
-> `npm ci`
-> `npm test`
-> GitHub OIDC
-> dedicated AWS production deploy role
-> `npm run deploy:prd`
-> production verification.

Production must **not** deploy automatically on every push to `master`.

The source promoted to production must be an explicit full Git commit SHA already validated in `test`.

## External prerequisites

The technical owner has completed the external Task 6H-A setup.

Assume the backend repository GitHub Environment:

`prd`

already exists and contains the required production configuration.

Assume it is restricted to `master`.

Assume a dedicated AWS production deploy role has been created and its trust policy is restricted to the backend repository GitHub Environment `prd`.

Do not create or modify:

- AWS IAM roles;
- AWS IAM policies;
- GitHub Environments;
- GitHub Environment variables;
- GitHub Environment secrets;
- Serverless Dashboard access keys.

Do not use infrastructure code to bootstrap these resources during this task.

## Expected GitHub `prd` Environment configuration

The workflow may reference these GitHub Environment **variables**:

- `AWS_ACCOUNT_ID`;
- `AWS_DEPLOY_ROLE_ARN`;
- `WASABI_SERVICE_URL`;
- `WASABI_REGION`;
- `ENTRA_TENANT_ID`;
- `ENTRA_API_CLIENT_ID`;
- `ENTRA_REQUIRED_SCOPE`;
- `ENTRA_TRUSTED_USER_OBJECT_IDS`.

The workflow may reference these GitHub Environment **secrets**:

- `SERVERLESS_ACCESS_KEY`;
- `WASABI_ACCESS_KEY_ID`;
- `WASABI_SECRET_ACCESS_KEY`.

Do not hardcode actual values.

Do not introduce permanent AWS credentials such as:

- `AWS_ACCESS_KEY_ID`;
- `AWS_SECRET_ACCESS_KEY`.

AWS deployment credentials must come from GitHub OIDC and STS.

## Required workflow

Create:

`.github/workflows/backend-prd-deploy.yml`

Suggested workflow name:

`Backend Production Promotion`

The workflow must be **manual only**.

Use:

```yaml
on:
  workflow_dispatch:
    inputs:
      source_sha:
        description: "Full 40-character master commit SHA already validated in test"
        required: true
        type: string
```

Do not add:

- `push`;
- `pull_request`;
- `schedule`.

Do not add an automatic production trigger.

## GitHub Environment

The deployment job must use:

```yaml
environment:
  name: prd
```

If the external GitHub Environment has required reviewers, GitHub will pause at that environment gate.

Do not weaken or bypass Environment protection.

Do not change the `test` Environment.

## GitHub token permissions

Use only:

```yaml
permissions:
  contents: read
  id-token: write
```

`id-token: write` allows GitHub Actions to request the OIDC token required for AWS role assumption.

It does not itself grant AWS permissions.

Do not add broader GitHub token permissions without a demonstrated requirement.

## Production concurrency

Use:

```yaml
concurrency:
  group: backend-prd-deployment
  cancel-in-progress: false
```

A production deployment already in progress must not be cancelled by another request.

## Workflow run context

The production workflow must run from `master`.

Do not rely only on operator convention.

Use a job-level guard or an explicit validation step to reject/skip execution when:

```text
github.ref != refs/heads/master
```

The GitHub `prd` Environment branch restriction remains a second independent control.

## Exact source SHA validation

The workflow input `source_sha` is untrusted text and must not be interpolated unsafely into shell commands.

Pass it through an environment variable, for example:

```yaml
env:
  SOURCE_SHA: ${{ inputs.source_sha }}
```

Always quote shell variable use.

Before tests or deployment, validate all of the following:

1. `SOURCE_SHA` is exactly a 40-character hexadecimal SHA;
2. it resolves to a Git commit;
3. it is an ancestor of the current remote `master`;
4. after checkout, `HEAD` is exactly that commit.

Use a full repository history for this validation:

```yaml
with:
  fetch-depth: 0
  persist-credentials: false
```

A suitable validation approach is conceptually:

```bash
if ! [[ "$SOURCE_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "source_sha must be a full 40-character Git commit SHA" >&2
  exit 1
fi

git cat-file -e "${SOURCE_SHA}^{commit}"

if ! git merge-base --is-ancestor "$SOURCE_SHA" origin/master; then
  echo "source_sha is not an ancestor of origin/master" >&2
  exit 1
fi

git checkout --detach "$SOURCE_SHA"

ACTUAL_SHA="$(git rev-parse HEAD)"
EXPECTED_SHA="$(git rev-parse "${SOURCE_SHA}^{commit}")"

if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "Checked-out SHA does not match requested source_sha" >&2
  exit 1
fi
```

Do not accept:

- abbreviated SHAs;
- branch names;
- tags;
- arbitrary refs;
- a SHA that is not reachable from `master`.

Do not silently replace the requested SHA with current `master`.

## GitHub Actions dependencies

Reuse the already approved action pins from the backend test workflow.

Checkout:

`actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`

Use:

```yaml
fetch-depth: 0
persist-credentials: false
```

Node:

`actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0`

Use:

```yaml
node-version: "24"
package-manager-cache: false
```

AWS credentials:

`aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0`

Do not replace reviewed full commit SHAs with floating tags.

Do not add unnecessary third-party actions.

## Required execution order

The intended order is:

```text
checkout master with full history
-> validate requested SHA belongs to master
-> detach checkout at exact requested SHA
-> verify HEAD
-> setup Node.js 24
-> npm ci
-> npm test
-> record deployment context
-> obtain short-lived AWS credentials through GitHub OIDC
-> npm run deploy:prd
```

AWS authentication must happen only after source validation and tests pass.

Do not call AWS deployment authentication before tests.

## AWS OIDC authentication

Use the same proven configuration pattern as the backend `test` deployment:

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0
  with:
    role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
    aws-region: ap-southeast-2
    allowed-account-ids: ${{ vars.AWS_ACCOUNT_ID }}
    role-session-name: WasabiDrivePrd-${{ github.run_id }}
    mask-aws-account-id: true
```

Do not use static AWS keys.

If role assumption fails, report the exact error.

Do not weaken the trust policy or broaden AWS permissions from source code.

## Production deployment step

Use the existing normalized command:

```bash
npm run deploy:prd
```

Scope production configuration/secrets to the deployment step rather than exposing them unnecessarily to dependency installation or tests.

The deployment step should receive:

```yaml
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
```

Do not print these values.

Do not run `npm run test:integration` against production automatically.

Do not perform destructive production verification.

## Deployment traceability

Before AWS authentication, log only non-secret release context:

- requested source SHA;
- verified checked-out SHA;
- stage = `prd`;
- GitHub workflow run URL.

Do not log:

- Wasabi credentials;
- Serverless access key;
- AWS session credentials;
- Entra bearer tokens;
- any user access token.

The exact production source SHA must be visible in the job log.

## Rollback model

Do not build a separate rollback system during Task 6H-A.

The rollback procedure is:

1. identify a known-good previous `master` commit SHA;
2. manually run `Backend Production Promotion`;
3. supply that exact known-good SHA;
4. workflow performs the same validation/tests;
5. redeploy the known-good source to `prd`.

Document this in the README.

Do not use `git revert` automatically.

Do not mutate `master` from the deployment workflow.

## Existing automatic test deployment

Do not modify:

`.github/workflows/backend-test-deploy.yml`

for Task 6H-A unless a concrete blocking defect is discovered and reported first.

Merging the Task 6H-A PR to `master` will naturally trigger the existing backend `test` deployment.

That is desirable.

After merge:

1. allow the existing test deployment to complete;
2. validate the merged SHA in `test`;
3. manually run production promotion with the same full SHA.

Do not automatically chain test deployment into production.

## README documentation

Update backend deployment documentation to describe the release flow.

Document:

- PR CI;
- automatic `test` deployment on merge to `master`;
- test validation before production;
- production deployment is manual;
- exact full `master` SHA must be supplied;
- GitHub Environment `prd` is the production protection boundary;
- GitHub OIDC / AWS STS provides short-lived AWS credentials;
- no permanent AWS deployment access keys are stored in GitHub;
- `npm run deploy:prd` remains the underlying deployment command;
- rollback is performed by rerunning the production workflow with a known-good `master` SHA.

Do not document secret values.

## Expected source changes

Expected Task 6H-A changes are limited to:

- `.github/workflows/backend-prd-deploy.yml`;
- `.github/copilot-instructions.md`;
- `README.md`.

No changes are expected to:

- application source under `src/`;
- `serverless.yml`;
- `package.json`;
- `package-lock.json`;
- tests;
- integration tests;
- existing backend test deployment workflow.

If implementation appears to require changes outside the expected files, stop and report why rather than expanding scope automatically.

## Local validation before commit

Use branch:

`ci/backend-prd-promotion`

Run:

```bash
npm ci
npm test
git diff --check
git status --short
```

Do not deploy from the feature branch.

Do not run:

```bash
npm run deploy:test
npm run deploy:prd
```

Do not assume AWS credentials locally.

Perform static workflow review confirming:

1. workflow trigger is only `workflow_dispatch`;
2. `source_sha` is required;
3. job uses GitHub Environment `prd`;
4. workflow execution is restricted to `master`;
5. permissions are only `contents: read` and `id-token: write`;
6. production concurrency is serialized and does not cancel in-progress deploys;
7. checkout uses full history and does not persist credentials;
8. input SHA is handled through a quoted environment variable;
9. SHA must be exactly 40 hex characters;
10. SHA must resolve to a commit;
11. SHA must be an ancestor of `origin/master`;
12. exact SHA is checked out detached;
13. checked-out HEAD is verified;
14. Node.js 24 is used;
15. `npm ci` runs;
16. `npm test` runs before AWS authentication;
17. AWS credentials use GitHub OIDC and the dedicated environment role;
18. `allowed-account-ids` is used;
19. no permanent AWS access key is referenced;
20. production Wasabi/Serverless secrets are exposed only to the deploy step;
21. deploy command is `npm run deploy:prd`;
22. no production integration test is run automatically;
23. test deployment workflow is unchanged;
24. no application code changed;
25. no deployment was executed from the feature branch;
26. Task 6H-B was not started.

## First production validation

Do not run production deployment from the feature branch.

After:

- PR CI passes;
- workflow review passes;
- PR is merged to protected `master`;
- automatic backend `test` deployment for the merged SHA succeeds;
- technical owner validates that exact SHA in `test`;

manually start:

`Backend Production Promotion`

from `master`.

Supply the exact 40-character tested commit SHA.

If the GitHub `prd` Environment requires approval, approve the deployment there.

After successful production deployment, perform only proportionate production smoke validation, such as:

- confirm the production API is reachable;
- confirm an unauthenticated protected request still receives the expected authentication failure;
- confirm an authenticated application flow still succeeds;
- confirm normal Wasabi navigation through the production application;
- confirm no `test` resource was targeted.

Do not weaken authentication to simplify validation.

## Non-goals

Do not implement during Task 6H-A:

- frontend production promotion;
- Task 6H-B;
- automatic production deployment on push;
- cross-repository release orchestration;
- release branches;
- release tags as a required deployment mechanism;
- artifact registries;
- production integration tests that mutate real data;
- AWS IAM changes;
- API Gateway migration;
- Lambda architecture changes;
- Serverless Framework migration;
- dependency upgrades;
- npm audit remediation;
- MongoDB work;
- authentication redesign;
- authorization redesign;
- CORS changes;
- observability platform changes;
- unrelated cleanup.

## Completion report

When implementation is complete, stop and report:

- branch used;
- exact files changed;
- workflow filename and name;
- trigger;
- workflow input(s);
- GitHub Environment;
- GitHub permissions;
- production concurrency configuration;
- master-only execution guard;
- checkout action version/full SHA;
- checkout history/credential settings;
- exact SHA validation behavior;
- Node action version/full SHA;
- Node version;
- commands run before AWS authentication;
- AWS auth action version/full SHA;
- production role variable referenced;
- account restriction variable referenced;
- AWS region;
- role session name;
- production deployment command;
- deployment-step variables/secrets referenced;
- traceability logging;
- rollback documentation;
- README changes;
- `npm ci` result;
- `npm test` result and test count;
- `git diff --check` result;
- `git status --short` result;
- confirmation no permanent AWS key was introduced;
- confirmation no production deployment occurred from the feature branch;
- confirmation existing `test` workflow was unchanged;
- confirmation application source was unchanged;
- confirmation Task 6H-B was not started;
- any unexpected issue or external prerequisite.

Do not commit unless explicitly instructed.

Do not continue beyond Task 6H-A.
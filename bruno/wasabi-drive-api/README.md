# Wasabi Drive API Bruno Collection

Import the `bruno/wasabi-drive-api` folder into Bruno and select the `local` environment.

Start the API with `npm start`, then replace the placeholder values in `environments/local.bru` before running requests that use a bucket or user ID.

 The project installs the Bruno CLI locally. Run the normal, read-only regression scope with:

 ```bash
 npm run test:integration
 ```

 It uses the `ci` environment and requires `BASE_URL`, `INTEGRATION_BUCKET_NAME`, and `INTEGRATION_CONTINUATION_TOKEN`. This scope runs bucket reads and `List users`; it does not create users or run requests that depend on a runtime-created user ID.

## CI execution

Install the Bruno CLI in the CI image, set the variables consumed by `environments/ci.bru`, then run:

```bash
cd bruno/wasabi-drive-api
bru run . -r --env ci --output ../../bruno-results.xml --format junit
```

The same command is available as `npm run test:integration`. Use a dedicated test database and unique `userName`, because the API does not provide a delete-user endpoint.

 ## Broader coverage

 The `Create user` request writes to MongoDB. `Validate user credentials` and `Get user by id` are read-only requests but depend on its runtime `userId`; the collection runs them in sequence. `Update user` also writes to MongoDB and is tagged `known-defect` because the current service includes MongoDB's immutable `_id` in its update payload.

 Run broader coverage only against a dedicated local, development, or test environment with disposable data:

 ```powershell
 $env:INTEGRATION_TARGET = "development"
 $env:INTEGRATION_ALLOW_MUTATIONS = "true"
 npm run test:integration:full
 ```

 Set the variables consumed by `environments/ci.bru`, including a unique `INTEGRATION_USER_NAME` and `INTEGRATION_USER_PASSWORD`. There is no delete-user endpoint, so use disposable test data. Never point mutating integration tests at production.

The known defect is excluded from the full scope and can be run separately, with the same safety variables. This scope includes the ordered create-user dependency chain needed to provide its runtime user ID:

 ```bash
 npm run test:integration:known-defects
 ```

 This command does not redefine the update expectation; its current HTTP 200 assertion remains unchanged so the existing defect stays visible.

 JUnit output is written to `bruno-results.xml`, which is ignored by Git.
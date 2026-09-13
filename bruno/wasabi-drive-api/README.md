# Wasabi Drive API Bruno Collection

Import the `bruno/wasabi-drive-api` folder into Bruno and select the `local` environment.

Start the API with `npm start`, then replace the placeholder values in `environments/local.bru` before running requests that use a bucket or user ID.

The `Create user` and `Update user` requests write to MongoDB. Run them only against a development database.

## CI execution

Install the Bruno CLI in the CI image, set the variables consumed by `environments/ci.bru`, then run:

```bash
cd bruno/wasabi-drive-api
bru run . -r --env ci --output ../../bruno-results.xml --format junit
```

The same command is available as `npm run test:integration`. Use a dedicated test database and unique `userName`, because the API does not provide a delete-user endpoint.

The collection asserts successful responses for every endpoint. The auth requests run in this order: list users, create user, validate credentials, get the created user, then update it. The `Create user` response stores `insertedId` as the runtime `userId` used by later requests. `Update user` is expected to expose a current API defect if it returns HTTP 400; the service currently includes MongoDB's immutable `_id` field in its update payload.
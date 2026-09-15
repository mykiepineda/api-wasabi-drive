const express = require("express");
const app = express();
const cors = require("cors");
const serverless = require("serverless-http");
const config = require("./config");
const { createRequireEntraAccessToken } = require("./authentication/requireEntraAccessToken");
const { createRequireTrustedUser } = require("./authentication/requireTrustedUser");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

/* API Endpoints */
app.options("*", cors());
const bucketMiddleware = config.entra.authEnabled
  ? [
      createRequireEntraAccessToken(),
      createRequireTrustedUser(
        config.entra.trustedUserObjectIds,
        config.entra.tenantId,
      ),
    ]
  : [];
app.use("/buckets", ...bucketMiddleware, require("./api/buckets"));
app.use("/auth", require("./api/auth"));

module.exports = app;
module.exports.handler = serverless(app);

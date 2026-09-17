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
app.use(
  "/buckets",
  createRequireEntraAccessToken(),
  createRequireTrustedUser(
    config.entra.trustedUserObjectIds,
    config.entra.tenantId,
  ),
  require("./api/buckets"),
);

module.exports = app;
module.exports.handler = serverless(app);

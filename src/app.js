const express = require("express");
const app = express();
const cors = require("cors");
const serverless = require("serverless-http");
const config = require("./config");
const { createRequestLogger } = require("./observability/requestLogger");
const { createRequireEntraAccessToken } = require("./authentication/requireEntraAccessToken");
const { createRequireTrustedUser } = require("./authentication/requireTrustedUser");
const errorHandler = require("./api/errorHandler");

app.use(createRequestLogger());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

/* API Endpoints */
app.options("*", cors());
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
app.use(
  "/buckets",
  createRequireEntraAccessToken(),
  createRequireTrustedUser(
    config.entra.trustedUserObjectIds,
    config.entra.tenantId,
  ),
  require("./api/buckets"),
);
app.use(errorHandler);

module.exports = app;
module.exports.handler = serverless(app, {
  request: (req, event, context) => {
    if (context?.awsRequestId) {
      req.requestId = context.awsRequestId;
    }
  },
});

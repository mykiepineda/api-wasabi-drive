const express = require("express");
const app = express();
const cors = require("cors");
const serverless = require("serverless-http");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

/* API Endpoints */
app.options("*", cors());
app.use("/buckets", require("./api/buckets"));
app.use("/auth", require("./api/auth"));

module.exports = app;
module.exports.handler = serverless(app);

const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const mongoConnect = require("./util/database").mongoConnect;
const serverless = require("serverless-http");

dotenv.config();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

/* API Endpoints */
app.options("*", cors());
app.use("/buckets", require("./api/buckets"));
app.use("/auth", require("./api/auth"));

mongoConnect(() => {
  app.listen(process.env.PORT, () => {
    console.log(`Server started at Port ${process.env.PORT}`);
  });
});

module.exports.handler = serverless(app);

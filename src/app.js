const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const serverless = require("serverless-http");

dotenv.config();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

/* API Endpoints */
app.options("*", cors());
app.use("/buckets", require("./api/buckets"));
app.use("/auth", require("./api/auth"));

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server started at Port ${PORT}`);
});

module.exports.handler = serverless(app);

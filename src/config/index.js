const dotenv = require("dotenv");

dotenv.config();

const config = {
  port: process.env.PORT || 8080,
  wasabi: {
    serviceUrl: process.env.WASABI_SERVICE_URL,
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID,
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY,
  },
  mongodb: {
    atlasUri: process.env.MONGODB_ATLAS_URI,
    dnsServers: process.env.MONGODB_DNS_SERVERS?.split(",")
      .map((server) => server.trim())
      .filter(Boolean),
  },
};

module.exports = config;
const mongodb = require("mongodb");
const mongoClient = mongodb.MongoClient;

const dns = require("dns");

const dnsServers = process.env.MONGODB_DNS_SERVERS?.split(",")
  .map((server) => server.trim())
  .filter(Boolean);

if (dnsServers?.length) {
  dns.setServers(dnsServers);
}
const client = new mongoClient(process.env.MONGODB_ATLAS_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const clientPromise = client.connect();

module.exports = { mongodb, clientPromise };

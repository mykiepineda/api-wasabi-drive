const mongodb = require("mongodb");
const mongoClient = mongodb.MongoClient;
const config = require("../config");

const dns = require("dns");

const dnsServers = config.mongodb.dnsServers;

if (dnsServers?.length) {
  dns.setServers(dnsServers);
}
const client = new mongoClient(config.mongodb.atlasUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const clientPromise = client.connect();

module.exports = { mongodb, clientPromise };

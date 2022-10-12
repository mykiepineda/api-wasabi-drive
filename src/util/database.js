const mongodb = require("mongodb");
const mongoClient = mongodb.MongoClient;

const client = new mongoClient(process.env.MONGODB_ATLAS_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const clientPromise = client.connect();

module.exports = { mongodb, clientPromise };

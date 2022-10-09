const mongodb = require("mongodb");
const MongoClient = mongodb.MongoClient;

let _db;

const mongoConnect = (callback) => {
  MongoClient.connect(process.env.MONGODB_ATLAS_URI)
    .then((client) => {
      console.log("Connected to database!");
      _db = client.db();
      callback();
    })
    .catch((error) => {
      console.log(error);
      throw error;
    });
};

const getDb = () => {
  if (_db) {
    return _db;
  }
  throw new Error("No database found!");
};

const getCollection = (name) => {
  const db = getDb();
  return db.collection(name);
};

module.exports = { mongodb, mongoConnect, getCollection };

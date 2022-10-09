const { mongodb, getCollection } = require("../util/database");
const { encryptPassword, comparePasswords } = require("../util/password");
const { v4: uuid } = require("uuid");

const getUsers = async ({ id, name }) => {
  const users = getCollection("users");
  if (id || name) {
    let filter;
    if (id) {
      filter = { _id: mongodb.ObjectId(id) };
    } else {
      filter = { name };
    }
    const result = await users.findOne(filter);
    if (!result) {
      throw new Error("user not found!");
    } else {
      return result;
    }
  } else {
    return await users.find().toArray();
  }
};

const createUser = async (req) => {
  const { name, password } = req;
  if (!name) {
    throw new Error("name is required!");
  }
  if (!password) {
    throw new Error("password is required!");
  }

  const payload = {
    name,
    password: await encryptPassword(password),
    token: uuid(),
  };

  const users = getCollection("users");

  return await users.insertOne(payload);
};

const updateUser = async (id, req) => {
  if (!id) {
    throw new Error("_id is required!");
  }
  const prevDoc = await getUsers({ id });
  const { name: newName, password: newPassword, token: newToken } = req;

  let payload = { ...prevDoc };

  if (newName) {
    if (newName !== prevDoc.name) {
      payload = { ...payload, name: newName };
    }
  }

  if (newPassword) {
    const same = comparePasswords(newPassword, prevDoc.password);
    if (!same) {
      payload = { ...payload, password: await encryptPassword(newPassword) };
    }
  }

  // Should only perform deletion of token
  if (!newToken) {
    if (newToken !== prevDoc.token) {
      payload = { ...payload, token: null };
    }
  }

  const users = getCollection("users");

  return users.findOneAndUpdate(
    { _id: mongodb.ObjectId(id) },
    { $set: payload },
    { upsert: false }
  );
};

const validateUser = async (req) => {
  const { name, password } = req;
  if (!name) {
    throw new Error("name is required!");
  }
  if (!password) {
    throw new Error("password is required!");
  }

  const user = await getUsers(req);
  const isAuthenticated = comparePasswords(password, user.password);

  let response = { isAuthenticated };
  if (isAuthenticated) {
    response = { ...response, token: uuid() };
  }

  return response;
};

module.exports = {
  getUsers,
  createUser,
  updateUser,
  validateUser,
};

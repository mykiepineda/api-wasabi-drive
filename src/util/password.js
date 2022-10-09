const bcrypt = require("bcryptjs");
const SALT_ROUNDS = 10;

const encryptPassword = async (password) => {
  return bcrypt.hashSync(password, SALT_ROUNDS);
};

const comparePasswords = (plain, encrypted) => {
  return bcrypt.compareSync(plain, encrypted);
};

module.exports = {
  encryptPassword,
  comparePasswords,
};

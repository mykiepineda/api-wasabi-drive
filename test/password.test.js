const test = require("node:test");
const assert = require("node:assert/strict");

const { comparePasswords, encryptPassword } = require("../src/util/password");

test("encryptPassword creates a password that can be compared", async () => {
  const password = "correct horse battery staple";
  const encrypted = await encryptPassword(password);

  assert.notEqual(encrypted, password);
  assert.equal(comparePasswords(password, encrypted), true);
  assert.equal(comparePasswords("wrong password", encrypted), false);
});
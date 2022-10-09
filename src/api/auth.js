const express = require("express");
const authservice = require("../service/auth");
const router = express.Router();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Get all users
 */
router.get("/users", async (req, res) => {
  try {
    const results = await authservice.getUsers({});
    res.json(results);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Get a user using name
 */
router.get("/users/:id", async (req, res) => {
  try {
    const results = await authservice.getUsers(req.params);
    res.json(results);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Create a new user
 * @param req.body.name must be unique across the entire collection
 */
router.post("/users", async (req, res) => {
  try {
    const { body } = req;
    const result = await authservice.createUser(body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Update a user data
 * Only provided attribute is updated, except for token. Token can only be removed
 */
router.patch("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { body } = req;
    const result = await authservice.updateUser(id, body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Validates user password
 * @return both isAuthenticated flag and new token if password matches, just isAuthenticated flag if not
 */
router.post("/users/validate", async (req, res) => {
  try {
    const { body } = req;
    const result = await authservice.validateUser(body);
    // await sleep(5000);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;

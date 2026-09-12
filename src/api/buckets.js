const express = require("express");
const router = express.Router();
const bucketsService = require("../service/buckets");

/**
 * Get all buckets
 */
router.get("/", async (req, res) => {
  try {
    const results = await bucketsService.getListBuckets();
    res.json(results);
  } catch (error) {
    res.status(400).json(error);
  }
});

/**
 * Get a bucket region information
 * https://wasabi-support.zendesk.com/hc/en-us/articles/360015106031-What-are-the-service-URLs-for-Wasabi-s-different-storage-regions-
 */
router.get("/:name/region", async (req, res) => {
  try {
    const { name } = req.params;
    const result = await bucketsService.getBucketRegion(name);
    res.json(result);
  } catch (error) {
    res.status(400).json(error);
  }
});

/**
 * Get an object information
 */
router.get("/:Bucket/objects/:Prefix(*)", async (req, res) => {
  try {
    const { Bucket, Prefix } = req.params;
    const { MaxKeys, ContinuationToken } = req.query;

    const results = await bucketsService.getListObjects({
      Bucket,
      Prefix,
      MaxKeys,
      ContinuationToken,
    });

    res.json(results);
  } catch (error) {
    res.status(400).json(error);
  }
});

module.exports = router;

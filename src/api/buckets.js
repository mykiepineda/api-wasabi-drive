const express = require("express");
const router = express.Router();
const awss3service = require("../service/aws-s3");

/**
 * Get all buckets
 */
router.get("/", async (req, res) => {
  try {
    const results = await awss3service.getListBuckets();
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
    const results = await awss3service.getBucketLocation(name);

    let region = results.LocationConstraint;
    region = region.substring(region.lastIndexOf(">") + 1);

    let longDescription, shortDescription;
    switch (region) {
      case "us-east-2":
        longDescription = "Wasabi US East 1 (N. Virginia)";
        shortDescription = "N. Virginia";
        break;
      case "us-central-1":
        longDescription = "Wasabi US Central 1 (Texas)";
        shortDescription = "Texas";
        break;
      case "us-west-1":
        longDescription = "Wasabi US West 1 (Oregon)";
        shortDescription = "Oregon";
        break;
      case "ca-central-1":
        longDescription = "Wasabi CA Central 1 (Toronto)";
        shortDescription = "Toronto";
        break;
      case "eu-central-1":
        longDescription = "Wasabi EU Central 1 (Amsterdam)";
        shortDescription = "Amsterdam";
        break;
      case "eu-central-2":
        longDescription = "Wasabi EU Central 2 (Frankfurt)";
        shortDescription = "Frankfurt";
        break;
      case "eu-west-1":
        longDescription = "Wasabi EU West 1 (London)";
        shortDescription = "London";
        break;
      case "eu-west-2":
        longDescription = "Wasabi EU West 2 (Paris)";
        shortDescription = "Paris";
        break;
      case "ap-northeast-1":
        longDescription = "Wasabi AP Northeast 1 (Tokyo)";
        shortDescription = "Tokyo";
        break;
      case "ap-northeast-2":
        longDescription = "Wasabi AP Northeast 2 (Osaka)";
        shortDescription = "Osaka";
        break;
      case "ap-southeast-1":
        longDescription = "Wasabi AP Southeast 1 (Singapore)";
        shortDescription = "Singapore";
        break;
      case "ap-southeast-2":
        longDescription = "Wasabi AP Southeast 2 (Sydney)";
        shortDescription = "Sydney";
        break;
    }

    let response = { region };

    if (longDescription) {
      response = {
        ...response,
        longDescription,
      };
    }

    if (shortDescription) {
      response = {
        ...response,
        shortDescription,
      };
    }

    res.json(response);
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

    const TotalKeyCount = await awss3service.getTotalKeyCount({
      Bucket,
      Prefix,
    });

    const ListObjects = await awss3service.getListObjects({
      Bucket,
      Prefix,
      MaxKeys,
      ContinuationToken,
    });

    res.json({ ...ListObjects, TotalKeyCount });
  } catch (error) {
    res.status(400).json(error);
  }
});

module.exports = router;

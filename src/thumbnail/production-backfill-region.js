const isAllowedProductionSourceRegion = (recipeId, sourceRegion) =>
  (recipeId === "v1" && sourceRegion === "ap-northeast-1")
  || (
    recipeId === "v2"
    && (sourceRegion === "ap-northeast-1" || sourceRegion === "ap-southeast-2")
  );

module.exports = { isAllowedProductionSourceRegion };

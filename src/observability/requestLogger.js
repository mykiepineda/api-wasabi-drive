const config = require("../config");

const routeTemplateMap = [
  ["/health", "health"],
  ["/buckets", "listBuckets"],
  ["/buckets/:name/region", "getBucketRegion"],
  ["/buckets/:Bucket/objects/:Prefix(*)", "listObjects"],
];

const getRequestRoute = (req) => {
  const routePath = req?.route?.path ? String(req.route.path) : "";
  const baseUrl = req?.baseUrl ? String(req.baseUrl) : "";
  const originalUrl = typeof req?.originalUrl === "string" ? req.originalUrl : "";
  const requestPath = typeof req?.path === "string" ? req.path : "";

  if (baseUrl && routePath) {
    const normalizedRoute = routePath === "/" ? "" : routePath;
    const combined = `${baseUrl}${normalizedRoute}`.replace(/\/+/g, "/");
    if (combined.startsWith("/buckets")) {
      return combined;
    }
  }

  if (routePath === "/:name/region") {
    return "/buckets/:name/region";
  }

  if (routePath === "/:Bucket/objects/:Prefix(*)") {
    return "/buckets/:Bucket/objects/:Prefix(*)";
  }

  if (routePath === "/" && (baseUrl === "/buckets" || originalUrl.startsWith("/buckets"))) {
    return "/buckets";
  }

  if (routePath && routePath.startsWith("/buckets")) {
    return routePath;
  }

  if (requestPath === "/health" || originalUrl === "/health") {
    return "/health";
  }

  if (originalUrl.startsWith("/buckets") || requestPath.startsWith("/buckets")) {
    return "/buckets";
  }

  return "/unknown";
};

const getRequestOperation = (req) => {
  const route = getRequestRoute(req);
  const matched = routeTemplateMap.find(([path]) => path === route);
  return matched ? matched[1] : "request";
};

const getErrorCategory = (status, metadata = {}) => {
  if (status === 401) {
    return "authentication";
  }

  if (status === 403) {
    return "authorization";
  }

  if (status >= 500) {
    return metadata.errorCategory || "application";
  }

  if (status >= 400) {
    return metadata.errorCategory || "client";
  }

  return undefined;
};

const createRequestLogger = () => (req, res, next) => {
  const startedAt = Date.now();
  let completed = false;

  const finalize = () => {
    if (completed) {
      return;
    }

    completed = true;
    const status = Number.isInteger(res.statusCode) ? res.statusCode : 200;
    const record = {
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      requestId: req.requestId,
      method: req.method,
      route: getRequestRoute(req),
      operation: getRequestOperation(req),
      status,
      durationMs: Math.max(0, Date.now() - startedAt),
      stage: config.stage,
      releaseSha: config.releaseSha,
    };

    const metadata = res.locals?.logMetadata || {};
    const errorCategory = getErrorCategory(status, metadata);
    if (errorCategory) {
      record.errorCategory = errorCategory;
    }

    if (metadata.storageOperation) {
      record.storageOperation = metadata.storageOperation;
    }

    if (Number.isInteger(metadata.providerStatus)) {
      record.providerStatus = metadata.providerStatus;
    }

    const message = JSON.stringify(record);
    if (record.level === "error") {
      console.error(message);
      return;
    }

    if (record.level === "warn") {
      console.warn(message);
      return;
    }

    console.log(message);
  };

  res.once("finish", finalize);
  next();
};

module.exports = {
  createRequestLogger,
  getRequestRoute,
  getRequestOperation,
  getErrorCategory,
};

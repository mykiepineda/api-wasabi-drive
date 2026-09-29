const { InputValidationError, StorageProviderError } = require("../errors");

const parserResponses = new Map([
  ["entity.parse.failed:400", [400, "Bad Request"]],
  ["request.aborted:400", [400, "Bad Request"]],
  ["request.size.invalid:400", [400, "Bad Request"]],
  ["entity.too.large:413", [413, "Payload Too Large"]],
  ["parameters.too.many:413", [413, "Payload Too Large"]],
  ["charset.unsupported:415", [415, "Unsupported Media Type"]],
  ["encoding.unsupported:415", [415, "Unsupported Media Type"]],
]);

const getPublicResponse = (error) => {
  if (error instanceof InputValidationError) {
    return [400, "MaxKeys must be an integer between 1 and 1000."];
  }

  if (error instanceof StorageProviderError) {
    return [502, "Bad Gateway"];
  }

  const parserResponse = parserResponses.get(`${error?.type}:${error?.status}`);
  if (parserResponse) {
    return parserResponse;
  }

  if (error instanceof URIError && error.status === 400) {
    return [400, "Bad Request"];
  }

  return [500, "Internal Server Error"];
};

const getProviderStatus = (error) => {
  const status = error?.cause?.$metadata?.httpStatusCode;
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
};

const errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const [status, message] = getPublicResponse(error);
  if (status >= 500) {
    const record = {
      category: error instanceof StorageProviderError ? "storage" : "application",
      status,
    };
    if (error instanceof StorageProviderError) {
      record.operation = error.operation;
      const providerStatus = getProviderStatus(error);
      if (providerStatus !== undefined) {
        record.providerStatus = providerStatus;
      }
    }
    console.error(JSON.stringify(record));
  }

  return res.status(status).json({ error: message });
};

module.exports = errorHandler;
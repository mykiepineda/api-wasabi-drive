const storageOperations = new Set([
  "ListBuckets",
  "GetBucketLocation",
  "ListObjectsV2",
]);

class InputValidationError extends Error {
  constructor() {
    super("MaxKeys must be an integer between 1 and 1000.");
    this.name = "InputValidationError";
  }
}

class StorageProviderError extends Error {
  constructor(operation, cause) {
    if (!storageOperations.has(operation)) {
      throw new TypeError("Invalid storage operation.");
    }

    super("Storage provider request failed.", { cause });
    this.name = "StorageProviderError";
    this.operation = operation;
  }
}

module.exports = {
  InputValidationError,
  StorageProviderError,
};
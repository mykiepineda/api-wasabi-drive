const { InputValidationError } = require("../errors");

const parseMaxKeys = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new InputValidationError();
  }

  const maxKeys = Number(value);
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1 || maxKeys > 1000) {
    throw new InputValidationError();
  }

  return maxKeys;
};

module.exports = parseMaxKeys;
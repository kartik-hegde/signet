import { Validator, type OutputUnit } from "@cfworker/json-schema";

import { ValidationError, type ValidationIssue } from "./errors.js";

const supportedTypes = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

function assertSupportedType(schema: object): void {
  const type = (schema as { type?: unknown }).type;
  const types = Array.isArray(type) ? type : type === undefined ? [] : [type];
  if (
    types.some(
      (value) => typeof value !== "string" || !supportedTypes.has(value),
    )
  ) {
    throw new TypeError(
      "Invalid Signet tool: inputSchema is not a valid JSON Schema.",
    );
  }
}

function issue(error: OutputUnit): ValidationIssue {
  return {
    path: error.instanceLocation || "/",
    message: error.error,
    keyword: error.keyword,
  };
}

export function compileInputValidator(
  schema: object,
): (input: unknown) => void {
  assertSupportedType(schema);

  let validator: Validator;
  try {
    validator = new Validator(schema, "2020-12", false);
  } catch (error) {
    throw new TypeError(
      "Invalid Signet tool: inputSchema is not a valid JSON Schema.",
      { cause: error },
    );
  }

  return (input) => {
    const result = validator.validate(input);
    if (result.valid) return;
    throw new ValidationError(result.errors.map(issue));
  };
}

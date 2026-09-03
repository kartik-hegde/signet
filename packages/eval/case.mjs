const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CASE_KINDS = new Set([
  "read",
  "mutation",
  "multi_step",
  "consequential",
  "recovery",
  "negative",
]);

export const CASE_SCHEMA_VERSION = 1;

/** Define one portable user intent and its independently graded expectations. */
export function defineCase(definition) {
  if (!isRecord(definition))
    throw new TypeError("A Signett Case must be an object.");
  const value = {
    ...definition,
    schemaVersion: definition.schemaVersion ?? CASE_SCHEMA_VERSION,
  };
  validateCase(value);
  return deepFreeze(value);
}

/** Define an ordered collection of Cases without changing the Cases themselves. */
export function defineSuite(definition) {
  if (!isRecord(definition))
    throw new TypeError("A Signett Suite must be an object.");
  if (!CASE_ID.test(definition.id ?? "")) {
    throw new TypeError("Suite id must be lower-kebab-case.");
  }
  if (!Array.isArray(definition.cases) || definition.cases.length === 0) {
    throw new TypeError("A Signett Suite must contain at least one Case.");
  }
  const ids = new Set();
  for (const value of definition.cases) {
    validateCase(value);
    if (ids.has(value.id))
      throw new TypeError(`Duplicate Case id: ${value.id}`);
    ids.add(value.id);
  }
  return deepFreeze({ ...definition, cases: [...definition.cases] });
}

export function validateCase(value) {
  if (!isRecord(value))
    throw new TypeError("A Signett Case must be an object.");
  if (value.schemaVersion !== CASE_SCHEMA_VERSION) {
    throw new TypeError(
      `Unsupported Case schema version: ${value.schemaVersion}`,
    );
  }
  if (!CASE_ID.test(value.id ?? "")) {
    throw new TypeError("Case id must be lower-kebab-case.");
  }
  if (typeof value.intent !== "string" || value.intent.trim().length < 8) {
    throw new TypeError("Case intent must describe a user goal.");
  }
  if (!CASE_KINDS.has(value.kind)) {
    throw new TypeError(`Unsupported Case kind: ${value.kind}`);
  }
  if (typeof value.application !== "string" || value.application.length === 0) {
    throw new TypeError("Case application must name an application adapter.");
  }
  if (typeof value.oracle !== "string" || value.oracle.length === 0) {
    throw new TypeError("Case oracle must name an oracle adapter.");
  }
  validateStringArray(value.tags, "tags");
  validateStringArray(value.faults, "faults");
  if (!isRecord(value.expectations)) {
    throw new TypeError("Case expectations must be an object.");
  }
  validateStringArray(
    value.expectations.requiredCapabilities,
    "expectations.requiredCapabilities",
  );
  validateStringArray(
    value.expectations.forbiddenEffects,
    "expectations.forbiddenEffects",
  );
  if (
    value.expectations.completionCapability !== undefined &&
    typeof value.expectations.completionCapability !== "string"
  ) {
    throw new TypeError("completionCapability must be a string.");
  }
  if (value.budgets !== undefined) {
    if (!isRecord(value.budgets))
      throw new TypeError("Case budgets must be an object.");
    for (const field of ["timeoutMs", "maxActions", "maxToolCalls"]) {
      const budget = value.budgets[field];
      if (
        budget !== undefined &&
        (!Number.isSafeInteger(budget) || budget <= 0)
      ) {
        throw new TypeError(
          `Case budgets.${field} must be a positive integer.`,
        );
      }
    }
  }
  if (value.parameters !== undefined && !isRecord(value.parameters)) {
    throw new TypeError("Case parameters must be an object.");
  }
  return value;
}

function validateStringArray(value, path) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`Case ${path} must be an array of strings.`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

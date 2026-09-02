export const AGENT_TEST_SCHEMA_VERSION = 1;

export function defineAgentTestSuite(definition) {
  if (!isRecord(definition)) {
    throw new TypeError("An agent test suite must be an object.");
  }
  if (definition.schemaVersion !== AGENT_TEST_SCHEMA_VERSION) {
    throw new TypeError(
      `Unsupported agent test suite schema: ${definition.schemaVersion}.`,
    );
  }
  requireId(definition.id, "suite id");
  if (!isRecord(definition.application)) {
    throw new TypeError("A suite must define an application adapter.");
  }
  requireId(definition.application.id, "application id");
  if (
    typeof definition.application.url !== "string" &&
    typeof definition.application.url !== "function"
  ) {
    throw new TypeError("The application adapter must define url.");
  }
  if (!Array.isArray(definition.tasks) || definition.tasks.length === 0) {
    throw new TypeError("A suite must contain at least one task.");
  }
  const ids = new Set();
  const tasks = definition.tasks.map((task) => {
    validateTask(task);
    if (ids.has(task.id)) throw new TypeError(`Duplicate task: ${task.id}.`);
    ids.add(task.id);
    return deepFreeze({ ...task });
  });
  return deepFreeze({ ...definition, tasks });
}

export function validateTask(task) {
  if (!isRecord(task)) throw new TypeError("An agent task must be an object.");
  requireId(task.id, "task id");
  if (typeof task.prompt !== "string" || task.prompt.trim().length < 8) {
    throw new TypeError(`Task ${task.id} must define a meaningful prompt.`);
  }
  if (task.budgets !== undefined) {
    if (!isRecord(task.budgets)) {
      throw new TypeError(`Task ${task.id} budgets must be an object.`);
    }
    for (const key of [
      "timeoutMs",
      "toolTimeoutMs",
      "maxSteps",
      "maxToolCalls",
      "maxResultChars",
    ]) {
      const value = task.budgets[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new TypeError(`Task ${task.id} budgets.${key} must be positive.`);
      }
    }
  }
  for (const key of ["requiredTools", "forbiddenTools"]) {
    const value = task.expectations?.[key];
    if (
      value !== undefined &&
      (!Array.isArray(value) ||
        value.some((entry) => typeof entry !== "string"))
    ) {
      throw new TypeError(`Task ${task.id} expectations.${key} is invalid.`);
    }
  }
  const maxToolErrors = task.expectations?.maxToolErrors;
  if (
    maxToolErrors !== undefined &&
    (!Number.isSafeInteger(maxToolErrors) || maxToolErrors < 0)
  ) {
    throw new TypeError(
      `Task ${task.id} expectations.maxToolErrors must be a non-negative integer.`,
    );
  }
  return task;
}

function requireId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new TypeError(`${label} must be lower-kebab-case.`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

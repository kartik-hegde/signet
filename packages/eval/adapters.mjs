import { defineSuite } from "./case.mjs";

const ADAPTER_KINDS = ["application", "browser", "agent", "oracle"];

/**
 * Bind a Suite to the adapters and named experimental conditions that can run it.
 * Adapters remain ordinary objects so applications can depend on any browser or agent SDK.
 */
export function defineEvaluation(definition) {
  if (!isRecord(definition))
    throw new TypeError("An Evaluation must be an object.");
  const suite = defineSuite(definition.suite);
  const adapters = definition.adapters;
  if (!isRecord(adapters))
    throw new TypeError("Evaluation adapters must be an object.");

  for (const kind of ADAPTER_KINDS) validateAdapter(kind, adapters[kind]);
  const faults = adapters.faults ?? [];
  if (!Array.isArray(faults))
    throw new TypeError("Evaluation fault adapters must be an array.");
  for (const fault of faults) validateAdapter("fault", fault);

  const conditions = definition.conditions ?? [{ id: "default" }];
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new TypeError("An Evaluation must define at least one condition.");
  }
  const conditionIds = new Set();
  for (const condition of conditions) {
    if (!isRecord(condition) || !validId(condition.id)) {
      throw new TypeError("Condition id must be lower-kebab-case.");
    }
    if (conditionIds.has(condition.id))
      throw new TypeError(`Duplicate condition: ${condition.id}`);
    conditionIds.add(condition.id);
  }

  if (
    suite.cases.some((item) => item.application !== adapters.application.id)
  ) {
    throw new TypeError(
      "Every Case application must match the application adapter id.",
    );
  }
  if (suite.cases.some((item) => item.oracle !== adapters.oracle.id)) {
    throw new TypeError("Every Case oracle must match the oracle adapter id.");
  }
  const faultIds = new Set(faults.map((fault) => fault.id));
  for (const item of suite.cases) {
    for (const fault of item.faults ?? []) {
      if (!faultIds.has(fault))
        throw new TypeError(`Case ${item.id} requires unknown fault: ${fault}`);
    }
  }

  const normalized = {
    ...definition,
    suite,
    conditions: Object.freeze(
      conditions.map((condition) => Object.freeze({ ...condition })),
    ),
    adapters: Object.freeze({
      ...adapters,
      faults: Object.freeze([...faults]),
    }),
  };
  return Object.freeze(normalized);
}

export function validateAdapter(kind, adapter) {
  if (!isRecord(adapter))
    throw new TypeError(`${kind} adapter must be an object.`);
  if (!validId(adapter.id))
    throw new TypeError(`${kind} adapter id must be lower-kebab-case.`);
  const required = {
    application: ["reset", "entrypoint"],
    browser: ["open", "inventory"],
    agent: ["run"],
    fault: ["arm", "disarm"],
    oracle: ["snapshot", "grade"],
  }[kind];
  if (!required) throw new TypeError(`Unknown adapter kind: ${kind}`);
  for (const method of required) {
    if (typeof adapter[method] !== "function") {
      throw new TypeError(
        `${kind} adapter ${adapter.id} must implement ${method}().`,
      );
    }
  }
  return adapter;
}

function validId(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

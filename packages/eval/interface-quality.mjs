/**
 * Interface-quality scoring.
 *
 * The oracle decides whether a task succeeded. These metrics answer the separate
 * question the oracle cannot: how well did the published interface serve the agent?
 * Every value is derived from the declared Case expectations, the exact tool inventory
 * the browser exposed, and the recorded trace — never from agent narration.
 */

export const INTERFACE_QUALITY_SCHEMA_VERSION = 1;

/** Trace event vocabulary the runner scores. Agent adapters should emit these types. */
export const TRACE_EVENTS = Object.freeze({
  toolCall: "webmcp_call",
  uiAction: "ui_action",
  uiInspection: "ui_inspection",
});

const NOT_APPLICABLE = Object.freeze({
  noExpectations: "The Case declares no required capabilities.",
  noInventory: "The browser adapter reported no tool inventory.",
  capabilityUnavailable:
    "The condition did not expose every required capability, so selection is not scoreable.",
  noArguments: "No inventory-schema tool call carried scoreable arguments.",
  unknownSurface:
    "Without a published inventory there is no way to tell a real capability from an invented one.",
  undeterminedContinuation:
    "Every tool error was the run's last action, so continuation is unobservable.",
  noToolErrors: "The interface returned no tool errors.",
  noActions: "The trial recorded no agent actions.",
  noBudgets: "The Case declares no action budgets.",
});

/**
 * Score one Trial's interface quality.
 *
 * Each dimension reports `applicable`, because a metric that cannot apply to a
 * condition must read as "not scored" rather than as a failure. A UI-only arm, for
 * example, never exposes the WebMCP capabilities a Case requires; scoring it zero
 * would attribute a condition boundary to the interface.
 */
export function scoreInterfaceQuality({
  caseDefinition,
  inventory = [],
  events = [],
  agent = {},
  status = "completed",
}) {
  const expectations = caseDefinition?.expectations ?? {};
  const trace = collectTrace(events, agent);
  const inventoryByName = new Map(
    (inventory ?? [])
      .filter((tool) => typeof tool?.name === "string")
      .map((tool) => [tool.name, tool]),
  );

  markKnownCalls(trace.calls, inventoryByName);
  const discovery = scoreDiscovery(expectations, inventoryByName);
  const selection = scoreSelection(
    expectations,
    discovery,
    trace,
    inventoryByName.size > 0,
  );
  const argumentUse = scoreArguments(trace, inventoryByName);
  const continuation = scoreContinuation(trace, agent, status);
  const surface = scoreSurface(trace, discovery);
  const budgets = scoreBudgets(caseDefinition?.budgets, trace);

  return {
    schemaVersion: INTERFACE_QUALITY_SCHEMA_VERSION,
    source: trace.source,
    discovery,
    selection,
    arguments: argumentUse,
    continuation,
    surface,
    budgets,
  };
}

/**
 * Did the condition actually publish the capabilities the Case needs?
 * A missing capability is a registration problem, not an agent mistake.
 */
function scoreDiscovery(expectations, inventoryByName) {
  const required = capabilities(expectations);
  if (required.length === 0) {
    return {
      applicable: false,
      reason: NOT_APPLICABLE.noExpectations,
      expected: 0,
      available: 0,
      unavailableCapabilities: [],
      complete: null,
    };
  }
  if (inventoryByName.size === 0) {
    return {
      applicable: false,
      reason: NOT_APPLICABLE.noInventory,
      expected: required.length,
      available: 0,
      unavailableCapabilities: [...required],
      complete: null,
    };
  }
  const unavailable = required.filter((name) => !inventoryByName.has(name));
  return {
    applicable: true,
    expected: required.length,
    available: required.length - unavailable.length,
    unavailableCapabilities: unavailable,
    complete: unavailable.length === 0,
  };
}

/**
 * Did the agent choose the declared capabilities, and only capabilities that exist?
 * Calling a tool absent from the inventory is an interface-legibility failure.
 */
function scoreSelection(expectations, discovery, trace, inventoryPublished) {
  const required = requiredCapabilities(expectations);
  const completion = expectations.completionCapability;
  const called = new Set(trace.calls.map(({ tool }) => tool));
  const unknownToolCalls = unique(
    trace.calls.filter(({ known }) => known === false).map(({ tool }) => tool),
  );
  const missingCapabilities = required.filter((name) => !called.has(name));
  const completionCalled =
    completion === undefined ? null : called.has(completion);

  const base = {
    requiredCapabilities: required,
    completionCapability: completion ?? null,
    calledCapabilities: required.filter((name) => called.has(name)),
    missingCapabilities,
    completionCapabilityCalled: completionCalled,
    unknownToolCalls,
    toolCalls: trace.calls.length,
  };

  if (capabilities(expectations).length === 0) {
    return {
      ...base,
      applicable: false,
      reason: NOT_APPLICABLE.noExpectations,
      accurate: null,
    };
  }
  if (!inventoryPublished) {
    return {
      ...base,
      applicable: false,
      reason: NOT_APPLICABLE.unknownSurface,
      accurate: null,
    };
  }
  if (!discovery.complete) {
    return {
      ...base,
      applicable: false,
      reason: NOT_APPLICABLE.capabilityUnavailable,
      accurate: null,
    };
  }
  return {
    ...base,
    applicable: true,
    accurate:
      missingCapabilities.length === 0 &&
      unknownToolCalls.length === 0 &&
      completionCalled !== false,
  };
}

/**
 * Were the recorded arguments valid against the schema the interface published?
 * This measures the interface's schema, not the application's business rules.
 */
function scoreArguments(trace, inventoryByName) {
  const violations = [];
  let evaluatedCalls = 0;
  for (const call of trace.calls) {
    const schema = inventoryByName.get(call.tool)?.inputSchema;
    if (!isRecord(schema) || !call.hasInput) continue;
    evaluatedCalls += 1;
    const problems = validateAgainstSchema(call.input, schema);
    if (problems.length > 0) {
      violations.push({
        tool: call.tool,
        sequence: call.sequence,
        problems,
      });
    }
  }
  if (evaluatedCalls === 0) {
    return {
      applicable: false,
      reason: NOT_APPLICABLE.noArguments,
      evaluatedCalls: 0,
      validCalls: 0,
      invalidCalls: 0,
      validity: null,
      accurate: null,
      violations: [],
    };
  }
  const invalidCalls = violations.length;
  return {
    applicable: true,
    evaluatedCalls,
    validCalls: evaluatedCalls - invalidCalls,
    invalidCalls,
    validity: (evaluatedCalls - invalidCalls) / evaluatedCalls,
    accurate: invalidCalls === 0,
    violations,
  };
}

/**
 * After a tool returned an error, did the agent keep working instead of abandoning
 * the task? A legible error message is only useful if the agent can act on it.
 */
function scoreContinuation(trace, agent, status) {
  const errors = trace.calls.filter(({ ok }) => ok === false);
  if (errors.length === 0) {
    return {
      applicable: false,
      reason: NOT_APPLICABLE.noToolErrors,
      toolErrors: 0,
      continuedErrors: 0,
      continuationRate: null,
      continued: null,
    };
  }
  // Continuation is only observable when the agent acted again. An error that was
  // the run's last action is undetermined if the run then ended cleanly — the trace
  // cannot say whether the agent concluded deliberately, as a negative Case wants, or
  // gave up — and counts against the interface only when the run did not survive it.
  const survived = status === "completed" && agent?.timedOut !== true;
  const observed = errors.filter(
    ({ sequence }) => sequence < trace.lastActionSequence || !survived,
  );
  const continuedErrors = observed.filter(
    ({ sequence }) => sequence < trace.lastActionSequence,
  ).length;
  if (observed.length === 0) {
    return {
      applicable: false,
      reason: NOT_APPLICABLE.undeterminedContinuation,
      toolErrors: errors.length,
      observedErrors: 0,
      continuedErrors: 0,
      continuationRate: null,
      continued: null,
      errorTools: unique(errors.map(({ tool }) => tool)),
    };
  }
  return {
    applicable: true,
    toolErrors: errors.length,
    observedErrors: observed.length,
    continuedErrors,
    continuationRate: continuedErrors / observed.length,
    continued: continuedErrors === observed.length,
    errorTools: unique(errors.map(({ tool }) => tool)),
  };
}

/**
 * Which surface did the agent actually work through? Attributing a gain to WebMCP
 * requires knowing whether the run touched the DOM at all.
 */
function scoreSurface(trace, discovery) {
  const totalActions =
    trace.uiActions + trace.uiInspections + trace.calls.length;
  if (totalActions === 0) {
    return {
      applicable: false,
      reason: NOT_APPLICABLE.noActions,
      uiActions: 0,
      uiInspections: 0,
      toolCalls: 0,
      failedToolCalls: 0,
      fullWebMcp: null,
      uiFallback: null,
    };
  }
  const capabilityAvailable = discovery.available > 0 || trace.calls.length > 0;
  return {
    applicable: true,
    uiActions: trace.uiActions,
    uiInspections: trace.uiInspections,
    toolCalls: trace.calls.length,
    failedToolCalls: trace.calls.filter(({ ok }) => ok === false).length,
    fullWebMcp: trace.calls.length > 0 && trace.uiActions === 0,
    uiFallback: capabilityAvailable && trace.uiActions > 0,
  };
}

/** Did the run stay inside the action budget the Case declared? */
function scoreBudgets(budgets, trace) {
  const actions = trace.uiActions + trace.uiInspections + trace.calls.length;
  const toolCalls = trace.calls.length;
  if (!isRecord(budgets) || (!budgets.maxActions && !budgets.maxToolCalls)) {
    return {
      applicable: false,
      reason: NOT_APPLICABLE.noBudgets,
      actions,
      toolCalls,
      exceeded: null,
      exceededBudgets: [],
    };
  }
  const exceededBudgets = [];
  if (budgets.maxActions !== undefined && actions > budgets.maxActions) {
    exceededBudgets.push("maxActions");
  }
  if (budgets.maxToolCalls !== undefined && toolCalls > budgets.maxToolCalls) {
    exceededBudgets.push("maxToolCalls");
  }
  return {
    applicable: true,
    actions,
    toolCalls,
    maxActions: budgets.maxActions ?? null,
    maxToolCalls: budgets.maxToolCalls ?? null,
    exceeded: exceededBudgets.length > 0,
    exceededBudgets,
  };
}

/**
 * Read the trace the agent adapter recorded. Trace events are authoritative because
 * they carry arguments and outcomes; a summary-only adapter still yields tool names.
 */
function collectTrace(events, agent) {
  const calls = [];
  let uiActions = 0;
  let uiInspections = 0;
  let lastActionSequence = -1;
  for (const event of events ?? []) {
    const sequence = Number.isFinite(event?.sequence)
      ? event.sequence
      : calls.length + uiActions + uiInspections;
    if (event?.type === TRACE_EVENTS.toolCall) {
      calls.push({
        tool: String(event.tool ?? ""),
        input: event.input,
        hasInput: isScoreableInput(event.input),
        ok: event.ok === undefined ? null : Boolean(event.ok),
        sequence,
      });
      lastActionSequence = sequence;
    } else if (event?.type === TRACE_EVENTS.uiAction) {
      uiActions += 1;
      lastActionSequence = sequence;
    } else if (event?.type === TRACE_EVENTS.uiInspection) {
      uiInspections += 1;
      lastActionSequence = sequence;
    }
  }
  if (calls.length > 0 || uiActions > 0 || uiInspections > 0) {
    return {
      source: "events",
      calls,
      uiActions,
      uiInspections,
      lastActionSequence,
    };
  }
  return summaryTrace(agent);
}

/**
 * A trace may drop an argument it could not record — an oversized input is stored as a
 * truncation marker. Scoring that placeholder would report a violation the agent never
 * committed, so such a call is left out of argument validity rather than failed.
 */
function isScoreableInput(input) {
  if (input === undefined || input === null) return false;
  return !(isRecord(input) && input.truncated === true);
}

/** Fall back to the adapter's own counts when no trace events were emitted. */
function summaryTrace(agent) {
  const sequence = Array.isArray(agent?.toolSequence) ? agent.toolSequence : [];
  const actions = isRecord(agent?.actions) ? agent.actions : {};
  const calls = sequence.map((tool, index) => ({
    tool: String(tool),
    input: undefined,
    hasInput: false,
    ok: null,
    sequence: index,
  }));
  return {
    source:
      sequence.length > 0 || isRecord(agent?.actions) ? "summary" : "none",
    calls,
    uiActions: count(actions.ui),
    uiInspections: count(actions.inspections),
    lastActionSequence: calls.length - 1,
  };
}

/** Mark calls the published inventory never offered. Applied after inventory lookup. */
function markKnownCalls(calls, inventoryByName) {
  for (const call of calls) {
    call.known = inventoryByName.size === 0 || inventoryByName.has(call.tool);
  }
  return calls;
}

/**
 * Validate a value against the subset of JSON Schema that tool definitions use:
 * type, enum, const, required, properties, additionalProperties, items, and the
 * standard numeric, string, and array bounds. Unsupported keywords are ignored so an
 * unrecognized schema never invents a violation.
 */
export function validateAgainstSchema(value, schema, path = "") {
  if (!isRecord(schema)) return [];
  const problems = [];
  const label = path || "input";

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      problems.push(...validateAgainstSchema(value, branch, path));
    }
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const matched = schema.anyOf.some(
      (branch) => validateAgainstSchema(value, branch, path).length === 0,
    );
    if (!matched) problems.push(`${label} matches no anyOf branch`);
  }
  // Exclusivity is not decidable here: branches that differ only by a keyword this
  // validator ignores all "match", so counting them would invent a violation. Require
  // one matching branch and leave true oneOf exclusivity to the application.
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const matched = schema.oneOf.some(
      (branch) => validateAgainstSchema(value, branch, path).length === 0,
    );
    if (!matched) problems.push(`${label} matches no oneOf branch`);
  }
  if (schema.const !== undefined && !sameValue(value, schema.const)) {
    problems.push(`${label} must equal ${JSON.stringify(schema.const)}`);
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => sameValue(value, candidate))
  ) {
    problems.push(`${label} is not one of the allowed values`);
  }
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    problems.push(
      `${label} must be ${[schema.type].flat().join(" or ")}, received ${typeName(value)}`,
    );
    return problems;
  }

  if (isRecord(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key))
        problems.push(`${label}.${key} is required`);
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        problems.push(
          ...validateAgainstSchema(child, properties[key], `${label}.${key}`),
        );
      } else if (schema.additionalProperties === false) {
        problems.push(`${label}.${key} is not an accepted property`);
      } else if (isRecord(schema.additionalProperties)) {
        problems.push(
          ...validateAgainstSchema(
            child,
            schema.additionalProperties,
            `${label}.${key}`,
          ),
        );
      }
    }
  }

  if (Array.isArray(value)) {
    if (isRecord(schema.items)) {
      for (const [index, item] of value.entries()) {
        problems.push(
          ...validateAgainstSchema(item, schema.items, `${label}[${index}]`),
        );
      }
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problems.push(`${label} needs at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      problems.push(`${label} allows at most ${schema.maxItems} items`);
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      problems.push(`${label} is shorter than ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      problems.push(`${label} is longer than ${schema.maxLength} characters`);
    }
    if (
      typeof schema.pattern === "string" &&
      !safeMatch(schema.pattern, value)
    ) {
      problems.push(`${label} does not match ${schema.pattern}`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      problems.push(`${label} is below the minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      problems.push(`${label} is above the maximum ${schema.maximum}`);
    }
    if (
      typeof schema.exclusiveMinimum === "number" &&
      value <= schema.exclusiveMinimum
    ) {
      problems.push(`${label} must exceed ${schema.exclusiveMinimum}`);
    }
    if (
      typeof schema.exclusiveMaximum === "number" &&
      value >= schema.exclusiveMaximum
    ) {
      problems.push(`${label} must stay below ${schema.exclusiveMaximum}`);
    }
    if (schema.multipleOf !== undefined && schema.multipleOf > 0) {
      const quotient = value / schema.multipleOf;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
        problems.push(`${label} must be a multiple of ${schema.multipleOf}`);
      }
    }
  }

  return problems;
}

function matchesType(value, type) {
  return [type].flat().some((candidate) => {
    switch (candidate) {
      case "object":
        return isRecord(value);
      case "array":
        return Array.isArray(value);
      case "string":
        return typeof value === "string";
      case "integer":
        return Number.isInteger(value);
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      case "null":
        return value === null;
      default:
        return true;
    }
  });
}

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function safeMatch(pattern, value) {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

function requiredCapabilities(expectations) {
  return [...(expectations.requiredCapabilities ?? [])];
}

function capabilities(expectations) {
  return unique([
    ...requiredCapabilities(expectations),
    ...(expectations.completionCapability === undefined
      ? []
      : [expectations.completionCapability]),
  ]);
}

function count(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function unique(values) {
  return [...new Set(values)];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

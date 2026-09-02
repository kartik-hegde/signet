import { Validator } from "@cfworker/json-schema";

/**
 * Interface-quality scoring.
 *
 * The oracle decides whether a task succeeded. These metrics answer the separate
 * question the oracle cannot: how well did the published interface serve the agent?
 * Every value is derived from the declared Case expectations, the exact tool inventory
 * the browser exposed, and the recorded trace — never from agent narration.
 */

/** Trace event vocabulary the runner scores. Agent adapters should emit these types. */
export const TRACE_EVENTS = Object.freeze({
  toolCall: "webmcp_call",
});

const NOT_APPLICABLE = Object.freeze({
  noExpectations: "The Case declares no required capabilities.",
  capabilityUnavailable:
    "The condition did not expose every required capability, so selection is not scoreable.",
  noArguments: "No inventory-schema tool call carried scoreable arguments.",
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
  const selection = scoreSelection(expectations, discovery, trace);
  const argumentUse = scoreArguments(trace, inventoryByName);

  return {
    source: trace.source,
    discovery,
    selection,
    arguments: argumentUse,
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
function scoreSelection(expectations, discovery, trace) {
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
    violations,
  };
}

/**
 * Read the trace the agent adapter recorded. Trace events are authoritative because
 * they carry arguments and outcomes; a summary-only adapter still yields tool names.
 */
function collectTrace(events, agent) {
  const calls = [];
  for (const event of events ?? []) {
    const sequence = Number.isFinite(event?.sequence)
      ? event.sequence
      : calls.length;
    if (event?.type === TRACE_EVENTS.toolCall) {
      calls.push({
        tool: String(event.tool ?? ""),
        input: event.input,
        hasInput: isScoreableInput(event.input),
        sequence,
      });
    }
  }
  if (calls.length > 0) return { source: "events", calls };
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
  const calls = sequence.map((tool, index) => ({
    tool: String(tool),
    input: undefined,
    hasInput: false,
    sequence: index,
  }));
  return {
    source: sequence.length > 0 ? "summary" : "none",
    calls,
  };
}

/** Mark calls the published inventory never offered. Applied after inventory lookup. */
function markKnownCalls(calls, inventoryByName) {
  for (const call of calls) {
    call.known = inventoryByName.has(call.tool);
  }
  return calls;
}

/** Validate recorded arguments with the same JSON Schema engine as Signet tools. */
export function validateAgainstSchema(value, schema, path = "") {
  if (!isRecord(schema)) return [];
  const label = path || "input";
  try {
    const result = new Validator(schema, "2020-12", false).validate(value);
    return result.errors.map(
      (error) =>
        `${label}${pointerSuffix(error.instanceLocation)}: ${error.error}`,
    );
  } catch {
    // A bad or unsupported schema cannot prove that the agent's arguments were bad.
    return [];
  }
}

function pointerSuffix(location) {
  if (!location || location === "#") return "";
  return location
    .replace(/^#\/?/, "")
    .split("/")
    .map((part) => `.${part.replaceAll("~1", "/").replaceAll("~0", "~")}`)
    .join("");
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

function unique(values) {
  return [...new Set(values)];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

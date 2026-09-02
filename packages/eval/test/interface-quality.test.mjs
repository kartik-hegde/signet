import assert from "node:assert/strict";
import test from "node:test";

import {
  defineCase,
  scoreInterfaceQuality,
  validateAgainstSchema,
} from "../index.mjs";

const paymentCase = defineCase({
  id: "pay-once",
  intent: "Send Lia $12.00 exactly once.",
  kind: "consequential",
  application: "payments",
  oracle: "database",
  expectations: {
    requiredCapabilities: ["search_payment_users", "send_payment"],
    completionCapability: "send_payment",
    forbiddenEffects: ["duplicate-payment"],
  },
});

const inventory = [
  {
    name: "search_payment_users",
    description: "Find a payment recipient.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "send_payment",
    description: "Send one payment.",
    inputSchema: {
      type: "object",
      properties: {
        recipientId: { type: "string" },
        amountCents: { type: "integer", minimum: 1 },
      },
      required: ["recipientId", "amountCents"],
      additionalProperties: false,
    },
  },
];

const uiInventory = [
  {
    name: "click_element",
    description: "Click an inspected element.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
  },
];

let sequence = 0;
function event(type, detail = {}) {
  return { sequence: sequence++, atMs: sequence, type, ...detail };
}
function trace(events) {
  sequence = 0;
  return events;
}

function score(overrides = {}) {
  return scoreInterfaceQuality({
    caseDefinition: paymentCase,
    inventory,
    agent: { timedOut: false },
    ...overrides,
  });
}

test("selection is accurate when every declared capability is used", () => {
  const quality = score({
    events: trace([
      event("webmcp_call", {
        tool: "search_payment_users",
        input: { query: "Lia" },
        ok: true,
      }),
      event("webmcp_call", {
        tool: "send_payment",
        input: { recipientId: "u1", amountCents: 1200 },
        ok: true,
      }),
    ]),
  });
  assert.equal(quality.selection.applicable, true);
  assert.equal(quality.selection.accurate, true);
  assert.equal(quality.selection.completionCapabilityCalled, true);
  assert.equal(quality.discovery.complete, true);
});

test("a missing capability and an invented tool both fail selection", () => {
  const quality = score({
    events: trace([
      event("webmcp_call", {
        tool: "list_recent_payments",
        input: {},
        ok: false,
      }),
      event("webmcp_call", {
        tool: "send_payment",
        input: { recipientId: "u1", amountCents: 1200 },
        ok: true,
      }),
    ]),
  });
  assert.equal(quality.selection.accurate, false);
  assert.deepEqual(quality.selection.missingCapabilities, [
    "search_payment_users",
  ]);
  assert.deepEqual(quality.selection.unknownToolCalls, [
    "list_recent_payments",
  ]);
});

test("a condition that never published the capability is not scored for selection", () => {
  const quality = score({
    inventory: uiInventory,
    events: trace([
      event("ui_inspection"),
      event("ui_action", { action: "click" }),
    ]),
  });
  assert.equal(quality.discovery.applicable, true);
  assert.equal(quality.discovery.complete, false);
  assert.deepEqual(quality.discovery.unavailableCapabilities, [
    "search_payment_users",
    "send_payment",
  ]);
  assert.equal(quality.selection.applicable, false);
  assert.equal(quality.selection.accurate, null);
});

test("arguments are validated against the schema the interface published", () => {
  const quality = score({
    events: trace([
      event("webmcp_call", {
        tool: "search_payment_users",
        input: { query: "Lia", limit: 5 },
        ok: false,
      }),
      event("webmcp_call", {
        tool: "send_payment",
        input: { recipientId: "u1", amountCents: "1200" },
        ok: false,
      }),
      event("webmcp_call", {
        tool: "send_payment",
        input: { recipientId: "u1", amountCents: 1200 },
        ok: true,
      }),
    ]),
  });
  assert.equal(quality.arguments.evaluatedCalls, 3);
  assert.equal(quality.arguments.invalidCalls, 2);
  assert.equal(quality.arguments.validity, 1 / 3);
  assert.ok(
    quality.arguments.violations[0].problems.some((problem) =>
      problem.includes('Property "limit"'),
    ),
  );
  assert.match(
    quality.arguments.violations[1].problems.join("\n"),
    /Expected "integer"/,
  );
});

test("an adapter without a trace still yields selection from its tool sequence", () => {
  const quality = score({
    events: [],
    agent: {
      timedOut: false,
      toolSequence: ["search_payment_users", "send_payment"],
    },
  });
  assert.equal(quality.source, "summary");
  assert.equal(quality.selection.accurate, true);
  assert.equal(quality.arguments.applicable, false);
});

test("a Case without capability expectations is not scored for selection", () => {
  const quality = score({
    caseDefinition: defineCase({
      id: "read-balance",
      intent: "Report the account balance without changing it.",
      kind: "read",
      application: "payments",
      oracle: "database",
      expectations: {},
    }),
    events: trace([
      event("webmcp_call", {
        tool: "search_payment_users",
        input: { query: "Lia" },
        ok: true,
      }),
    ]),
  });
  assert.equal(quality.discovery.applicable, false);
  assert.equal(quality.selection.applicable, false);
  assert.equal(quality.arguments.applicable, true);
});

test("schema validation covers the keywords tool definitions use", () => {
  const schema = {
    type: "object",
    properties: {
      amount: { type: "number", minimum: 1, maximum: 100 },
      currency: { enum: ["usd", "eur"] },
      memo: { type: "string", maxLength: 4 },
      tags: { type: "array", items: { type: "string" }, minItems: 1 },
    },
    required: ["amount"],
  };
  assert.deepEqual(
    validateAgainstSchema(
      { amount: 5, currency: "usd", memo: "hi", tags: ["a"] },
      schema,
    ),
    [],
  );
  const problems = validateAgainstSchema(
    { currency: "gbp", memo: "too long", tags: [] },
    schema,
  );
  assert.ok(problems.length >= 4);
  assert.ok(
    problems.some((problem) => problem.includes('required property "amount"')),
  );
  assert.ok(
    problems.some((problem) => problem.includes('any of ["usd","eur"]')),
  );
});

test("unrecognized schema keywords never invent a violation", () => {
  assert.deepEqual(
    validateAgainstSchema(
      { query: "Lia" },
      { type: "object", "x-vendor-rule": "unsupported", $comment: "ignored" },
    ),
    [],
  );
  assert.deepEqual(validateAgainstSchema({ query: "Lia" }, true), []);
});

test("an argument the trace could not record is left unscored, not failed", () => {
  const quality = score({
    events: trace([
      event("webmcp_call", {
        tool: "send_payment",
        input: { truncated: true, serializedBytes: 32_768 },
        ok: true,
      }),
      event("webmcp_call", {
        tool: "search_payment_users",
        input: { query: "Lia" },
        ok: true,
      }),
    ]),
  });
  assert.equal(quality.arguments.evaluatedCalls, 1);
  assert.equal(quality.arguments.invalidCalls, 0);
  assert.equal(quality.selection.accurate, true);
});

test("an empty inventory records failed discovery and leaves selection unscored", () => {
  const quality = score({
    inventory: [],
    events: trace([
      event("webmcp_call", {
        tool: "search_payment_users",
        input: { query: "Lia" },
        ok: true,
      }),
      event("webmcp_call", { tool: "totally_invented", input: {}, ok: false }),
      event("webmcp_call", {
        tool: "send_payment",
        input: { recipientId: "u1", amountCents: 1200 },
        ok: true,
      }),
    ]),
  });
  assert.equal(quality.discovery.applicable, true);
  assert.equal(quality.discovery.complete, false);
  assert.deepEqual(quality.discovery.unavailableCapabilities, [
    "search_payment_users",
    "send_payment",
  ]);
  assert.equal(quality.selection.applicable, false);
  assert.equal(quality.selection.accurate, null);
  assert.match(quality.selection.reason, /did not expose/i);
});

test("standard schema combinators are evaluated", () => {
  assert.match(
    validateAgainstSchema("text", {
      oneOf: [{ type: "object" }, { type: "array" }],
    }).join("\n"),
    /exactly one subschema/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { defineCase, defineEvaluation, runTrial } from "../index.mjs";

function fixture(agentRun) {
  const caseDefinition = defineCase({
    id: "create-payment",
    intent: "Send five dollars to the intended recipient.",
    kind: "consequential",
    application: "fake-payments",
    oracle: "fake-database",
    expectations: { forbiddenEffects: ["duplicate-payment"] },
  });
  let payments = 0;
  const calls = [];
  const evaluation = defineEvaluation({
    suite: { id: "payments", cases: [caseDefinition] },
    conditions: [{ id: "signett", parameters: { bridge: true } }],
    adapters: {
      application: {
        id: "fake-payments",
        async reset() {
          payments = 0;
          calls.push("reset");
        },
        async entrypoint() {
          return "https://example.test";
        },
      },
      browser: {
        id: "fake-browser",
        async open() {
          calls.push("open");
          return { page: 1 };
        },
        async inventory() {
          return [
            {
              name: "create_payment",
              description: "Create it",
              inputSchema: {},
            },
          ];
        },
        async close() {
          calls.push("close");
        },
      },
      agent: {
        id: "fake-agent",
        provider: "test",
        model: "deterministic",
        async run({ emit }) {
          if (agentRun) return agentRun({ emit });
          emit("tool.called", { tool: "create_payment" });
          payments += 1;
          return { exitCode: 0, timedOut: false, usage: { actions: 1 } };
        },
      },
      oracle: {
        id: "fake-database",
        async snapshot() {
          return { payments };
        },
        async grade({ after }) {
          return {
            authoritativeSuccess: after.payments === 1,
            safeSuccess: after.payments === 1,
            forbiddenEffects: [],
          };
        },
      },
      faults: [],
    },
  });
  return { evaluation, caseDefinition, calls };
}

test("defineEvaluation validates adapter references", () => {
  const { evaluation } = fixture();
  assert.equal(evaluation.adapters.application.id, "fake-payments");
  assert.equal(Object.isFrozen(evaluation), true);
});

test("runTrial records lifecycle events and trusts the oracle", async () => {
  const { evaluation, caseDefinition, calls } = fixture();
  const evidence = await runTrial({
    caseDefinition,
    condition: evaluation.conditions[0],
    index: 1,
    adapters: evaluation.adapters,
  });
  assert.equal(evidence.oracle.grade.authoritativeSuccess, true);
  assert.equal(evidence.oracle.after.payments, 1);
  assert.equal(evidence.inventory[0].name, "create_payment");
  assert.deepEqual(calls, ["reset", "open", "close"]);
  assert.ok(evidence.events.some((event) => event.type === "oracle.graded"));
});

test("runTrial captures adapter failures as evidence", async () => {
  const { evaluation, caseDefinition } = fixture(async () => {
    const error = new Error("provider unavailable");
    error.category = "agent_provider";
    error.retryable = true;
    throw error;
  });
  const evidence = await runTrial({
    caseDefinition,
    condition: evaluation.conditions[0],
    index: 1,
    adapters: evaluation.adapters,
  });
  assert.equal(evidence.trial.status, "environment_error");
  assert.equal(evidence.failure.category, "agent_provider");
  assert.equal(evidence.failure.retryable, true);
});

test("runTrial normalizes custom adapter categories instead of losing evidence", async () => {
  const { evaluation, caseDefinition } = fixture(async () => {
    const error = new Error("third-party category");
    error.category = "vendor-specific";
    throw error;
  });
  const evidence = await runTrial({
    caseDefinition,
    condition: evaluation.conditions[0],
    index: 1,
    adapters: evaluation.adapters,
  });
  assert.equal(evidence.failure.category, "environment");
  assert.equal(evidence.failure.message, "third-party category");
});

test("runTrial scores the published interface alongside the oracle grade", async () => {
  const scoredCase = defineCase({
    id: "create-payment-scored",
    intent: "Send five dollars using the published payment tool.",
    kind: "consequential",
    application: "fake-payments",
    oracle: "fake-database",
    expectations: {
      requiredCapabilities: ["create_payment"],
      completionCapability: "create_payment",
    },
  });
  const { evaluation } = fixture(({ emit }) => {
    emit("webmcp_call", {
      tool: "create_payment",
      input: { amountCents: 500 },
      ok: true,
    });
    return { exitCode: 0, timedOut: false, usage: {} };
  });
  const evidence = await runTrial({
    caseDefinition: scoredCase,
    condition: evaluation.conditions[0],
    index: 1,
    adapters: evaluation.adapters,
  });
  assert.equal(evidence.quality.source, "events");
  assert.equal(evidence.quality.selection.accurate, true);
  assert.equal(evidence.quality.discovery.complete, true);
});

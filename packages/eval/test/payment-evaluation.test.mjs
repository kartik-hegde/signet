import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import paymentEvaluation from "../../../fixtures/cypress-realworld-app/eval/index.mjs";
import repairEvaluation from "../../../fixtures/cypress-realworld-app/eval/repair.mjs";

test("authenticated payments are expressed as portable Cases", () => {
  assert.deepEqual(
    paymentEvaluation.suite.cases.slice(0, 2).map(({ id }) => id),
    ["find-payment-recipient", "pay-lia-reference"],
  );
  assert.ok(
    paymentEvaluation.suite.cases.some(({ kind }) => kind === "recovery"),
  );
  assert.ok(
    paymentEvaluation.suite.cases.some(({ kind }) => kind === "negative"),
  );
});

test("payment conditions isolate runtime and information surface", () => {
  const guided = paymentEvaluation.conditions.find(
    ({ id }) => id === "signett-guided",
  );
  assert.equal(guided.parameters.runtime, "signett");
  assert.equal(guided.parameters.metadata, "guided");
  assert.equal(
    paymentEvaluation.adapters.faults[0].id,
    "lost-payment-response",
  );
});

test("agent repair benchmark holds tools constant and changes only runtime feedback", () => {
  assert.deepEqual(
    repairEvaluation.conditions.map(({ id }) => id),
    ["raw-webmcp", "signett-webmcp"],
  );
  assert.deepEqual(
    repairEvaluation.conditions.map(({ parameters }) => parameters.surface),
    ["webmcp", "webmcp"],
  );
  assert.deepEqual(
    repairEvaluation.conditions.map(({ parameters }) => parameters.metadata),
    ["baseline", "baseline"],
  );
  assert.deepEqual(
    repairEvaluation.suite.cases.map(
      ({ parameters }) => parameters.staleTargets,
    ),
    [
      ["source"],
      ["recipient"],
      ["quote"],
      ["compliance"],
      ["source", "recipient"],
      ["compliance", "quote"],
      [],
    ],
  );
  assert.ok(
    repairEvaluation.suite.cases.every(({ kind }) => kind === "recovery"),
  );
  assert.ok(
    repairEvaluation.suite.cases.every(
      ({ budgets, parameters }) =>
        budgets.maxToolCalls ===
        (parameters.mode === "outcome-reconciliation"
          ? 9
          : 8 + parameters.staleTargets.length * 3),
    ),
  );
  assert.ok(
    repairEvaluation.suite.cases.every(
      ({ intent }) => !intent.toLowerCase().includes("state may change"),
    ),
  );
  assert.ok(
    repairEvaluation.suite.cases.every(
      ({ parameters }) => parameters.expectedToolCount === 7,
    ),
  );
  assert.ok(
    repairEvaluation.suite.cases.every(({ intent, parameters }) =>
      intent.includes(`"${parameters.description}"`),
    ),
  );
  assert.equal(
    repairEvaluation.adapters.faults[0].id,
    "disrupt-payment-authorization",
  );
});

test("repair-only tools declare precise use-when boundaries", () => {
  const source = readFileSync(
    new URL(
      "../../../fixtures/cypress-realworld-app/src/webmcp/paymentTools.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /Repair payment_quote_stale/);
  assert.match(source, /Repair payment_compliance_stale/);
  assert.match(source, /Reconcile payment_outcome_unknown/);
});

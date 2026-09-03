import assert from "node:assert/strict";
import test from "node:test";

import paymentEvaluation from "../../../fixtures/cypress-realworld-app/eval/index.mjs";

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

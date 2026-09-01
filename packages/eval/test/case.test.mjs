import assert from "node:assert/strict";
import test from "node:test";

import { defineCase, defineSuite } from "../index.mjs";

const recipientCase = () =>
  defineCase({
    id: "find-recipient",
    intent: "Find the username for the recipient named Lia Rosenbaum.",
    kind: "read",
    application: "payments",
    oracle: "payment-database",
    parameters: { displayName: "Lia Rosenbaum" },
    expectations: {
      requiredCapabilities: ["search_payment_users"],
      completionCapability: "search_payment_users",
      forbiddenEffects: ["payment_created"],
    },
    budgets: { timeoutMs: 30_000, maxActions: 5 },
  });

test("defineCase supplies the version and freezes the artifact", () => {
  const value = recipientCase();
  assert.equal(value.schemaVersion, 1);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.expectations), true);
});

test("defineCase rejects ambiguous identifiers and invalid budgets", () => {
  assert.throws(
    () => defineCase({ ...recipientCase(), id: "Find Recipient" }),
    /lower-kebab-case/,
  );
  assert.throws(
    () => defineCase({ ...recipientCase(), budgets: { timeoutMs: 0 } }),
    /positive integer/,
  );
});

test("defineSuite keeps ordered, unique Cases", () => {
  const value = recipientCase();
  const suite = defineSuite({ id: "payments", cases: [value] });
  assert.deepEqual(
    suite.cases.map(({ id }) => id),
    ["find-recipient"],
  );
  assert.throws(
    () => defineSuite({ id: "payments", cases: [value, value] }),
    /Duplicate Case id/,
  );
});

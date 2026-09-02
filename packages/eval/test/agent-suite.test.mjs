import assert from "node:assert/strict";
import test from "node:test";

import { defineAgentTestSuite } from "../agent-suite.mjs";

test("defines a frozen, application-owned agent test suite", () => {
  const suite = defineAgentTestSuite({
    schemaVersion: 1,
    id: "example-suite",
    application: { id: "example-app", url: "https://example.test" },
    tasks: [
      {
        id: "inspect-state",
        prompt: "Inspect the current application state.",
        budgets: { maxSteps: 3, maxToolCalls: 2 },
        expectations: { requiredTools: ["inspect_state"] },
      },
    ],
  });

  assert.equal(Object.isFrozen(suite), true);
  assert.equal(Object.isFrozen(suite.tasks[0]), true);
});

test("rejects invalid task budgets and duplicate task ids", () => {
  const application = { id: "example-app", url: "https://example.test" };
  const task = {
    id: "inspect-state",
    prompt: "Inspect the application state.",
  };
  assert.throws(
    () =>
      defineAgentTestSuite({
        schemaVersion: 1,
        id: "bad-suite",
        application,
        tasks: [{ ...task, budgets: { maxToolCalls: 0 } }],
      }),
    /must be positive/,
  );
  assert.throws(
    () =>
      defineAgentTestSuite({
        schemaVersion: 1,
        id: "bad-suite",
        application,
        tasks: [{ ...task, expectations: { maxToolErrors: -1 } }],
      }),
    /non-negative integer/,
  );
  assert.throws(
    () =>
      defineAgentTestSuite({
        schemaVersion: 1,
        id: "bad-suite",
        application,
        tasks: [task, task],
      }),
    /Duplicate task/,
  );
});

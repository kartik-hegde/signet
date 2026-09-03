import assert from "node:assert/strict";
import test from "node:test";

import { createScriptedProvider } from "../scripted-provider.mjs";
import { wilson95 } from "../run.mjs";
import {
  applyAction,
  baselineState,
  startFixtureServer,
} from "../server.mjs";
import { tasks } from "../tasks.mjs";

test("fixture serves the renamed Signett SDK route", async () => {
  const fixture = await startFixtureServer();
  try {
    const response = await fetch(`${fixture.url}/signett/index.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /createSignett/);
  } finally {
    await fixture.close();
  }
});

test("every task has a deterministic smoke workflow", async () => {
  for (const task of tasks) {
    const complete = createScriptedProvider(task);
    const first = await complete();
    assert.equal(first.role, "assistant");
    assert.ok(first.tool_calls?.length, task.id);
  }
});

test("fixture enforces consequential invariants independently of Signett", () => {
  const state = baselineState();
  assert.throws(
    () => applyAction(state, "cancel_order", { orderId: "ord-200" }),
    /pending orders/,
  );
  assert.throws(
    () =>
      applyAction(state, "set_role", {
        memberId: "member-system",
        role: "viewer",
      }),
    /protected/,
  );
  assert.equal(state.orders["ord-200"].status, "shipped");
  assert.equal(state.members["member-system"].role, "admin");
});

test("lost-response action commits exactly one article", () => {
  const state = baselineState();
  const input = {
    title: "Database failover",
    body: "Promote the verified replica.",
    clientToken: "lost-db-failover",
  };
  const first = applyAction(state, "create_article", input);
  const second = applyAction(state, "create_article", input);
  assert.equal(first.id, second.id);
  assert.equal(
    Object.values(state.articles).filter(
      ({ clientToken }) => clientToken === input.clientToken,
    ).length,
    1,
  );
});

test("confidence intervals remain bounded for small repeated trials", () => {
  const none = wilson95(0, 5);
  const all = wilson95(5, 5);
  assert.equal(none.low, 0);
  assert.equal(all.high, 1);
  assert.ok(none.high > 0 && none.high < 1);
  assert.ok(all.low > 0 && all.low < 1);
});

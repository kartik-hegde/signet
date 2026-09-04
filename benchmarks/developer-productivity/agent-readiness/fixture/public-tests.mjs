import assert from "node:assert/strict";
import { cancellationInput, createPortal } from "./app.mjs";
import { makeAgentReady } from "./agent-interface.mjs";

function classify(tools) {
  const cancel = tools.find(
    ({ inputSchema }) => inputSchema?.properties?.requestId !== undefined,
  );
  const discovery = tools.find(({ name }) => name !== cancel?.name);
  return { cancel, discovery };
}

async function rejects(operation, message) {
  try {
    await operation();
    assert.fail(message);
  } catch (error) {
    if (error?.code === "ERR_ASSERTION") throw error;
  }
}

{
  const app = createPortal();
  const lifecycle = await makeAgentReady(app);
  const { cancel, discovery } = classify(app.tools());
  assert.ok(discovery, "expose an order discovery tool");
  assert.ok(cancel, "expose an order cancellation tool");
  assert.equal(typeof lifecycle?.dispose, "function");

  const found = await app.invoke(discovery.name, {});
  const orders = Array.isArray(found) ? found : found.orders;
  assert.deepEqual(
    orders.map(({ id }) => id),
    ["order-101", "order-102", "order-103"],
  );

  const cancelled = await app.invoke(cancel.name, cancellationInput());
  assert.equal(cancelled.status, "cancelled");
  assert.equal(app.effects.length, 1);
}

{
  const app = createPortal({
    session: { principalId: "acct-alice", scopes: ["orders:read"] },
  });
  await makeAgentReady(app);
  const { cancel } = classify(app.tools());
  await rejects(
    () => app.invoke(cancel.name, cancellationInput()),
    "a customer without cancellation scope must be denied",
  );
  assert.equal(app.effects.length, 0);
}

console.log("public journey checks passed");

import assert from "node:assert/strict";
import { createFixture, validInput } from "./app.mjs";
import { registerCancelOrder } from "./solution.mjs";

async function rejects(operation, message) {
  try {
    await operation();
    assert.fail(message);
  } catch (error) {
    if (error?.code === "ERR_ASSERTION") throw error;
  }
}

{
  const fixture = createFixture();
  await registerCancelOrder(fixture);
  assert.equal(fixture.registered()?.tool.name, "cancel_order");
  assert.ok(fixture.registered()?.tool.description);
  assert.ok(fixture.registered()?.tool.inputSchema);
  const result = await fixture.invoke(validInput());
  assert.equal(result.status, "cancelled");
  assert.equal(fixture.effects.length, 1);
}

{
  const fixture = createFixture();
  await registerCancelOrder(fixture);
  await rejects(
    () => fixture.invoke(validInput({ reason: "anything" })),
    "invalid input must reject",
  );
  assert.equal(fixture.effects.length, 0);
}

{
  const fixture = createFixture({
    session: { principalId: "acct-customer", scopes: [] },
  });
  await registerCancelOrder(fixture);
  await rejects(
    () => fixture.invoke(validInput()),
    "unauthorized input must reject",
  );
  assert.equal(fixture.effects.length, 0);
}

console.log("public checks passed");

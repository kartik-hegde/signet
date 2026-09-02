import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { runAgent } from "../agent-core.mjs";
import { createDemoServer } from "../demo/server.mjs";
import { createChatCompletionsProvider } from "../provider.mjs";

let server;
let baseUrl;

before(async () => {
  server = createDemoServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("serves the credential-free WebMCP demo", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /WebMCP test page/);
});

test("drives the deterministic two-tool demo sequence", async () => {
  const first = await complete([]);
  assert.equal(first.tool_calls[0].function.name, "inspect_cart");

  const second = await complete([{ role: "tool", content: "{}" }]);
  assert.equal(second.tool_calls[0].function.name, "add_cart_item");
  assert.deepEqual(JSON.parse(second.tool_calls[0].function.arguments), {
    sku: "notebook",
    quantity: 2,
  });

  const final = await complete([
    { role: "tool", content: "{}" },
    { role: "tool", content: "{}" },
  ]);
  assert.match(final.content, /\$24\.00/);
});

test("completes the packaged agent loop against the demo provider", async () => {
  const cart = [];
  const result = await runAgent({
    prompt: "Add two notebooks to my cart and tell me the total.",
    tools: [
      {
        name: "inspect_cart",
        description: "Inspect the cart.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "add_cart_item",
        description: "Add a cart item.",
        inputSchema: {
          type: "object",
          properties: {
            sku: { type: "string" },
            quantity: { type: "integer" },
          },
          required: ["sku", "quantity"],
        },
      },
    ],
    complete: createChatCompletionsProvider({
      endpoint: `${baseUrl}/v1/chat/completions`,
      model: "signet-demo",
    }),
    invoke: async ({ name, arguments: input }) => {
      if (name === "inspect_cart") return { items: cart, total: 0 };
      cart.push({ sku: input.sku, quantity: input.quantity });
      return { items: cart, total: input.quantity * 12, currency: "USD" };
    },
  });

  assert.deepEqual(
    result.calls.map((call) => call.name),
    ["inspect_cart", "add_cart_item"],
  );
  assert.deepEqual(cart, [{ sku: "notebook", quantity: 2 }]);
  assert.match(result.answer, /\$24\.00/);
});

test("returns bounded errors for malformed provider requests", async () => {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error.message, /JSON/);
});

async function complete(toolMessages) {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: toolMessages }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).choices[0].message;
}

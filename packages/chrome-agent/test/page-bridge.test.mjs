import assert from "node:assert/strict";
import test from "node:test";

import {
  abortWebMcpTool,
  executeWebMcpTool,
  inspectWebMcpPage,
} from "../page-bridge.mjs";

test("discovers serializable tool metadata from the page", async () => {
  installPage({
    getTools: async () => [
      {
        name: "inspect_cart",
        title: "Inspect cart",
        description: "Return the cart.",
        inputSchema: '{"type":"object","properties":{}}',
        annotations: { readOnlyHint: true },
        origin: "https://shop.example",
      },
    ],
  });

  const page = await inspectWebMcpPage();

  assert.equal(page.supported, true);
  assert.equal(page.tools[0].name, "inspect_cart");
  assert.deepEqual(page.tools[0].inputSchema, {
    type: "object",
    properties: {},
  });
  assert.equal(page.tools[0].annotations.readOnlyHint, true);
});

test("invokes the currently exposed tool", async () => {
  const tool = { name: "inspect_cart" };
  installPage({
    getTools: async () => [tool],
    executeTool: async (selected, input) => {
      assert.equal(selected, tool);
      assert.deepEqual(JSON.parse(input), {});
      return { items: [] };
    },
  });

  const result = await executeWebMcpTool("inspect_cart", {}, "call_1", 500);

  assert.deepEqual(result, { ok: true, value: { items: [] } });
});

test("does not retry a failed execution with a second input transport", async () => {
  const tool = { name: "inspect_cart" };
  let invocations = 0;
  installPage({
    getTools: async () => [tool],
    executeTool: async () => {
      invocations += 1;
      throw new Error("Outcome is unknown.");
    },
  });

  const result = await executeWebMcpTool(
    "inspect_cart",
    { store: "nyc" },
    "call_native",
    500,
  );

  assert.equal(result.ok, false);
  assert.equal(invocations, 1);
});

test("aborts an active page call", async () => {
  const tool = { name: "slow_tool" };
  installPage({
    getTools: async () => [tool],
    executeTool: async (_selected, _input, options) =>
      await new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        );
      }),
  });

  const pending = executeWebMcpTool("slow_tool", {}, "call_slow", 5_000);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(abortWebMcpTool("call_slow"), true);
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.error.name, "AbortError");
  assert.match(result.error.message, /Stopped by the user/);
});

function installPage(modelContext) {
  globalThis.document = { title: "Test page", modelContext };
  globalThis.location = {
    href: "https://shop.example/cart",
    origin: "https://shop.example",
  };
  globalThis.window = {};
}

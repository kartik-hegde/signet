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
      assert.deepEqual(input, {});
      return '{"items":[]}';
    },
  });

  const result = await executeWebMcpTool("inspect_cart", {}, "call_1", 500);

  assert.deepEqual(result, { ok: true, value: '{"items":[]}' });
});

test("uses structured arguments with the current WebMCP API", async () => {
  const tool = { name: "add_cart_item" };
  installPage({
    getTools: async () => [tool],
    executeTool: async (_selected, input) => JSON.stringify(input),
  });

  const result = await executeWebMcpTool(
    "add_cart_item",
    { sku: "notebook", quantity: 2 },
    "call_2",
    500,
  );

  assert.equal(result.value, '{"sku":"notebook","quantity":2}');
});

test("falls back to serialized arguments for older Chrome previews", async () => {
  const tool = { name: "add_cart_item" };
  installPage({
    getTools: async () => [tool],
    executeTool: async (_selected, input) => {
      if (typeof input !== "string") throw new Error("Failed to parse input");
      return input;
    },
  });

  const result = await executeWebMcpTool(
    "add_cart_item",
    { sku: "notebook", quantity: 2 },
    "call_legacy",
    500,
  );

  assert.equal(result.value, '{"sku":"notebook","quantity":2}');
});

test("discovers tools from the older navigator API location", async () => {
  installPage(
    {
      getTools: async () => [
        {
          name: "legacy_search",
          description: "Search this site.",
          input_schema: '{"type":"object"}',
        },
      ],
    },
    { navigatorOnly: true },
  );

  const page = await inspectWebMcpPage();

  assert.equal(page.supported, true);
  assert.equal(page.tools[0].name, "legacy_search");
  assert.deepEqual(page.tools[0].inputSchema, { type: "object" });
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

function installPage(modelContext, { navigatorOnly = false } = {}) {
  globalThis.document = {
    title: "Test page",
    modelContext: navigatorOnly ? undefined : modelContext,
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { modelContext: navigatorOnly ? modelContext : undefined },
  });
  globalThis.location = {
    href: "https://shop.example/cart",
    origin: "https://shop.example",
  };
  globalThis.window = {};
}

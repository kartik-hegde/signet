# Getting started

Signet exposes existing application functions to agents through native WebMCP. Start
with four fields, then add production controls only where the operation needs them.

## Install

```sh
npm install @signet/webmcp
```

Your application needs WebMCP declarations during development:

```sh
npm install --save-dev webmcp-types
```

## Expose a tool

```ts
import { createSignet } from "@signet/webmcp";

const signet = createSignet();

const registration = await signet.expose({
  name: "search_products",
  description: "Find products matching a query and return stable product IDs.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 1,
        description: "Words from the product name.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: async ({ query }: { query: string }, { signal }) => {
    const response = await fetch(
      `/api/products?q=${encodeURIComponent(query)}`,
      { signal },
    );
    if (!response.ok) throw new Error(`Search failed: ${response.status}`);
    return response.json();
  },
});
```

Signet validates the definition, compiles the input schema once, and registers the tool
through `document.modelContext.registerTool()`. Invalid input never reaches your
application function.

When the tool should disappear—for example on logout, navigation, or component
teardown—dispose it:

```ts
registration.dispose();
```

On browsers without WebMCP, the human website continues normally and the registration
has status `unsupported`. Use `createSignet({ unsupported: "throw" })` in tests when
missing WebMCP should fail.

The [WebMCP draft](https://webmachinelearning.github.io/webmcp/) creates
`document.modelContext` with the document. Register tools when
their application logic is ready; an agent that connects later sees the document's
current tools. If an extension or polyfill supplies a non-native bridge after startup,
wait for that bridge and pass it explicitly with `createSignet({ modelContext })`.
Signet does not poll the page or pretend an unavailable protocol is ready.

## Add application context

Resolve trusted identity and resource context from your application, never from agent
arguments:

```ts
const signet = createSignet({
  context: async ({ signal }) => {
    const session = await currentSession({ signal });
    return { userId: session.user.id };
  },
});
```

The resolved context is available to execution and policy hooks.

## Add controls to a consequential tool

```ts
import { ToolError, createSignet } from "@signet/webmcp";

const signet = createSignet({
  context: async ({ signal }) => currentSession({ signal }),
  observe: recordSignetEvent,
});

await signet.expose({
  name: "cancel_order",
  description: "Cancel one unshipped order belonging to the signed-in user.",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string", minLength: 1 } },
    required: ["orderId"],
    additionalProperties: false,
  },
  // Authorization runs before replay. Mutable order eligibility belongs in execute.
  authorize: ({ context }) => context.scopes.includes("orders:cancel"),
  idempotency: {
    store: productionIdempotencyStore,
    key: ({ input, context }) => `${context.userId}:${input.orderId}:cancel`,
  },
  execute: async ({ orderId }, { context, signal }) => {
    const order = await getOrder(orderId);
    if (order?.status === "shipped") {
      throw new ToolError({
        code: "order_already_shipped",
        message: "Shipped orders cannot be cancelled.",
        retryable: false,
      });
    }
    return cancelOrder({ orderId, userId: context.userId, signal });
  },
  verify: async ({ input, context }) => {
    const order = await getOrder(input.orderId);
    return order?.userId === context.userId && order.status === "cancelled";
  },
});
```

The application still owns authentication, authorization, durable idempotency,
business logic, and authoritative state. Signet coordinates and observes those checks
at the agent boundary.

Signet re-evaluates authorization before every replay. Keep current access policy in
`authorize`, but put mutable conditions that success changes inside `execute` so they
do not reject the stored result of a valid repeat.

## Test without a model or browser

```ts
import { createSignet } from "@signet/webmcp";
import { createWebMcpTestHarness } from "@signet/webmcp/testing";

const harness = createWebMcpTestHarness();
const signet = createSignet({ modelContext: harness.modelContext });

await signet.expose({
  name: "search_products",
  description: "Find products matching a query.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", minLength: 1 } },
    required: ["query"],
    additionalProperties: false,
  },
  execute: ({ query }: { query: string }) => searchProducts(query),
});

expect(harness.tools().map((tool) => tool.name)).toEqual(["search_products"]);
await expect(
  harness.invoke("search_products", { query: "boots" }),
).resolves.toEqual(expectedProducts);
```

This deterministic lane verifies registration, validation, execution, cancellation,
and disposal. Before shipping, also exercise representative tasks through a supported
native WebMCP browser agent.

Continue with [Production WebMCP](./production-webmcp), [Testing](./testing), and the
[interface API](../reference/interface).

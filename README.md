# Signet

Signet helps web products expose their capabilities as tools that AI agents can use.
It starts with WebMCP: define a clear tool around application code you already own,
make it available through the browser, and test the experience an agent actually sees.

```ts
const searchProducts: WebMCP.ToolExecuteCallback = async (
  input,
  { signal },
) => {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) throw new TypeError("query must be a non-empty string");

  const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`, {
    signal,
  });
  if (!response.ok) throw new Error(`Search failed: ${response.status}`);
  return response.json();
};

await document.modelContext?.registerTool({
  name: "search_products",
  title: "Search products",
  description:
    "Finds products matching a query and returns stable product IDs.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", minLength: 1 } },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: searchProducts,
});
```

That native registration is the foundation, not something Signet replaces. The Signet
toolkit is being built around the rest of the developer loop: tool definition and
runtime validation, lifecycle-aware exposure, local inspection and invocation,
contract tests, and agent-use evaluation.

## Direction and current status

Signet is pre-release. Today the repository contains the optional execution-control
layer and a complete native WebMCP reference integration. The next implementation
milestones add the authoring, exposure, and developer-tooling path described above.

The intended progression is:

1. Turn an existing function or endpoint into a well-described, validated tool.
2. Expose it through native WebMCP for the right page, user, and application state.
3. Inspect exactly what an agent sees and invoke it locally.
4. Test discovery, lifecycle, arguments, results, and authoritative outcomes.
5. Add production controls only when the tool's consequences require them.

WebMCP is the first vehicle. Signet does not patch unsupported browsers, invent a
discovery protocol, or require application logic to move into a hosted runtime.

## Production controls when needed

For an authenticated read or consequential mutation, the current `guard()` API adds
application-owned authorization, durable idempotency, outcome verification,
cancellation propagation, and opt-in observation to an ordinary handler:

```ts
import { guard } from "@signet/webmcp";

const cancelOrder = guard(cancelOrderHandler, {
  name: "cancel_order",
  context: () => currentSession(),
  authorize: ({ input, context }) => context.userId === ownerOf(input.orderId),
  idempotency: {
    key: ({ input, context }) => `${context.userId}:${input.orderId}:cancel`,
    store: durableStore,
  },
  verify: ({ output }) => output.state === "cancelled",
});
```

Use the guarded handler as the native tool's `execute` callback. Public reads and
simple low-risk tools do not need this layer.

`MemoryIdempotencyStore` is available from `@signet/webmcp/testing` for tests and
demos. It is not durable and must not be treated as a production guarantee. The
optional `@signet/webmcp/opentelemetry` entry point converts lifecycle events into
spans without configuring an exporter or collecting inputs and outputs.

## Product principles

- **Native-first:** WebMCP names, descriptions, JSON Schemas, annotations, origins,
  and signals stay visible.
- **Application-owned:** your functions, identity, policy, data, and backend remain the
  source of truth.
- **Useful before consequential:** lookup and read tools should be easy; production
  middleware is progressive enhancement.
- **Agent-tested:** success means an agent discovers the right tool, calls it with valid
  arguments, and reaches the expected application outcome.
- **No fake compatibility:** test drivers are labeled as such and native compatibility
  is tested separately.
- **Ejectable:** Signet should leave understandable application code behind.

See [the current native example](./examples/native-webmcp.ts), the
[reference application](./examples/cypress-realworld-app/SIGNET.md), and the
[design contract](./docs/design.md).

## Development

```sh
npm install
npm run validate
```

`validate` runs linting, formatting checks, strict type checking, the coverage-gated
test suite, a production build, package validation, and public-export smoke tests.

Signet is experimental because WebMCP itself is evolving. The public surface will stay
small until real integrations justify each abstraction.

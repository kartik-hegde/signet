# Core concepts

Signet has one small registration API and a set of optional execution controls. The
application still owns its business functions, identity, policy, data, and backend.

| Abstraction        | What it represents                                                           |
| ------------------ | ---------------------------------------------------------------------------- |
| Signet interface   | One WebMCP-facing surface and its shared application context                 |
| Tool definition    | One bounded capability an agent can discover and invoke                      |
| Registration       | The lifetime of that capability in the current document                      |
| Execution controls | Application-owned authorization, consent, replay, recovery, and verification |
| Test harness       | A deterministic WebMCP boundary for tests without a model or browser         |

Start with the first three. Add execution controls only when the operation needs them.

## The Signet interface

`createSignet()` creates an interface between one application surface and native
WebMCP. It can also resolve trusted context and receive lifecycle events shared by the
tools on that surface.

```ts
import { createSignet } from "@signet/webmcp";

const signet = createSignet({
  context: ({ signal }) => currentSession({ signal }),
  observe: (event) => recordLifecycleEvent(event),
  unsupported: "warn",
});
```

Create the interface in browser code. In a component framework, keep it stable across
renders rather than creating a new interface every time the component renders.

The options are deliberately narrow:

- `context` reads current application-owned state once per invocation;
- `observe` receives privacy-safe lifecycle metadata;
- `unsupported` controls missing-WebMCP behavior;
- `modelContext` injects a WebMCP boundary for tests or an explicit bridge.

## Tool definitions

A tool describes one user intent. It combines agent-facing metadata with the existing
application function that fulfills that intent.

```ts
const searchProductsTool = {
  name: "search_products",
  description:
    "Find products matching one query and return stable product IDs.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "Words from the product name.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: (
    { query }: { query: string },
    { signal }: { signal: AbortSignal },
  ) => searchProducts(query, { signal }),
};

await signet.expose(searchProductsTool);
```

Use lower-snake-case `verb_noun` names, closed object schemas, bounded strings and
arrays, and small structured results. Signet compiles the schema once and rejects
invalid invocation input before application code runs.

`annotations` maps to native WebMCP metadata. Mark reads with
`{ readOnlyHint: true }`; there is no top-level `readOnly` option.

## Trusted context

Agent arguments are untrusted. Identity, tenant, active resource, and permissions
should come from application state instead of the input schema.

```ts
type Session = {
  userId: string;
  accountId: string;
  scopes: string[];
};

const signet = createSignet<Session>({
  context: ({ signal }) => currentSession({ signal }),
});
```

Every tool on this interface can then use `context`:

```ts
execute: ({ orderId }, { context, signal }) =>
  getOrder(orderId, { accountId: context.accountId, signal });
```

Context improves the browser boundary, but the backend must still authenticate and
authorize every request.

## Authorization

`authorize` decides whether the current principal may attempt the exact invocation.
It runs before execution and before every idempotency lookup, including replay.

```ts
authorize: ({ context }) => ({
  allowed: context.scopes.includes("orders:cancel"),
  reason: "The signed-in account cannot cancel orders.",
});
```

Keep current identity, tenant, permission, and resource access here. Put a mutable
condition changed by success—such as `order.status === "open"`—inside `execute`.
Otherwise a valid retry can be denied before its stored result is replayed.

## Confirmation

Signet does not render confirmation UI. A tool calls the application's existing review
or consent experience and returns the person's decision.

```ts
confirm: ({ input }) => confirmCancellation(input.orderId);
```

A plain function confirms every invocation. For an idempotent effect, use
`effect-only` confirmation so a completed replay does not ask again:

```ts
confirm: {
  mode: "effect-only",
  request: ({ input }) => confirmCancellation(input.orderId),
},
```

Use `effect-only` together with idempotency and an operation journal.

## Idempotency

Agents and networks retry. `idempotency` gives Signet an application-chosen operation
key and a store that atomically coordinates equal keys.

```ts
import { IndexedDbIdempotencyStore } from "@signet/webmcp/stores";

const idempotencyStore = new IndexedDbIdempotencyStore();

// Inside a tool definition:
idempotency: {
  store: idempotencyStore,
  key: ({ input, context }) =>
    [
      context.accountId,
      input.operationId,
      input.orderId,
      "cancel_order",
    ].join(":"),
},
```

Include the principal, a stable operation ID, and every argument that changes intent.
Equal keys converge on one effect; different keys remain concurrent.

The browser adapter coordinates one browser profile. The backend must still enforce
durable duplicate suppression for requests that can arrive from other browsers,
devices, or clients.

## Operation journals and recovery

Signet requires an operation journal whenever idempotency is configured. The
idempotency store remembers completed output; the journal stores the small correlation
needed to determine what happened when a response is lost.

```ts
import { WebStorageOperationJournal } from "@signet/webmcp";

const operationJournal = new WebStorageOperationJournal(
  sessionStorage,
  "signet:operation:",
);

// Inside the same tool definition:
journal: { store: operationJournal },

execute: async ({ orderId }, { context, operation, signal }) => {
  await operation?.write({ orderId });
  return cancelOrder({ orderId, accountId: context.accountId, signal });
},

recover: async ({ input, context, operation, signal }) => {
  const correlation = await operation?.read<{ orderId: string }>();
  if (!correlation) return { recovered: false };
  if (correlation.orderId !== input.orderId) {
    return { recovered: false, outcome: "unknown" };
  }

  const order = await getOrder(input.orderId, { signal });
  return order?.accountId === context.accountId &&
    order.status === "cancelled"
    ? { recovered: true, output: order }
    : { recovered: false, outcome: "unknown" };
},
```

Write non-secret correlation immediately before crossing the effect boundary.
Recovery may report success only after reading authoritative state. When neither
success nor non-execution can be proven, return `outcome: "unknown"`; Signet never
blindly retries the effect.

## Verification

`verify` checks the requested postcondition after fresh execution, replay, or recovery.
It should read authoritative state rather than merely inspect the handler's response.

```ts
verify: async ({ input, context, signal }) => {
  const order = await getOrder(input.orderId, { signal });
  return (
    order?.accountId === context.accountId &&
    order.status === "cancelled"
  );
},
verifyTimeoutMs: 10_000,
```

A false decision raises `VerificationError`. Verification detects false success; it
does not roll back an effect that already happened.

Use `outputBudgetBytes` when a tool should return a task-focused projection rather
than a large application object:

```ts
outputBudgetBytes: 2_048,
```

The budget emits a diagnostic without changing the outcome of completed work.

## Registration and lifecycle

`expose()` returns a registration with `name`, `status`, and an idempotent `dispose()`.

```ts
const registration = await signet.expose(searchProductsTool);

// Logout, navigation, or component teardown:
registration.dispose();
```

This keeps discovery aligned with visible application state. A checkout tool should
not remain callable after leaving checkout or signing out.

React applications can bind registration to a component:

```ts
import { useSignetTool } from "@signet/webmcp/react";

const registrationState = useSignetTool(signet, searchProductsTool, [
  searchProductsTool,
]);
```

The binding handles asynchronous registration and StrictMode teardown.

## Observation

An observer receives stages and timings, not tool input, output, context, or stack
traces.

```ts
const signet = createSignet({
  observe: ({ name, stage, durationMs }) => {
    metrics.record("signet.lifecycle", durationMs, { name, stage });
  },
});
```

Observer failure never changes registration or application behavior. Use the optional
OpenTelemetry adapter when lifecycle events should become spans.

## Readiness and deterministic testing

`assertToolReady()` catches common agent-usability mistakes, while the harness proves
the real registration and execution contract:

```ts
import { assertToolReady, createSignet } from "@signet/webmcp";
import { createWebMcpTestHarness } from "@signet/webmcp/testing";

assertToolReady(searchProductsTool);

const harness = createWebMcpTestHarness();
const testSignet = createSignet({ modelContext: harness.modelContext });
const registration = await testSignet.expose(searchProductsTool);

expect(harness.tools().map(({ name }) => name)).toContain("search_products");
await expect(
  harness.invoke("search_products", { query: "boots" }),
).resolves.toEqual(expectedProducts);

registration.dispose();
expect(harness.tools()).toHaveLength(0);
```

For consequential tools, also prove authorization denial, equal-key concurrency,
replay, ambiguous recovery, verification, cancellation, and cleanup. Finish with a
representative task through a supported native browser agent.

Next, see these abstractions working together in the
[authenticated payment codelab](./real-browser-example), or continue to
[production WebMCP](./production-webmcp).

# Signett

**Make your website agent-ready—in minutes.**

Signett turns application functions you already own into production-ready tools that
browser agents can discover and use through native WebMCP.

You decide what agents should be able to do. Signett handles the boundary around those
capabilities: registration, input validation, application context, expected errors,
safe execution, testing, and observability.

## Get started

```sh
npm install signett
```

Expose one function from browser code:

```ts
import { createSignett } from "signett";

const signett = createSignett();

const registration = await signett.expose({
  name: "get_greeting",
  description: "Return a greeting from this website.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: () => ({ message: "Hello, world!" }),
});
```

Four fields are required: `name`, `description`, `inputSchema`, and `execute`.

Signett validates the definition, compiles its JSON Schema once, and registers it with
`document.modelContext.registerTool()`. Invalid agent input never reaches your
business logic. In browsers without WebMCP, your human website continues normally and
the registration reports `unsupported`.

Dispose the registration when the capability is no longer available:

```ts
registration.dispose();
```

See the complete [getting-started guide](./docs/guide/getting-started.md), then learn
how [Signett's core abstractions](./docs/guide/core-concepts.md) map to application code.
For a runnable React page, Chrome inspection, and a first model-driven call, use the
[first agent call codelab](./docs/tutorials/first-agent-call.md).

## Integrate with a coding agent

Give a coding agent [`AGENTS.md`](./AGENTS.md), the complete public contract. It should
not need to inspect Signett's compiled implementation.

For Codex, install the bundled project skill once:

```sh
mkdir -p .agents/skills
cp -R node_modules/signett/skills/signett-webmcp .agents/skills/
```

Then ask it to use `$signett-webmcp` when exposing or reviewing website tools.

## Add production behavior when needed

Simple read tools can stay simple. Consequential tools can opt into application
context, authorization, idempotency, verification, cancellation, and observation:

```ts
import { ToolError, createSignett } from "signett";

const signett = createSignett({
  context: async ({ signal }) => currentSession({ signal }),
  observe: recordSignettEvent,
});

await signett.expose({
  name: "cancel_order",
  description: "Cancel one unshipped order belonging to the signed-in user.",
  inputSchema: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "Stable identifier of the order to cancel.",
        minLength: 1,
        maxLength: 128,
      },
    },
    required: ["orderId"],
    additionalProperties: false,
  },

  // This runs on every call, including replay. Check current permission here;
  // keep mutable order eligibility inside execute.
  authorize: ({ context }) => context.scopes.includes("orders:cancel"),

  // Prompt only when a new effect will run. Exact replays remain authorized but
  // return their durable result without asking the user to approve it again.
  confirm: {
    mode: "effect-only",
    request: ({ input }) => confirmCancellation(input.orderId),
  },

  idempotency: {
    store: productionIdempotencyStore,
    key: ({ input, context }) => `${context.userId}:${input.orderId}:cancel`,
  },

  // Reuse the idempotency key for a small, durable correlation record.
  journal: { store: productionOperationJournal },

  execute: async ({ orderId }, { context, operation, signal }) => {
    const order = await getOrder(orderId);

    if (order?.status === "shipped") {
      throw new ToolError({
        code: "order_already_shipped",
        message: "Shipped orders cannot be cancelled.",
        retry: "never",
      });
    }

    await operation?.write({ orderId });
    const cancelled = await cancelOrder({
      orderId,
      userId: context.userId,
      signal,
    });
    return cancelled;
  },

  recover: async ({ input, context, operation }) => {
    const correlation = await operation?.read<{ orderId: string }>();
    if (!correlation) return { recovered: false };
    const order = await getOrder(input.orderId);
    if (order?.userId === context.userId && order.status === "cancelled") {
      return correlation.orderId === order.id
        ? { recovered: true, output: order }
        : {
            recovered: false,
            outcome: "unknown",
            reason:
              "The order is cancelled but its operation record is missing.",
          };
    }
    return { recovered: false };
  },

  // Warn when a response is too broad for the intended agent task.
  outputBudgetBytes: 20_000,

  verify: async ({ input, context }) => {
    const order = await getOrder(input.orderId);
    return order?.userId === context.userId && order.status === "cancelled";
  },
});
```

The application still owns authentication, permissions, business logic, durable
idempotency, and authoritative state. Signett is state-aware; it is not an application
state store or agent orchestrator.

Signett never retries operations automatically.

Authorization is re-evaluated before every idempotency lookup, including replay. Keep
current identity, permission, tenant, and resource access in `authorize`. Put mutable
eligibility that success changes—for example, whether an order is still open—inside
`execute`, so a valid repeat can return its stored result.

`recover` is for ambiguous failures such as a response lost after commit. It may report
success only after reading authoritative application state. Recovered results still run
through `verify` and, when idempotency is configured, become the stored result for later
replays. Return `outcome: "unknown"` when the effect may have happened but authoritative
reconciliation cannot prove either result; Signett raises `OutcomeUnknownError` and tells
the caller not to retry under a new key.

## Test without a model or browser

```ts
import { createSignett } from "signett";
import { createWebMcpTestHarness } from "signett/testing";

const harness = createWebMcpTestHarness();
const signett = createSignett({ modelContext: harness.modelContext });

await signett.expose({
  name: "search_products",
  description: "Find products matching a query.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Words from the product name.",
        minLength: 1,
        maxLength: 80,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: ({ query }: { query: string }) => searchProducts(query),
});

expect(harness.tools().map((tool) => tool.name)).toEqual(["search_products"]);

await expect(
  harness.invoke("search_products", { query: "boots" }),
).resolves.toEqual(expectedProducts);
```

The capture-only test boundary supports discovery, invocation, cancellation, and
unregistration. It is not a production WebMCP polyfill. Test representative workflows
through a supported native browser agent before shipping.

Run static readiness checks in the same test:

```ts
import { assertToolReady } from "signett";

expect(() => assertToolReady(searchProductsTool)).not.toThrow();
```

For a component-owned capability, use the lifecycle binding for your framework:

```ts
import { useSignettTool } from "signett/react";

const state = useSignettTool(signett, searchProductsTool, [shopId]);
```

The React entry point handles teardown while asynchronous registration is still in
flight. When agent-triggered work should be visible in the application's existing UI,
subscribe to its metadata-only activity state:

```tsx
import { useSignettActivity } from "signett/react";

const { latest } = useSignettActivity(signett, { toolName: "place_order" });

if (latest?.phase === "succeeded" && latest.verified) {
  // Refresh authoritative application state; do not fabricate success in the DOM.
}
```

The hook reports stable presentation phases, not inputs, outputs, authorization, or
business state. Signett does not render or mutate the DOM. Framework-neutral code can
use `createSignettActivity(signett)` and subscribe to the same projection. See
[the application activity guide](../../docs/guide/application-activity.md) for a
complete React and framework-neutral integration.

During development, `mountSignettInspector(signett)` from
`signett/inspector` shows exact schemas, annotations, registration state, and
a privacy-safe per-call latency waterfall. To export the same spans to Jaeger or any
OTLP backend, add `telemetry: { otlp: "/v1/traces", serviceName: "storefront" }`
to `createSignett`.

## What Signett provides

- **Code-first exposure:** readable TypeScript that maps directly to native WebMCP.
- **Runtime validation:** JSON Schema validation before application code runs.
- **State-aware lifecycle:** per-call application context and disposable registrations.
- **Framework lifecycle:** a StrictMode-safe React binding.
- **Application activity:** optional metadata-only state for rendering agent-call
  progress in an application's existing interface.
- **Expected failures:** `ToolError` carries retry conditions, ordered repair plans,
  and input invariants; validation, authorization, and verification errors remain
  distinguishable from system faults.
- **Reliable mutations:** app-provided idempotency plus authoritative postcondition
  recovery and verification.
- **Cancellation:** the native execution signal reaches every stage and your handler.
- **Observability:** privacy-safe lifecycle events and optional OpenTelemetry spans.
- **Readiness tooling:** static agent-usability diagnostics and a local Inspector.
- **Output discipline:** optional byte budgets for task-focused results.
- **Deterministic testing:** inspect and invoke tools without a model or browser.
- **Agent evaluation:** saved-task scoring for selection, arguments, and outcomes.
- **Reference proof:** a signed-in payment application with real mutations, denials,
  replay protection, verification, human-UI parity, native Chrome coverage, and a live
  Inspector.

## Principles

- WebMCP is the first protocol; Signett does not hide or replace it.
- Application code, identity, policy, data, and backend enforcement remain yours.
- Inputs, outputs, context, and stack traces are not observed by default.
- Observer failures never change registration or execution behavior.
- Unsupported browsers retain the human experience.
- Public abstractions must add validation, lifecycle, reliability, testing, or
  observation—not merely rename native APIs.
- A second protocol will justify a public adapter abstraction; anticipation alone will
  not.

## Current scope

Signett is pre-release and WebMCP is experimental. The current package includes:

- `createSignett().expose()`;
- JSON Schema definition and invocation validation;
- application context and disposable native registration;
- agent-legible errors, confirmation, authorization, idempotency, recovery,
  verification, output limits, cancellation, and lifecycle observation;
- deterministic testing, store conformance, readiness, and agent-task evaluation;
- React lifecycle and activity bindings plus a local Inspector;
- optional OpenTelemetry mapping;
- standalone and full-stack reference applications.

There is no hosted runtime, agent planner, automatic retry policy, production browser
polyfill, Signett JSON format, or compiler.

## Explore

- [Getting started](./docs/guide/getting-started.md)
- [Core concepts](./docs/guide/core-concepts.md)
- [Tutorials](./docs/tutorials/index.md)
- [Authenticated payment codelab](./docs/guide/real-browser-example.md)
- [Cal.diy booking codelab](./docs/tutorials/cal-diy.md)
- [Patterns from real integrations](./docs/guide/integration-patterns.md)
- [Interface API](./docs/reference/interface.md)
- [Production WebMCP](./docs/guide/production-webmcp.md)
- [Testing](./docs/guide/testing.md)
- [Reference payment application](../../fixtures/cypress-realworld-app/SIGNETT.md)
- [Design contract](./docs/design.md)

## Development

```sh
npm install
npm run validate
```

`validate` runs linting, formatting checks, strict type checking, coverage-gated
tests, a production build, package validation, and public-export smoke tests.

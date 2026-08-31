# Signet

**Make your website agent-ready—in minutes.**

Signet turns application functions you already own into production-ready tools that
browser agents can discover and use through native WebMCP.

Using a coding agent? Give it [`AGENTS.md`](./AGENTS.md), the complete public contract.
It should not need to inspect Signet's compiled implementation.

For Codex, install the bundled project skill once:

```sh
mkdir -p .agents/skills
cp -R node_modules/@signet/webmcp/skills/signet-webmcp .agents/skills/
```

Then ask it to use `$signet-webmcp` when exposing or reviewing website tools.

You decide what agents should be able to do. Signet handles the boundary around those
capabilities: registration, input validation, application context, expected errors,
safe execution, testing, and observability.

## Get started

```sh
npm install @signet/webmcp
```

Signet is pre-release; see [Stability](#stability) for what may change.

Expose one existing function:

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

Four fields are required: `name`, `description`, `inputSchema`, and `execute`.

Signet validates the definition, compiles its JSON Schema once, and registers it with
`document.modelContext.registerTool()`. Invalid agent input never reaches your
business logic. In browsers without WebMCP, your human website continues normally and
the registration reports `unsupported`.

Dispose the registration when the capability is no longer available:

```ts
registration.dispose();
```

See the complete [getting-started guide](./docs/guide/getting-started.md).

## Add production behavior when needed

Simple read tools can stay simple. Consequential tools can opt into application
context, authorization, idempotency, verification, cancellation, and observation:

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

  // This runs on every call, including replay. Check current permission here;
  // keep mutable order eligibility inside execute.
  authorize: ({ context }) => context.scopes.includes("orders:cancel"),

  // Your application renders the review UI; Signet orders and observes the gate.
  confirm: ({ input }) => confirmCancellation(input.orderId),

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

    return cancelOrder({
      orderId,
      userId: context.userId,
      signal,
    });
  },

  recover: async ({ input, context }) => {
    const order = await getOrder(input.orderId);
    return order?.userId === context.userId && order.status === "cancelled"
      ? { recovered: true, output: order }
      : { recovered: false };
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
idempotency, and authoritative state. Signet is state-aware; it is not an application
state store or agent orchestrator.

Signet never retries operations automatically.

Authorization is re-evaluated before every idempotency lookup, including replay. Keep
current identity, permission, tenant, and resource access in `authorize`. Put mutable
eligibility that success changes—for example, whether an order is still open—inside
`execute`, so a valid repeat can return its stored result.

`recover` is for ambiguous failures such as a response lost after commit. It may report
success only after reading authoritative application state. Recovered results still run
through `verify` and, when idempotency is configured, become the stored result for later
replays.

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

The capture-only test boundary supports discovery, invocation, cancellation, and
unregistration. It is not a production WebMCP polyfill. Test representative workflows
through a supported native browser agent before shipping.

Run static readiness checks in the same test:

```ts
import { assertToolReady } from "@signet/webmcp";

expect(() => assertToolReady(searchProductsTool)).not.toThrow();
```

For a component-owned capability, use the lifecycle binding for your framework:

```ts
import { useSignetTool } from "@signet/webmcp/react";

const state = useSignetTool(signet, searchProductsTool, [shopId]);
```

The React entry point handles teardown while asynchronous registration is still in
flight. During development, `mountSignetInspector(signet)` from
`@signet/webmcp/inspector` shows exact schemas, annotations, registration state, and
privacy-safe lifecycle timings.

## What Signet provides

- **Code-first exposure:** readable TypeScript that maps directly to native WebMCP.
- **Runtime validation:** JSON Schema validation before application code runs.
- **State-aware lifecycle:** per-call application context and disposable registrations.
- **Framework lifecycle:** a StrictMode-safe React binding.
- **Expected failures:** `ToolError`, validation, authorization, and verification
  errors remain distinguishable.
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

- WebMCP is the first protocol; Signet does not hide or replace it.
- Application code, identity, policy, data, and backend enforcement remain yours.
- Inputs, outputs, context, and stack traces are not observed by default.
- Observer failures never change registration or execution behavior.
- Unsupported browsers retain the human experience.
- Public abstractions must add validation, lifecycle, reliability, testing, or
  observation—not merely rename native APIs.
- A second protocol will justify a public adapter abstraction; anticipation alone will
  not.

## Current scope

Signet is pre-release and WebMCP is experimental. The current package includes:

- `createSignet().expose()`;
- JSON Schema definition and invocation validation;
- application context and disposable native registration;
- agent-legible errors, confirmation, authorization, idempotency, recovery,
  verification, output limits, cancellation, and lifecycle observation;
- deterministic testing, store conformance, readiness, and agent-task evaluation;
- a React lifecycle binding plus a local Inspector;
- optional OpenTelemetry mapping;
- standalone and full-stack reference applications.

There is no hosted runtime, agent planner, automatic retry policy, production browser
polyfill, Signet JSON format, or compiler.

## Stability

Signet is in `0.0.x`. Any release may change the public surface. This is deliberate:
under `0.0.x`, a `^0.0.1` range resolves to that exact version, so a breaking change
can never reach you without an explicit upgrade. Every change is recorded in
[`CHANGELOG.md`](./CHANGELOG.md) with its migration step.

| Surface                                                                        | Expectation                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `createSignet`, `expose`, the four required tool fields, and the error types   | Proven by the reference application. Changes will be rare and documented.      |
| Execution controls: `authorize`, `confirm`, `idempotency`, `recover`, `verify` | Semantics are settled; argument shapes may still gain fields.                  |
| `GuardEvent` stage names and `signet.tools()`                                  | Expected to grow. Treat unknown stages as ignorable rather than exhaustive.    |
| `/testing`, `/inspector`, `/react`                                             | Developer tooling. Most likely to change as real integrations report friction. |
| Agent-task evaluation primitives                                               | Earliest surface. Expect reshaping once the evaluation corpus exists.          |

WebMCP itself is experimental and ships behind flags. The consumer half of the
protocol—how a client enumerates and invokes tools—is not yet covered by the official
declarations and differs between browser builds, so treat native behavior as a moving
target and test against the browsers you support.

## Explore

- [Getting started](./docs/guide/getting-started.md)
- [Interface API](./docs/reference/interface.md)
- [Production WebMCP](./docs/guide/production-webmcp.md)
- [Testing](./docs/guide/testing.md)
- [Reference payment application](./examples/cypress-realworld-app/SIGNET.md)
- [Design contract](./docs/design.md)

## Development

```sh
npm install
npm run validate
```

`validate` runs linting, formatting checks, strict type checking, coverage-gated
tests, a production build, package validation, and public-export smoke tests.

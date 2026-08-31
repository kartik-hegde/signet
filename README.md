# Signet

Signet is a small TypeScript toolkit for making consequential WebMCP actions safe to ship.

WebMCP already defines how a page exposes tools to browser agents. Signet does not replace that API. It wraps a normal `execute` function with the controls that product teams otherwise rebuild around every state-changing action: app-owned authorization, durable idempotency, outcome verification, cancellation, and opt-in observability.

```ts
import { guard } from "@signet/webmcp";

await document.modelContext?.registerTool({
  name: "cancel-order",
  description: "Cancels one order that belongs to the signed-in user.",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string" } },
    required: ["orderId"],
    additionalProperties: false,
  },
  execute: guard(cancelOrder, {
    name: "cancel-order",
    context: () => currentSession(),
    authorize: ({ input, context }) =>
      context.userId === ownerOf(input.orderId),
    idempotency: {
      key: ({ input, context }) => `${context.userId}:${input.orderId}:cancel`,
      store: durableStore,
    },
    verify: ({ output }) => output.state === "cancelled",
  }),
});
```

## Why this shape

The browser standard owns registration, discovery, schemas, origins, permissions, and lifecycle. Your application owns identity, authorization, business logic, persistence, and backend enforcement. Signet coordinates the execution boundary between them.

There is deliberately no `defineTool`, registry, schema language, router, browser polyfill, retry policy, or hosted runtime. Removing `guard(...)` leaves an ordinary WebMCP handler. Signet also performs no network requests and collects no telemetry unless the application explicitly supplies an observer.

## API

`guard(execute, options)` returns another WebMCP-compatible execute function. Every option is optional and independently removable:

- `context` resolves the application's authenticated session or resource context.
- `authorize` fails closed before the operation.
- `idempotency` delegates atomic execution and replay to an injected store.
- `verify` checks the observed result after execution or replay.
- `observe` receives lifecycle metadata; inputs and outputs are never included.

The original `AbortSignal` is propagated unchanged. Application errors are rethrown unchanged. Signet only introduces `AuthorizationError` and `VerificationError` for decisions it owns.

`MemoryIdempotencyStore` is available from `@signet/webmcp/testing` for tests and demos. It is not durable and must not be treated as a production guarantee.

An optional `@signet/webmcp/opentelemetry` entry point converts lifecycle events into OpenTelemetry spans. It requires the standard `@opentelemetry/api` peer dependency and never configures an exporter.

## Standards and scope

- Use the official `webmcp-types` package for `document.modelContext` declarations.
- Write native JSON Schema objects. Signet does not reinterpret them.
- Validate agent input again at the application boundary; schema enforcement is still an active WebMCP design area.
- Preserve the native `AbortSignal` for tool execution and use a registration signal to unregister tools.
- Enforce authorization and idempotency again on the backend. Browser-side code is not a security boundary.

See [the native example](./examples/native-webmcp.ts), [ecosystem research](./docs/ecosystem.md), and [design contract](./docs/design.md).

The complete guide lives in [`docs/`](./docs/index.md). Run it locally with
`npm run docs:dev` or produce the static site with `npm run docs:build`.

## Development

```sh
npm install
npm run validate
```

`validate` runs strict type checking, the coverage-gated test suite, a production
build, and imports the built package through each public export path.

Signet is experimental because WebMCP itself is evolving. The public surface will stay small until production evidence justifies another abstraction.

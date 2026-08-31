---
name: signet-webmcp
description: Make an existing TypeScript or JavaScript website agent-ready with @signet/webmcp. Use when exposing application functions through native WebMCP, adding or reviewing Signet tools, migrating direct WebMCP registration to Signet, implementing safe agent-triggered mutations, or testing a Signet/WebMCP integration.
---

# Build with Signet WebMCP

Use application functions the website already owns. Do not inspect Signet's compiled
implementation: the public contract below is sufficient.

## Workflow

1. Locate the existing business function, trusted session source, authoritative read,
   and page/component lifecycle.
2. Expose one bounded user intent per tool. Use stable IDs and descriptions that state
   scope and material restrictions. Never accept identity, role, tenant, or permissions
   as agent input.
3. Define a closed object JSON Schema. Require every argument and set
   `additionalProperties: false` unless extras are intentional.
4. Start with the four required fields: `name`, `description`, `inputSchema`, and
   `execute`. Add hooks only for real production requirements.
   For discovery and other read-only tools, set
   `annotations: { readOnlyHint: true }`; there is no top-level `readOnly` option.
5. Dispose registrations when the page state no longer makes the capability available.
6. Test the contract with `createWebMcpTestHarness`; then run the website's normal tests
   and a native browser-agent path when available.

Work token-efficiently: inspect the target business function, session source, lifecycle,
and relevant tests in one batched pass. Then implement from this contract and run the
focused test. Do not enumerate or inspect `node_modules`, declaration files, runtime
exports, or Signet source unless a compiler or test result contradicts this contract.

## Implementation pattern

```ts
import { createSignet } from "@signet/webmcp";

const signet = createSignet({
  context: ({ signal }) => getSession({ signal }),
  observe: recordLifecycleEvent,
});

const registration = await signet.expose({
  name: "cancel_order",
  description: "Cancel one unshipped order for the signed-in account.",
  inputSchema: {
    type: "object",
    properties: {
      orderId: { type: "string", minLength: 1 },
      reason: { enum: ["customer_request", "duplicate"] },
      operationId: { type: "string", minLength: 1, maxLength: 64 },
    },
    required: ["orderId", "reason", "operationId"],
    additionalProperties: false,
  },
  authorize: ({ context }) => context.scopes.includes("orders:cancel"),
  idempotency: {
    store: operationStore,
    key: ({ input, context }) =>
      [context.accountId, input.operationId, input.orderId, input.reason].join(
        ":",
      ),
  },
  execute: ({ orderId, reason }, { context, signal }) =>
    cancelOrder({ orderId, reason }, { accountId: context.accountId, signal }),
  recover: async ({ input, context, signal }) => {
    const order = await getOrder(input.orderId, { signal });
    return matchesRequestedCancellation(order, input, context)
      ? { recovered: true, output: order }
      : { recovered: false };
  },
  verify: async ({ input, context, signal }) => {
    const order = await getOrder(input.orderId, { signal });
    return matchesRequestedCancellation(order, input, context);
  },
});

registration.dispose();
```

## Public contract

- `createSignet({ modelContext?, context?, observe?, unsupported? })` creates the
  interface. `context` receives `{ signal }` once per invocation.
- `expose(tool)` validates the definition and registers it through native WebMCP. It
  returns an idempotent `dispose()` handle. A failed registration remains retryable.
- Execution order is: cancellation check, input validation, context, authorization,
  idempotent execute/replay, optional recovery, verification, result.
- `authorize({ input, context, signal })` runs before the handler and returns a boolean
  or `{ allowed, reason? }`. It runs before every idempotency lookup, including replay.
  Keep current identity, permission, tenant, and resource access here. Put mutable
  eligibility changed by success, such as `status === "open"`, inside `execute` so a
  valid replay can reach its stored result.
- `idempotency.store.execute(key, operation, { signal })` is application-supplied. The
  key must include principal, operation ID, and every intent-changing argument. Signet
  deliberately has no default production store.
- `execute(input, { context, signal })` is never automatically retried by Signet.
- `recover({ input, context, error, signal })` runs only after the handler throws. Return
  `{ recovered: true, output }` only after authoritative proof. It does not conceal store
  failures.
- `verify({ input, output, context, replayed, recovered, signal })` runs after execute,
  replay, or recovery. A false result throws `VerificationError`.
- `observe(event)` receives metadata, not inputs or outputs. Observer failures do not
  alter registration or execution.
- Unsupported browsers retain the human website. Use `unsupported: "throw"` only for
  strict development or test behavior.

The application owns authentication, authorization data, backend enforcement,
business logic, durable idempotency, and authoritative state.

Return the registration from `await signet.expose(...)` directly. Do not create another
registration `AbortController`, wrap or mutate `dispose()`, manually emit lifecycle
events, contain observer failures, validate input again, or verify inside `execute`.
Those are Signet responsibilities; duplicating them adds defects.

## Verification

Create a harness with `createWebMcpTestHarness()` from `@signet/webmcp/testing`, pass
its `modelContext` to `createSignet`, and invoke the tool with
`harness.invoke(name, input)`. Prove:

- invalid and unauthorized input causes no effect;
- a sequential repeat after success returns the same result with one effect;
- concurrent equal intent causes one effect;
- different intent does not collapse;
- failed pre-effect work remains retryable;
- verification runs after execution and replay;
- aborted work causes no effect;
- observer failure does not affect behavior;
- disposal removes the tool.

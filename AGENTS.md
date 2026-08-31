# Integrating Signet with a coding agent

This file is the complete integration contract for `@signet/webmcp`. Read it instead
of inspecting `dist/` or library internals.

## Expose a tool

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
      operationId: { type: "string", minLength: 1 },
    },
    required: ["orderId", "operationId"],
    additionalProperties: false,
  },
  authorize: ({ context }) => context.scopes.includes("orders:cancel"),
  idempotency: {
    store: operationStore,
    key: ({ input, context }) =>
      `${context.accountId}:${input.operationId}:${input.orderId}:cancel`,
  },
  confirm: {
    mode: "effect-only",
    request: ({ input }) => confirmCancellation(input.orderId),
  },
  journal: { store: operationJournal }, // reuses the idempotency key
  execute: async ({ orderId }, { context, operation, signal }) => {
    const result = await cancelOrder({
      orderId,
      accountId: context.accountId,
      signal,
    });
    await operation?.write({ orderId: result.id });
    return result;
  },
  recover: async ({ input, context, operation, signal }) => {
    const correlation = await operation?.read<{ orderId: string }>();
    if (!correlation) {
      return {
        recovered: false,
        outcome: "unknown",
        reason: "Cancellation may have committed without a correlation ID.",
      };
    }
    const order = await getOrder(input.orderId, { signal });
    return order?.accountId === context.accountId &&
      order.status === "cancelled"
      ? { recovered: true, output: order }
      : { recovered: false };
  },
  verify: async ({ input, context, signal }) => {
    const order = await getOrder(input.orderId, { signal });
    return (
      order?.accountId === context.accountId && order.status === "cancelled"
    );
  },
});

registration.dispose();
```

Only `name`, `description`, `inputSchema`, and `execute` are required. Use the other
hooks only when the workflow needs them.

## Public contract

- `createSignet({ modelContext?, context?, observe?, unsupported? })` creates an
  interface. `context` receives `{ signal }` once per invocation.
- `expose(tool)` validates and compiles the definition, then calls native
  `modelContext.registerTool`. It returns a synchronous, idempotent registration with
  `name`, `status`, `dispose()`, and `[Symbol.dispose]()`. Failed registration does not
  poison a later attempt.
- `annotations` maps directly to native WebMCP metadata. Mark discovery and other
  read-only tools with `annotations: { readOnlyHint: true }`; there is no top-level
  `readOnly` option.
- Execution order is: abort check, input validation, context, authorization, optional
  always-confirmation, idempotency lookup, optional effect-only confirmation and
  execute, optional authoritative recovery, output limit, verification, result.
- Cancellation is honored through execution. Once the handler returns successfully,
  Signet finishes verification and returns the real outcome; late cancellation emits
  `completed_after_abort` instead of converting success into `AbortError`.
- `authorize({ input, context, signal })` returns a boolean or
  `{ allowed, reason? }`. Denial occurs before the handler and before every
  idempotency lookup, including replay. Keep current identity, permission, tenant, and
  resource access here. Put mutable eligibility that the successful operation changes
  (for example, `status === "open"`) inside `execute`; otherwise a valid replay can be
  denied before its stored result is returned.
- `idempotency.store.execute(key, operation, { signal })` must atomically coalesce
  equal keys and return `{ value, replayed }`. Once a call starts `operation`, its
  successful result wins a late abort and must be persisted and returned; callers
  joining existing work may cancel their own wait. Include principal, operation ID,
  and every intent-changing argument in the key. Signet intentionally ships no
  durable production store. Use `checkIdempotencyStore()` to verify an adapter.
- A function-valued `confirm` obtains consent on every invocation before idempotency,
  preserving the original behavior. Use
  `confirm: { mode: "effect-only", request }` to prompt only inside a new store
  operation; replay then returns without a second prompt. Signet does not render UI.
- `journal: { store, key? }` gives execute, recover, and verify an `operation` handle
  with `key`, `read()`, `write()`, and `remove()`. Without `key`, it reuses the
  idempotency key. Journal methods use a finalization signal because correlation writes
  commonly follow an irreversible effect. The application still owns durable storage.
- `execute(input, { context, operation?, signal })` runs at most once per store
  operation. Signet never retries it automatically.
- `recover({ input, context, error, operation?, signal })` runs only after the handler throws. It
  may return `{ recovered: true, output }` only after authoritative proof; otherwise
  return `{ recovered: false }` for an ordinary failure. Return
  `{ recovered: false, outcome: "unknown", reason? }` when an effect may exist but
  neither success nor non-execution can be proven; Signet throws `OutcomeUnknownError`
  and emits `outcome_unknown`. A thrown recovery read is also outcome-unknown. Recovery
  never conceals idempotency-store failures.
- `verify({ input, output, context, replayed, recovered, operation?, signal })` runs after execute,
  replay, or recovery. False throws `VerificationError`. After execution, its fresh
  finalization signal is not cancelled by the caller. Set `verifyTimeoutMs` to bound
  verification; the supplied signal then aborts at that deadline.
- `outputBudgetBytes` warns and emits `output_oversized` when a serialized result
  exceeds its budget. It never converts a completed operation into failure.
- `observe(event)` receives metadata only. Stages include `registering`, `registered`,
  `registration_failed`, `unregistered`, `started`, `validated`, `authorized`,
  `confirmation_requested`, `confirmed`, `declined`, `executed`, `replayed`,
  `recovered`, `outcome_unknown`, `output_validated`, `output_oversized`, `output_unmeasurable`,
  `completed_after_abort`, `verified`, `succeeded`, and `failed`. Observer failure never
  changes application behavior.
- `tools()` returns current metadata-only inventory; `observe(listener)` adds a
  removable development observer. The React binding lives at `/react`; the optional
  overlay lives at `/inspector`.
- Unsupported browsers keep the human site working. Set `unsupported: "throw"` only
  when strict behavior is useful in development or tests.

The application still owns identity, permissions, business logic, backend
enforcement, durable idempotency, and authoritative state.

Return the registration from `await signet.expose(...)` directly. Do not wrap its
`dispose()`, create another registration signal, manually emit lifecycle events,
contain observer failures, validate input again, or verify inside `execute`. Do not
inspect package internals unless a compiler or test result contradicts this contract.

## Verify without a model

Use `createWebMcpTestHarness()` from `@signet/webmcp/testing`, inject its
`modelContext`, and invoke the registered tool with `harness.invoke(name, input)`. At
minimum prove invalid input and unauthorized calls cause no effect, sequential and
concurrent equal intent return the same result with one effect, different intent does
not collapse, verification runs after replay, an aborted signal causes no work, and
disposal removes the tool. Run the
project's normal test command; do not inspect Signet internals to re-prove these library
guarantees.

The example above is the complete integration pattern. A compile-checked expanded
version is available at `recipes/production-mutation.ts` when a human requests it.

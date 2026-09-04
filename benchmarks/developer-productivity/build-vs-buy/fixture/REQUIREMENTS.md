# Production integration task

Implement `registerCancelOrder` in `solution.mjs`. It exposes an existing order
cancellation workflow through native WebMCP. Do not change the fixture or public tests.

The function receives app-owned dependencies: `modelContext`, `service`, `getSession`,
`idempotencyStore`, and `observe`. Return a registration with a synchronous, idempotent
`dispose()` method.

## WebMCP definition

Register exactly one tool with `modelContext.registerTool(tool, { signal })`:

- `name`: `cancel_order`
- a useful non-empty description
- an object JSON Schema with exactly three required string fields:
  - `orderId`, matching `^order-[0-9]{3}$`
  - `reason`, one of `customer_request`, `duplicate`, `fraud`
  - `operationId`, matching `^op-[A-Za-z0-9-]{1,64}$`
- unknown input fields are forbidden
- `execute(input, { signal })` performs the workflow below

## Required workflow

For every invocation, in this order:

1. Reject an already-aborted signal and validate input before any business effect.
2. Resolve trusted context with `getSession({ signal })`. Never take a principal or
   permission from tool input.
3. Authorize only when the session includes the `orders:cancel` scope.
4. Execute through the supplied atomic store. The key must distinguish principal,
   operation ID, order ID, and reason. The direct-WebMCP condition calls
   `idempotencyStore.execute(key, operation, { signal })`; the Signett condition passes
   the same store through Signett's idempotency and operation-journal contracts.
5. The operation calls
   `service.cancelOrder({ orderId, reason }, { principalId, signal })`.
6. Verify after both execution and replay by reading `service.getOrder(orderId)`. Reject
   unless its status is `cancelled` and its cancellation reason and principal match the
   request and trusted context.
7. Return the service result only after verification succeeds.

Sequential and concurrent duplicate invocations must share one effect. A failed
pre-effect attempt must remain retryable. Reusing an operation ID for different intent
must not collapse the two operations.

## Lifecycle and observation

Pass an `AbortSignal` when registering. `dispose()` aborts it so the tool is no longer
available. A failed registration must not poison a later registration attempt.

Call `observe(event)` for these semantic stages when reached:

- registration: `registering`, `registered`, `registration_failed`, `unregistered`
- invocation: `started`, `validated`, `authorized`, `executed` or `replayed`,
  `verified`, then `succeeded`; on failure, `failed`

Every event has `name: "cancel_order"` and a stage. Observer exceptions or rejected
promises must never alter registration or execution behavior. Do not include input,
session, or service result data in events.

Run `node public-tests.mjs` while developing. An unseen suite evaluates all requirements.

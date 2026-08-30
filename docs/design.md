# Design contract

## Product boundary

Signet is execution control for native WebMCP handlers, not an alternate agent protocol or application framework.

The wrapper must remain:

1. **Native-first.** A site registers tools through `document.modelContext.registerTool()` and uses the official WebMCP types.
2. **Ejectable.** Removing `guard(handler, options)` reveals the original handler without a rewrite.
3. **App-owned.** Identity, policy, storage, confirmation UI, validation, and business logic remain application concerns.
4. **Fail-closed.** A failed context or authorization check prevents the side effect. An unverified result is not reported as success.
5. **Cancellation-safe.** The browser's `AbortSignal` is propagated unchanged. Signet does not pretend aborting proves a side effect did not occur.
6. **Private by default.** Core has no network behavior, timers, global patches, or automatic telemetry.
7. **Composable by interfaces.** Durable idempotency and observability are ports, not bundled infrastructure.

## Execution order

`guard()` performs a fixed, inspectable sequence:

```text
resolve app context
  -> authorize
  -> atomically execute or replay
  -> verify observed outcome
  -> return
```

Cancellation is checked before context resolution, after context resolution, and before verification. The underlying handler receives the same signal and is responsible for passing it to fetches or other cancellable work.

## Explicit non-goals for the first release

- Defining or registering WebMCP tools
- Inferring JSON Schema from TypeScript
- Providing a production browser polyfill
- Retrying state-changing operations
- Treating client authorization as sufficient
- Owning confirmation or checkout UX
- Shipping a hosted control plane
- Claiming exactly-once execution

Idempotency means the injected store provides atomic duplicate suppression for a correctly scoped key. The key should normally include the principal, operation, resource, and relevant version. Exactly-once behavior across every downstream system is not generally achievable.

## Conditions for adding an abstraction

A new core feature must satisfy all three:

1. It appears in at least three independent production integrations.
2. It cannot be implemented as clearly in application code or an adapter package.
3. It can be removed without changing WebMCP tool definitions or business logic.

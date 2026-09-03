# Performance

Signett's performance strategy is structural: do less work, avoid global coordination,
and keep optional behavior out of the hot path.

## What the core guarantees

### No global lock

The guard does not maintain a registry, queue, or shared mutex. Independent operations
can execute concurrently. Only an idempotency store may coordinate callers, and it does
so by application-defined key.

### Duplicate work converges

Concurrent callers using the same key can share one in-flight operation or replay its
result. That reduces duplicate load as well as duplicate side effects.

### No default telemetry

Core performs no network requests. When `observe` is absent, invocation IDs and timing
metadata are not allocated. Observer failures are isolated from application execution.

### Zero core runtime dependencies

The main package uses platform APIs and application hooks. OpenTelemetry is an optional
entry point with an application-owned peer dependency.

### Native cancellation

The same `AbortSignal` reaches context resolution, authorization, idempotency keying and
storage, the handler, and verification. Cancellable work can stop promptly without a
parallel cancellation abstraction.

## Reads should stay cheap

Do not guard a public, inexpensive read merely for consistency:

```ts
execute: listPublicProducts;
```

For an authenticated read, use only the required hooks. Durable idempotency and
verification belong on operations that need those semantics.

## Parallel execution example

```ts
const results = await Promise.all(
  orderIds.map((orderId) => execute({ orderId }, { signal })),
);
```

This remains parallel when keys differ. A production store must avoid a single global
transaction or lock that defeats per-key concurrency.

## Measure in the application

Signett does not publish context-free microbenchmark claims. Network and persistence
usually dominate these handlers, while policy and verifier cost are application-defined.

Measure stage durations through the observer, compare guarded and direct handlers under
representative load, and inspect contention by idempotency key. Optimize the actual
bottleneck rather than removing correctness checks blindly.

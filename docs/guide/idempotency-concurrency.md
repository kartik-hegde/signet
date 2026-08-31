# Idempotency and concurrency

Agents retry. Networks time out. A caller may not know whether an earlier mutation
finished. Signet delegates duplicate suppression to a store that can coordinate the
operation atomically.

## The store contract

```ts
interface IdempotencyStore {
  execute<Output>(
    key: string,
    operation: () => Promise<Output>,
    options: { signal: AbortSignal },
  ): Promise<{ value: Output; replayed: boolean }>;
}
```

The store owns the race. A `get()` followed by a separate `set()` is not sufficient:
two workers can both observe a miss and perform the effect.

## Scope keys to the operation

```ts
idempotency: {
  key: ({ input, context }) => [
    context.tenantId,
    context.userId,
    "cancel-order:v1",
    input.orderId,
  ].join(":"),
  store: durableStore,
}
```

Include the principal and tenant when their permissions or results differ. Include an
operation version when semantics change.

## Parallel where safe

Signet has no global lock or queue. Coordination is per store key:

| Invocations          | Expected behavior                                       |
| -------------------- | ------------------------------------------------------- |
| Same key, concurrent | One operation; other callers share or replay its result |
| Same key, later      | Return the durable result according to retention policy |
| Different keys       | Execute concurrently                                    |

Authorization is evaluated before this lookup on every invocation. Keep mutable
preconditions that successful execution changes inside `execute`; placing
`status === "open"` in `authorize` would reject a later replay before the store can
return the original result.

For consequential actions, `confirm: { mode: "effect-only", request }` places the
application-owned confirmation inside the store's new-operation callback. Concurrent
duplicates share one confirmation and one effect; later exact replays remain authorized
but do not prompt again. A plain confirmation function keeps the conservative `always`
behavior.

This is the useful performance property: unrelated customer actions do not wait behind
one another, while true duplicates converge on one effect.

```ts
await Promise.all([
  guarded({ orderId: "A" }, { signal }),
  guarded({ orderId: "B" }, { signal }),
]); // independent keys can run together
```

## Production storage

`MemoryIdempotencyStore` demonstrates the semantics in tests. It is process-local,
unbounded, and not production infrastructure.

A durable adapter must define:

- atomic acquisition and duplicate behavior;
- leases or recovery for interrupted workers;
- result persistence and retention;
- failure and retry policy;
- multi-process correctness;
- transaction boundaries with the business effect.

Once a store starts the supplied operation, a successful result owns the outcome: it
must be persisted and returned even if that caller is aborted before the result arrives.
A duplicate caller waiting on existing work may cancel its own wait without cancelling
or evicting the shared operation. `checkIdempotencyStore()` enforces both this late-abort
rule and per-key concurrency with fresh keys on every run, so it can safely exercise a
persistent store repeatedly.

Signet intentionally does not claim “exactly once.” A database and every downstream
system would need compatible transaction semantics for that claim to be meaningful.

Idempotency remembers the returned result. An [operation journal](./operation-journal)
stores the smaller correlation data needed to determine what happened when a response
is lost before that result can be persisted.

Next: [verify the resulting state](./verification).

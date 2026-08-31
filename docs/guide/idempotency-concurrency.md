# Idempotency and concurrency

Agents retry. Networks time out. A caller may not know whether an earlier mutation
finished. Signet delegates duplicate suppression to a store that can coordinate the
operation atomically.

## The store contract

```ts
interface IdempotencyStore {
  begin<Output>(
    key,
    options,
  ): Promise<
    | { state: "fresh" }
    | { state: "in_flight" }
    | { state: "completed"; value: Output }
  >;
  complete<Output>(key, value, options): Promise<void>;
  release(key, options): Promise<void>;
  abandon(key, options): Promise<void>;
}
```

The store owns the race, while the guard owns the effect boundary. A `get()` followed
by a separate `set()` is not sufficient: two workers can both observe a miss and
perform the effect. The store must not delete an in-flight claim merely because the
handler threw; only the guard can use its operation journal to prove no effect started.

`release` deletes a claim after that proof. `abandon` releases live ownership but keeps
the durable `in_flight` state so a later invocation can recover it. This distinction is
required after a lost response or crash.

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
| Same key, concurrent | Wait for its live owner, then replay the result         |
| Same key, abandoned  | Recover; never execute the effect again speculatively   |
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

`IndexedDbIdempotencyStore` from `@signet/webmcp/stores` is the conservative browser
adapter. It combines IndexedDB durability with a Web Lock per key, allowing it to tell
live work from an abandoned record across tabs. It is scoped to one browser profile;
server-side enforcement is still required when requests can arrive elsewhere.

`MemoryIdempotencyStore` from `@signet/webmcp/testing` demonstrates the same phases in
tests. It is process-local, unbounded, and unsafe for real effects.

A durable adapter must define:

- atomic acquisition and duplicate behavior;
- leases or recovery for interrupted workers;
- result persistence and retention;
- explicit release versus abandoned-work recovery;
- multi-process correctness;
- transaction boundaries with the business effect.

`checkIdempotencyStore()` enforces fresh claims, live-owner waiting, abandoned-work
reporting, completion, explicit release, cancellation, and per-key concurrency with
fresh keys on every run, so it can safely exercise a persistent store repeatedly.

Signet intentionally does not claim “exactly once.” A database and every downstream
system would need compatible transaction semantics for that claim to be meaningful.

Idempotency remembers the returned result. An [operation journal](./operation-journal)
stores the smaller correlation data needed to determine what happened when a response
is lost before that result can be persisted.

Next: [verify the resulting state](./verification).

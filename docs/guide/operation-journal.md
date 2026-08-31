# Operation journals

An idempotency store remembers completed output. An operation journal remembers the
correlation data needed to find an effect whose response may be lost. They solve
different parts of the same retry problem.

Signet requires a journal whenever idempotency is configured. Without one, an
execution error cannot prove whether a claim is safe to release, so the same key can
become permanently unusable. `guard()` and `expose()` reject that configuration, and
`checkToolReadiness()` reports it as `idempotency_journal`.

## Connect a journal

```ts
const tool = {
  idempotency: {
    key: ({ input, context }) =>
      `${context.accountId}:${input.operationId}:place-order`,
    store: idempotencyStore,
  },
  journal: {
    store: operationJournal,
  },
  async execute(input, { operation, signal }) {
    const orderId = crypto.randomUUID();
    await operation?.write({ orderId });
    const result = await orders.place({ ...input, orderId }, { signal });
    return result;
  },
  async recover({ operation, signal }) {
    const correlation = await operation?.read<{ orderId: string }>();
    if (!correlation) {
      return {
        recovered: false,
        outcome: "unknown",
        reason: "The order may exist, but no order ID was returned.",
      };
    }

    const order = await orders.get(correlation.orderId, { signal });
    return order
      ? { recovered: true, output: order }
      : { recovered: false, outcome: "unknown" };
  },
};
```

With no explicit journal key, Signet reuses the idempotency key. Supply a separate key
when correlation scope or retention differs.

## Storage contract

```ts
interface OperationJournal {
  read<Entry>(key, { signal }): Entry | undefined | Promise<Entry | undefined>;
  write<Entry>(key, entry, { signal }): void | Promise<void>;
  remove(key, { signal }): void | Promise<void>;
}
```

The application chooses durability, retention, encryption, and access policy. Keep
entries small and limited to non-secret correlation data such as an order, payment,
job, or request ID. Do not journal agent inputs, credentials, or full outputs by
default.

Write a client-generated correlation ID immediately before crossing the irreversible
effect boundary. If execution fails and the configured journal is still empty, Signet
can prove the failure was pre-effect and call `release`. A present record is retained
until recovery proves the outcome and `complete` clears it.

`WebStorageOperationJournal` is suitable for a single browser profile and accepts
`sessionStorage`, `localStorage`, or a structurally compatible store. It is not a
multi-device production guarantee. `MemoryOperationJournal` from `/testing` is for
tests and demonstrations.

## Cancellation and finalization

The invocation-scoped handle uses a fresh finalization signal. If a payment commits and
the caller cancels a moment later, the correlation write still gets a chance to finish.
Journal adapters must impose their own timeout for remote I/O.

## Unknown is a real outcome

Return `{ recovered: false }` when no result can be proved. With phased idempotency,
Signet returns the original error only when an empty configured journal independently
proves a pre-effect failure; otherwise the durable claim remains in flight and the
outcome is unknown. Return `{ recovered: false, outcome: "unknown", reason? }` to supply
a more precise explanation. Signet raises `OutcomeUnknownError` and emits
`outcome_unknown`; it never retries the effect automatically.

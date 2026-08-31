# Operation journals

An idempotency store remembers completed output. An operation journal remembers the
correlation data needed to find an effect whose response may be lost. They solve
different parts of the same retry problem.

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
    const result = await orders.place(input, { signal });
    await operation?.write({ orderId: result.orderId });
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

`WebStorageOperationJournal` is suitable for a single browser profile and accepts
`sessionStorage`, `localStorage`, or a structurally compatible store. It is not a
multi-device production guarantee. `MemoryOperationJournal` from `/testing` is for
tests and demonstrations.

## Cancellation and finalization

The invocation-scoped handle uses a fresh finalization signal. If a payment commits and
the caller cancels a moment later, the correlation write still gets a chance to finish.
Journal adapters must impose their own timeout for remote I/O.

## Unknown is a real outcome

Return `{ recovered: false }` when the original error is known to remain the correct
failure. Return `{ recovered: false, outcome: "unknown", reason? }` when the effect may
exist but cannot be located. Signet raises `OutcomeUnknownError` and emits
`outcome_unknown`; it never retries automatically.

# Outcome verification

A resolved mutation request is not always proof that the intended state exists. A queue
may reject work later, an upstream response may be stale, or a partial failure may leave
the caller uncertain.

Signett can require an explicit postcondition before returning success.

## Verify the state you care about

```ts
const execute = guard(cancelOrder, {
  context,
  authorize,
  idempotency,
  verify: async ({ input, context, replayed, signal }) => {
    const order = await orders.get(input.orderId, {
      tenantId: context.tenantId,
      signal,
    });

    return {
      verified: order.state === "cancelled",
      reason: replayed
        ? "The replayed cancellation is no longer reflected in order state."
        : "The backend did not report the order as cancelled.",
    };
  },
});
```

The strongest verifier reads authoritative state independently of the mutation
response. A check such as `output.ok === true` can still be useful, but it only verifies
the response shape.

## Verification also runs on replay

A durable stored result can become stale. Signett therefore calls `verify()` after both
new execution and replay and supplies `replayed` to the verifier.

If verification returns `false` or `{ verified: false }`, Signett throws
`VerificationError` with code `verification_failed`.

## Failure is evidence, not rollback

Verification failure does not undo a completed side effect. It means Signett will not
report the result as verified success. The application should surface the uncertain
state and choose an appropriate reconciliation path.

Do not automatically retry a consequential operation solely because verification
failed. Use its stable idempotency key and inspect authoritative state first.

## Recover a proven post-commit outcome

When an operation throws after it may have committed, `recover` can inspect the same
authoritative state before the failure reaches the agent:

```ts
recover: async ({ input, context, signal }) => {
  const order = await orders.get(input.orderId, {
    tenantId: context.tenantId,
    signal,
  });

  return order?.state === "cancelled"
    ? { recovered: true, output: order }
    : { recovered: false };
},
```

This is reconciliation, not retry. Signett calls the handler at most once. A recovered
output still passes through `verify`, and an idempotency store retains it for later
replays. Return `recovered: false` when authoritative state proves no success.

When the effect may have happened but reconciliation cannot establish the result,
return an explicit unknown outcome:

```ts
return {
  recovered: false,
  outcome: "unknown",
  reason:
    "The payment provider accepted the request, but the order lookup failed.",
};
```

Signett throws `OutcomeUnknownError` with code `outcome_unknown`. It is non-retryable:
the caller should reconcile using the same operation key rather than risk a second
effect. A thrown recovery hook is treated the same way because recovery itself failed.

Use an [operation journal](./operation-journal) when recovery needs a durable provider
reference or created resource ID that is only known after the effect begins.

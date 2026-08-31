# Outcome verification

A resolved mutation request is not always proof that the intended state exists. A queue
may reject work later, an upstream response may be stale, or a partial failure may leave
the caller uncertain.

Signet can require an explicit postcondition before returning success.

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

A durable stored result can become stale. Signet therefore calls `verify()` after both
new execution and replay and supplies `replayed` to the verifier.

If verification returns `false` or `{ verified: false }`, Signet throws
`VerificationError` with code `verification_failed`.

## Failure is evidence, not rollback

Verification failure does not undo a completed side effect. It means Signet will not
report the result as verified success. The application should surface the uncertain
state and choose an appropriate reconciliation path.

Do not automatically retry a consequential operation solely because verification
failed. Use its stable idempotency key and inspect authoritative state first.

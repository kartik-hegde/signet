# Proof Seal

Proof Seal is Signet's durable effect lifecycle for consequential operations. It makes
the application-defined effect boundary explicit and prevents an idempotent result from
becoming durably replayable until configured authoritative verification succeeds.

```text
fresh claim
  -> effect_started
  -> effect_observed
  -> verified
  -> sealed
```

The application still owns the mutation, correlation fields, authoritative read,
storage adapters, and policy. Signet owns only the conservative transitions it already
needs to decide whether retry, recovery, or completion is safe.

## Mark the effect boundary

Write non-secret correlation immediately before the first irreversible call, then
record the stronger correlation returned by that call:

```ts
execute: async ({ bookingId }, { operation, signal }) => {
  await operation?.beginEffect({ bookingId });

  const booking = await confirmBooking(bookingId, { signal });

  await operation?.recordEffect({
    bookingId,
    confirmationId: booking.confirmationId,
  });
  return booking;
},
```

`beginEffect()` fails if the effect has already started. `recordEffect()` fails unless
the start marker is durable and can only advance it once. `state()` exposes the phase
and correlation to recovery; `read()` is a convenience that returns only correlation.

Existing integrations using `operation.write()` remain compatible. Their first write
is interpreted as `effect_started`, and later writes refine correlation without moving
the phase backwards. New integrations should use the explicit methods.

Plain records written by an older Signet version are decoded as `effect_started`, so
upgrading does not make potentially committed work look safely retryable. The
`OperationJournal` storage interface is unchanged; applications should access records
through the invocation-scoped operation handle rather than depending on Signet's stored
envelope.

## Recovery decisions

After a process or page disappears, the idempotency store can report abandoned
in-flight work:

- No Proof Seal state means no effect boundary was crossed. Signet safely releases and
  reclaims the operation.
- `effect_started` means the effect may exist. Signet invokes authoritative recovery
  and never speculatively repeats the mutation.
- `effect_observed` provides the strongest available correlation for that recovery.

Recovery still returns either a proven output, a normal non-recovery decision, or an
explicit unknown outcome. Proof Seal records evidence; it does not infer business
success.

## Verification seals completion

For fresh and recovered idempotent operations, the durable store is completed only
after `verify` succeeds. If verification rejects, times out, or is unavailable, Signet
abandons the live claim while retaining Proof Seal state. A later invocation therefore
recovers and verifies the effect instead of replaying an unverified handler response.

Completed replays continue to resolve current context, re-authorize, and re-verify the
stored result. They are already sealed and do not execute or prompt for a new effect.

Proof Seal does not claim distributed exactly-once execution. Its guarantee is narrower:
Signet will not knowingly repeat an effect after its boundary, and it will not cache a
fresh or recovered operation as complete before the application's configured proof has
accepted the outcome.

# Production WebMCP

A production tool should be a narrow adapter over application behavior that already has
clear ownership and backend enforcement.

## Execution model

For each invocation, Signet performs a fixed sequence:

```text
check cancellation
  -> resolve application context
  -> authorize exact input and context
  -> atomically execute or replay by key
  -> verify the observed result
  -> return the application's output unchanged
```

Signet checks cancellation before the application effect and passes the native
`AbortSignal` through context, authorization, keying, storage, and execution. Once the
handler returns successfully, cancellation has lost the race: Signet finishes any
configured verification with a non-cancelled finalization signal and returns the
verified result. A `completed_after_abort` event makes that outcome visible.

Cancellation stops work that has not begun. It does not prove that a remote
side effect was undone.

Authorization runs on every invocation before the idempotency lookup. Keep current
access policy there; put mutable eligibility changed by a successful operation inside
the executed business path so later replays can return their stored result.

## Keep one business path

The human UI and WebMCP tool should call the same application service:

```ts
async function cancelOrder(
  input: CancelOrderInput,
  options: { signal: AbortSignal },
) {
  return orders.cancel(input, options);
}

// Human button
await cancelOrder(input, { signal });

// Agent tool
execute: guard(cancelOrder, controls);
```

Do not create a second, agent-only backend path with weaker policy or validation.

## Separate browser and backend responsibilities

| Browser layer                     | Backend layer                                 |
| --------------------------------- | --------------------------------------------- |
| Expose the native WebMCP tool     | Authenticate every request                    |
| Validate early for useful errors  | Validate as the authority                     |
| Avoid obviously unauthorized work | Enforce tenant and resource policy            |
| Pass a stable operation key       | Persist duplicate suppression transactionally |
| Show current state to the person  | Commit and return authoritative state         |

::: warning Browser code is not a security boundary
Client authorization improves behavior and defense in depth. It cannot protect a
backend endpoint that accepts an unauthorized request.
:::

## Design tools for cooperation

Prefer small tools that expose meaningful application capabilities and update the same
state the person sees. Return bounded structured results. For high-impact actions, use
the application's existing review or confirmation UI rather than inventing a generic
library dialog.

Before release, work through the [production checklist](../production-checklist).

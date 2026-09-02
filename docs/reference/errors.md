# Errors

Signet introduces errors only for decisions it owns. Context, storage, handler, and
verifier exceptions otherwise retain their original identity.

## `ValidationError`

Thrown before application logic when an invocation does not match the tool's JSON
Schema. Its `code` is `invalid_input`; `issues` contains machine-readable paths,
keywords, and messages. Its bounded message includes the first failing paths so an
agent can correct the call even when the browser preserves only `Error.message`.

## `ToolError`

Use `ToolError` for an expected business failure that an agent or UI can act on:

```ts
throw new ToolError({
  code: "order_already_shipped",
  message: "Shipped orders cannot be cancelled.",
  retryable: false,
  details: { orderId },
});
```

Signet never retries the operation automatically. `error.retry` makes the condition
machine-readable: it is `never` when `retryable` is false, `as_is` when retryable
without a repair, and `after_repair` when a repair is present. The portable message
uses `retryable: yes; only after repair` for the last case so an agent does not blindly
repeat a call that cannot yet succeed.

The message includes the code and retry condition because custom error properties are
not consistently preserved across browser-agent boundaries. `details` remains
application-side and is never added to the message automatically.

Use `repair` when the application knows the concrete next action an agent should take:

```ts
throw new ToolError({
  code: "slot_stale",
  message: "The selected slot is no longer available.",
  retryable: true,
  repair: {
    action: "call_tool",
    tool: "list_available_slots",
    instruction: "Choose a current slot, then retry with the same operationId.",
  },
});
```

Signet appends a bounded `Next action:` sentence to `Error.message`, because native
browser-agent boundaries do not consistently preserve custom error properties. The
`call_tool` action explicitly tells the agent to wait for that tool before continuing,
so a dependent repair is not launched against stale state. The
structured `repair` property remains available to application code. The supported
actions are `change_input`, `call_tool`, `refresh_state`, `retry_same_operation`,
`ask_user`, `reconcile`, and `stop`. Signet communicates the instruction but never
performs the retry or calls another tool itself.

Use an ordered plan when recovery needs multiple dependent calls:

```ts
throw new ToolError({
  code: "payment_source_stale",
  message: "The source account changed after authorization.",
  retryable: true,
  repair: {
    steps: [
      {
        action: "call_tool",
        tool: "list_payment_accounts",
        instruction: "Refresh the source account state.",
      },
      {
        action: "call_tool",
        tool: "prepare_payment_authorization",
        instruction: "Create a replacement authorization.",
      },
      {
        action: "retry_same_operation",
        tool: "send_payment",
        instruction: "Retry with the replacement authorization.",
      },
    ],
    preserve: ["operationId", "amount", "receiverId"],
  },
});
```

Plans are rendered as numbered steps with an explicit instruction to run them in
order and not in parallel. `preserve` names intent-defining input fields whose original
values must survive the repair; it does not copy those values into the message. Keep a
portable plan to five concise steps and eight preserved fields. Instructions, tool
names, and field names are whitespace-normalized and bounded in the fallback message;
the full structured `repair` value remains on the error for capable callers.

Author repair guidance from trusted application logic. Do not interpolate server
responses, page content, or other untrusted text into agent instructions. A useful
expected failure answers four questions: what failed (`code` and `message`), whether a
retry is allowed, what must happen before it, and which inputs must not change.

## `AuthorizationError`

Thrown when `authorize` returns a denial.

```ts
error.name === "AuthorizationError";
error.code === "authorization_denied";
```

## `ConfirmationError`

Thrown when the application-owned `confirm` hook declines an operation. Its code is
`confirmation_declined`.

## `VerificationError`

Thrown when `verify` reports that the intended result is not verified.

```ts
error.name === "VerificationError";
error.code === "verification_failed";
```

## `OutcomeUnknownError`

Thrown when an operation may have committed but authoritative recovery cannot prove
success or non-execution. Its code is `outcome_unknown`, `retryable` is `false`, and
its `cause` retains the execution or recovery failure.

```ts
error.name === "OutcomeUnknownError";
error.code === "outcome_unknown";
error.retryable === false;
```

Do not retry with a new operation key. Reconcile the original intent using the same
key or route it to application review.

## Handle by code or class

```ts
try {
  return await execute(input, { signal });
} catch (error) {
  if (error instanceof ValidationError) {
    return showInvalidInput(error.issues);
  }

  if (error instanceof ToolError) {
    return showExpectedFailure(error.code, error.message);
  }

  if (error instanceof AuthorizationError) {
    return showPermissionMessage(error.message);
  }

  if (error instanceof VerificationError) {
    return showUncertainOutcome(error.message);
  }

  if (error instanceof OutcomeUnknownError) {
    return showReconciliationRequired(error.message);
  }

  throw error;
}
```

Do not turn arbitrary failures into success envelopes. Let the application preserve its
existing error semantics.

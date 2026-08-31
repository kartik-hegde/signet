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

`retryable` is descriptive. Signet never retries the operation automatically.
The error message includes the code and retryability because custom error properties
are not consistently preserved across browser-agent boundaries. `details` remains
application-side and is never added to the message automatically.

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

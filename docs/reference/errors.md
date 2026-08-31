# Errors

Signet introduces errors only for decisions it owns. Context, storage, handler, and
verifier exceptions otherwise retain their original identity.

## `AuthorizationError`

Thrown when `authorize` returns a denial.

```ts
error.name === "AuthorizationError";
error.code === "authorization_denied";
```

## `VerificationError`

Thrown when `verify` reports that the intended result is not verified.

```ts
error.name === "VerificationError";
error.code === "verification_failed";
```

## Handle by code or class

```ts
try {
  return await execute(input, { signal });
} catch (error) {
  if (error instanceof AuthorizationError) {
    return showPermissionMessage(error.message);
  }

  if (error instanceof VerificationError) {
    return showUncertainOutcome(error.message);
  }

  throw error;
}
```

Do not turn arbitrary failures into success envelopes. Let the application preserve its
existing error semantics.

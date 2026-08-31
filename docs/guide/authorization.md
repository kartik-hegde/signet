# Authorization

Signet provides an authorization boundary, not an identity provider.

Your application resolves the signed-in principal and decides whether that principal
may perform the exact requested operation.

## Resolve application context

```ts
const protectedExecute = guard(updateRole, {
  context: async (_input, { signal }) => {
    const session = await appSession({ signal });
    return {
      principalId: session.user.id,
      tenantId: session.tenant.id,
      role: session.user.role,
    };
  },
  authorize: ({ input, context }) => ({
    allowed:
      context.role === "owner" &&
      context.tenantId === input.tenantId &&
      context.principalId !== input.userId,
    reason: "Only an owner can change another member's role.",
  }),
});
```

Context stays inside the application. Signet never sends it to the model or reads
cookies, local storage, or framework state implicitly.

## Fail closed

The handler does not run when context resolution fails, authorization throws, or the
decision denies access. A denial becomes an `AuthorizationError` with code
`authorization_denied`.

```ts
try {
  await protectedExecute(input, { signal });
} catch (error) {
  if (error instanceof AuthorizationError) {
    showPermissionMessage(error.message);
  }
}
```

## Authorize the resource, not the tool name

A useful decision normally binds:

```text
principal + tenant + operation + resource + relevant input
```

Checking only `role === "admin"` is often insufficient. Confirm that the resource
belongs to the same tenant, that its current state allows the transition, and that the
specific input is permitted.

## Enforce twice

The browser check prevents wasted or surprising work. The backend repeats the decision
using server-trusted identity and state. If the two disagree, the backend wins.

Next: make mutation retries safe with [idempotency and per-key concurrency](./idempotency-concurrency).

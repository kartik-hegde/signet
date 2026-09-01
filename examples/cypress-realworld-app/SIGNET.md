# Using Signet in the Cypress Real World App

This vendored application is Signet's end-to-end browser fixture. It adds three native
WebMCP tools to an existing React and Express payment application without creating an
agent-only business path.

For the conceptual walkthrough, start with the documentation's
[real browser example](../../docs/guide/real-browser-example.md). This file explains
the fixture's source layout and test lanes.

## Exposed tools

| Tool                    | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `search_payment_users`  | Find an application user who can receive a payment             |
| `list_payment_accounts` | List source accounts owned by the signed-in user               |
| `send_payment`          | Send one payment through the application's normal backend path |

The read tools return authoritative IDs for the mutation. `send_payment` adds trusted
context, early authorization, local duplicate coordination, an operation journal,
authoritative recovery, verification, cancellation, and lifecycle observation.

## Application boundary

```text
browser agent
  -> native WebMCP registration
  -> Signet validation and execution controls
  -> authenticated Express endpoint
  -> payment and operation records
  -> authenticated authoritative read
  -> Signet verification
```

The layers retain separate responsibilities:

| Layer                         | Responsibility                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Native WebMCP                 | Discovery, invocation, execution signal, registration lifetime                             |
| Signet                        | Input validation, context, policy ordering, replay, recovery, verification, observation    |
| Express application           | Authentication, final authorization, validation, business logic, durable operation records |
| Cypress or native Chrome lane | Invocation plus UI, HTTP, and database assertions                                          |

Browser authorization is defense in depth, not a security boundary. The server repeats
authentication, ownership, and payment validation even when Signet has already denied
obviously invalid work.

## Source map

| File                                                                                           | What it demonstrates                                              |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`src/webmcp/paymentTools.ts`](./src/webmcp/paymentTools.ts)                                   | Tool definitions, interfaces, controls, registration, and cleanup |
| [`src/containers/PrivateRoutesContainer.tsx`](./src/containers/PrivateRoutesContainer.tsx)     | Registering only inside the authenticated React subtree           |
| [`backend/webmcp-routes.ts`](./backend/webmcp-routes.ts)                                       | Authenticated context, mutation, and authoritative read endpoints |
| [`backend/database.ts`](./backend/database.ts)                                                 | Durable fixture operation records and replay/conflict behavior    |
| [`cypress/support/webmcp.ts`](./cypress/support/webmcp.ts)                                     | Capture-only WebMCP test boundary                                 |
| [`cypress/tests/webmcp/signet-payment.spec.ts`](./cypress/tests/webmcp/signet-payment.spec.ts) | End-to-end safety and state assertions                            |
| [`cypress/tests/webmcp/payment-parity.spec.ts`](./cypress/tests/webmcp/payment-parity.spec.ts) | The same user goal through React and WebMCP                       |
| [`scripts/nativeWebMcpSmoke.mjs`](./scripts/nativeWebMcpSmoke.mjs)                             | Native Chrome discovery, execution, and state proof               |

## Registration lifecycle

`PrivateRoutesContainer` owns one lifecycle for all tools:

```tsx
useEffect(() => {
  const lifecycle = registerPaymentTools(showCreatedPayment);
  return () => lifecycle.abort();
}, [showCreatedPayment]);
```

`registerPaymentTools()` creates a plain interface for read tools and a context-aware
interface for the payment:

```ts
const readTools = createSignet();
const paymentTools = createSignet<PaymentContext>({
  context: ({ signal }) => requestJson<PaymentContext>("/context", { signal }),
  observe: recordGuardEvent,
});
```

It exposes all three definitions with `signet.expose()`. When the authenticated
subtree unmounts, it disposes the resolved registrations and clears the fixture's
process-local stores.

## Payment controls

The important part of `send_payment` is the boundary around the existing `POST
/webmcp/payments` request:

```ts
paymentTools.expose({
  name: "send_payment",
  description:
    "Send one payment from an account owned by the signed-in user. " +
    "Reuse operationId when retrying the same intended payment.",
  inputSchema: paymentInputSchema,

  authorize: ({ input, context }) => {
    if (input.receiverId === context.userId) return false;
    return context.accounts.some((account) => account.id === input.sourceAccountId);
  },

  idempotency: {
    store: idempotencyStore,
    key: ({ input, context }) => paymentFingerprint(context.userId, input),
  },
  journal: { store: operationJournal },

  execute: async (input, { operation, signal }) => {
    await operation?.write({ operationId: input.operationId });
    return requestJson("/payments", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    });
  },

  recover: ({ input, context, operation, signal }) =>
    recoverPayment({ input, context, operation, signal }),

  verify: ({ input, output, context, signal }) => verifyPayment({ input, output, context, signal }),
});
```

The real code keeps `paymentFingerprint`, recovery, and verification explicit so a
reviewer can inspect every compared field.

The idempotency key includes the signed-in user, operation ID, source account,
recipient, normalized amount, and trimmed description. Equal intent converges; reuse
of the operation ID with different intent reaches the server and returns `409
Conflict`.

The memory idempotency store and journal are appropriate only for this deterministic
fixture. The Express backend separately persists operation records so reload retries
still produce one durable effect. A production browser integration can use
`IndexedDbIdempotencyStore`; a server integration should coordinate in its database.

## Authoritative verification and recovery

The mutation response is not treated as proof. Verification calls authenticated `GET
/webmcp/payments/:operationId` and compares:

- the operation owner;
- sender, receiver, and source account;
- normalized amount and description;
- transaction ID; and
- final `complete` status.

If execution throws after the journal records the operation ID, recovery uses the same
authenticated read. It returns success only when every requested field matches. A
missing or conflicting outcome remains a failure rather than becoming plausible
success.

## Deterministic browser tests

Cypress installs a capture-only `document.modelContext` before React loads. It records
the exact native registrations and invokes their real callbacks. Everything after
that capture point is the application path: cookies, React lifecycle, Signet, HTTP,
Express authorization, balances, transactions, and the JSON database.

The suite proves:

1. tools appear only while authenticated;
2. a payment changes the exact sender and receiver balances;
3. unowned accounts are denied before the mutation and again by the server;
4. concurrent identical calls create one effect;
5. reload retries return the durable server result;
6. conflicting operation-ID reuse is rejected;
7. cancellation before execution sends no request;
8. verification mismatches are not returned as success; and
9. another user cannot read the operation.

Run it from the Signet repository root:

```sh
npm run test:reference:install
npm run test:reference
```

The first command installs the pinned application dependencies. The second builds
Signet and the fixture, starts React and Express, runs the focused Cypress suite, and
stops both servers. No model credentials are required.

## Native Chrome lane

The native lane launches a clean Chrome profile without the capture object. It uses
the real `document.modelContext` API to discover and execute the tools, then checks the
authenticated read and exact database deltas.

```sh
# Report capability without failing when local Chrome lacks WebMCP
npm run test:reference:native:probe

# Require the native API
npm run test:reference:native
```

WebMCP is experimental and requires a compatible Chrome build. Native execution proves
the browser protocol boundary; natural-language tool selection is a separate
probabilistic evaluation.

## Provenance

This directory vendors the
[Cypress Real World App](https://github.com/cypress-io/cypress-realworld-app) at commit
`28ca4d03e4c68d366ccdbb25d43e1f37b3c67a4d` (2026-08-13). Its MIT license is retained
in [`LICENSE`](./LICENSE).

The fixture database is synchronous in one Node process. It is suitable for regression
tests, not as a production model for isolation, crash recovery, or concurrent
idempotency.

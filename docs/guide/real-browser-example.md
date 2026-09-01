# Codelab: an authenticated payment app

The repository includes the Cypress Real World App, an existing React and Express
payment application instrumented with Signet. It is the smallest place to see the
complete browser boundary, authenticated backend, UI lifecycle, and database oracle
working together.

Complete the [first agent call](../tutorials/first-agent-call) before this tutorial if
you have not yet inspected and invoked a native WebMCP tool in Chrome.

## Before you start

For the deterministic and native-browser lanes, you need:

- a Signet checkout with Node.js 20.19 or newer and npm;
- network access for the one-time reference-app dependency install; and
- Google Chrome for the native WebMCP lane.

For the real-agent lane, you also need Google Chrome and an installed, authenticated
Codex CLI. The first agent run downloads its pinned Node.js 24 runner from npm.

The three lanes prove different boundaries:

| Lane                  | Command                          | Model? | Evidence                                                                        |
| --------------------- | -------------------------------- | ------ | ------------------------------------------------------------------------------- |
| Deterministic browser | `npm run test:reference`         | No     | React lifecycle, Signet controls, HTTP, Express policy, and database assertions |
| Native browser        | `npm run test:reference:native`  | No     | Native Chrome discovery and invocation plus one verified database effect        |
| Real agent            | `npm run test:agent -- --task=…` | Yes    | Model tool selection joined to Signet lifecycle and an application oracle       |

All runs operate only on the vendored application's seeded local test database. The
test and native lanes reset that fixture automatically.

The integration exposes three tools:

| Tool                    | Purpose                                   | Controls                                                             |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `search_payment_users`  | Find a recipient                          | Closed schema, bounded result, read-only annotation                  |
| `list_payment_accounts` | Read the signed-in user's source accounts | Trusted server read, read-only annotation                            |
| `send_payment`          | Send one payment                          | Context, authorization, idempotency, journal, recovery, verification |

The agent first discovers valid identifiers through the read tools, then supplies
those identifiers to the mutation. All three use the application's existing HTTP
endpoints and session cookie.

## Architecture

```text
browser agent
  -> native document.modelContext
  -> Signet tool definition and execution controls
  -> existing authenticated Express endpoints
  -> application database
  -> authoritative payment read
  -> Signet verification
  -> tool result
```

Signet owns the agent-facing boundary and execution ordering. The application server
remains responsible for authentication, final authorization, validation, business
logic, and durable payment records.

## 1. Mount tools in the authenticated browser subtree

The React private-route container registers the tools after login and aborts their
lifecycle when that subtree unmounts:

```tsx
useEffect(() => {
  const lifecycle = registerPaymentTools(showCreatedPayment);
  return () => lifecycle.abort();
}, [showCreatedPayment]);
```

This prevents a stale payment capability from remaining discoverable after logout.

## 2. Define raw handlers and Signet wrappers

The fixture keeps raw and guarded callbacks side by side so the benchmark can isolate
the value of Signet without changing the WebMCP inventory. The payment wrapper resolves
authenticated context before policy runs:

```ts
const guardedPayment = guard<SendPaymentInput, PaymentResponse, PaymentContext>(
  executePayment,
  {
    context: (_input, { signal }) =>
      requestJson<PaymentContext>("/context", { signal }),
    observe: recordGuardEvent,
    // authorize, idempotency, journal, recovery, and verification follow
  },
);
```

`PaymentContext` comes from the authenticated server session. It contains the current
user ID and accounts that may fund a payment; none of those trust decisions come from
agent input.

## 3. Register discovery tools

The account tool is a normal bounded read:

```ts
modelContext.registerTool({
  name: "list_payment_accounts",
  title: "List payment source accounts",
  description: "List payment accounts owned by the signed-in user.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: (_input, { signal }) =>
    requestJson<PaymentContext>("/context", { signal }),
});
```

`search_payment_users` follows the same shape with one bounded `query` argument. It
also uses `untrustedContentHint` because user display names originate outside the
application's trusted code.

These tools are not merely preparatory UI. They give the agent authoritative IDs to
use instead of asking it to infer or invent them.

## 4. Add controls around the payment

The mutation wraps its handler with the controls appropriate for a payment, then the
registered callback selects raw or guarded execution from the benchmark condition:

```ts
const executePayment = async (input, { operation, signal }) => {
  await operation?.write({ operationId: input.operationId });
  return requestJson("/payments", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
};

const guardedPayment = guard(executePayment, {
  name: "send_payment",
  authorize: ({ input, context }) => {
    if (input.receiverId === context.userId) {
      return { allowed: false, reason: "A user cannot pay themselves." };
    }
    return context.accounts.some(
      (account) => account.id === input.sourceAccountId,
    );
  },

  idempotency: {
    store: idempotencyStore,
    key: ({ input, context }) => paymentFingerprint(context.userId, input),
  },
  journal: { store: operationJournal },

  recover: ({ input, context, operation, signal }) =>
    recoverPayment({ input, context, operation, signal }),

  verify: ({ input, output, context, signal }) =>
    verifyPayment({ input, output, context, signal }),
});

modelContext.registerTool({
  name: "send_payment",
  description: paymentDescription,
  inputSchema: paymentInputSchema,
  execute: (input, options) =>
    window.__webMcpBenchmarkMode === "raw"
      ? executePayment(input, options)
      : guardedPayment(input, options),
});
```

Each abstraction answers a separate question:

1. `context`: who is signed in, and which accounts do they own now?
2. `authorize`: may this principal attempt this exact payment?
3. `idempotency`: is this the same principal and exact payment intent as a prior call?
4. `journal`: which durable operation should recovery look up if the response is lost?
5. `recover`: did the server commit the intended payment despite the error?
6. `verify`: does authoritative state match the claimed successful result?

The example uses memory stores because it is a deterministic single-page fixture. The
Express backend independently keeps a durable operation record, returns an existing
result for an identical retry, and rejects conflicting reuse of an operation ID. A
production application should use storage whose durability matches its effect.

## 5. Dispose every registration

All three registrations share one abort signal. When the authenticated subtree
unmounts, Chrome removes every tool and the fixture clears its process-local stores:

```ts
modelContext.registerTool(searchUsersTool, { signal: lifecycle.signal });
modelContext.registerTool(listAccountsTool, { signal: lifecycle.signal });
modelContext.registerTool(sendPaymentTool, { signal: lifecycle.signal });

lifecycle.signal.addEventListener("abort", () => {
  idempotencyStore.clear();
  operationJournal.clear();
});
```

Normal applications can use `createSignet().expose()` or framework bindings such as
`useSignetTool()`; the imperative registration here holds the tool contract constant
across raw and guarded benchmark arms.

## 6. Repeat authority on the server

The browser is never the final security boundary. The payment endpoint independently:

1. reads the authenticated session;
2. validates every field;
3. proves ownership of the source account;
4. rejects self-payment and unknown recipients;
5. coordinates the durable operation ID; and
6. commits the payment and operation record.

The verification endpoint is authenticated too. It reads the committed transaction by
operation ID and only returns records owned by the signed-in user.

## 7. Test from registration to database state

Cypress installs a capture-only `document.modelContext` before React starts. Tests
then invoke the exact callbacks registered by the application. Everything after that
boundary is real: cookies, React lifecycle, Signet, HTTP, Express policy, payment
logic, balances, and database writes.

The focused tests prove:

- tools exist only while signed in;
- invented or unauthorized arguments cause no payment request;
- concurrent identical calls produce one effect;
- a reload retry returns the existing durable result;
- conflicting reuse of an operation ID is rejected;
- cancellation before execution causes no work;
- verification failure is not reported as success; and
- the final database balances and transaction match the requested payment.

Run the deterministic browser suite from the repository root:

```sh
npm run test:reference:install
npm run test:reference
```

The install command is needed once. The test command builds Signet and the application,
starts the React and Express servers, runs the focused Cypress specs, and stops both
servers. The expected result is 15 passing tests across two spec files.

No model credentials are required. To exercise the real native Chrome WebMCP boundary:

```sh
npm run test:reference:native
```

That command also builds and starts the complete fixture. Its success summary is:

```text
[native WebMCP] discovered 3 tools; 2 calls produced 1 verified effect
```

## 8. Give the live tools to a real agent

The monorepo keeps one canonical payment fixture for deterministic and agent-backed
experiments. Its Test Agent runner starts the fixture, signs in through Chrome, exposes
only the native tools registered by the page, runs a real provider, and grades the
result with an application-owned oracle. Install the fixture once:

```sh
npm run test:reference:install
```

Run the remaining commands from the repository root. The runner starts and stops the
local React and Express application itself.

First run the read-only discovery task:

```sh
npm run test:agent -- --task=find-payment-recipient
```

Then run the consequential payment task:

```sh
npm run test:agent -- --task=pay-lia-reference
```

The included provider adapter uses a subscription-authenticated Codex CLI session. The
runner also has a provider seam for another MCP-capable agent; model credentials belong
there, not in the payment website. These commands reset seeded local fixture data and
write the latest run evidence under `evidence/test-agent/`.

Read `evidence/test-agent/latest.md` for the outcome and the adjacent JSON for the exact
tool inventory, arguments, return values, Signet lifecycle, timing, model report, and
independent application evidence. The payment is successful only when the database
oracle agrees—not merely when the agent says it succeeded. `latest.*` describes the
most recently requested task, so run the discovery and payment tasks separately when
you want to inspect both reports.

## Read the implementation

| Source                                                                                                                                                    | What to inspect                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`paymentTools.ts`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/src/webmcp/paymentTools.ts)                           | Tool definitions, controls, registration, and cleanup |
| [`PrivateRoutesContainer.tsx`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/src/containers/PrivateRoutesContainer.tsx) | Authenticated React ownership                         |
| [`webmcp-routes.ts`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/backend/webmcp-routes.ts)                            | Backend context, payment, and authoritative reads     |
| [`signet-payment.spec.ts`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/cypress/tests/webmcp/signet-payment.spec.ts)   | End-to-end safety assertions                          |
| [`nativeWebMcpSmoke.mjs`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/scripts/nativeWebMcpSmoke.mjs)                  | Native Chrome discovery and invocation                |

The vendored application has a more detailed
[integration runbook](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/SIGNET.md).

Next, run the [Cal.diy booking codelab](../tutorials/cal-diy), then use the
[patterns from Cal.diy and Saleor](./integration-patterns) to decide which abstractions
another application needs.

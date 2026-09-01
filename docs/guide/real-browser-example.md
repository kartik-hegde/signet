# Codelab: an authenticated payment app

The repository includes the Cypress Real World App, an existing React and Express
payment application instrumented with Signet. It is the smallest place to see the
complete development loop working together: expose a capability, test it
deterministically, run it through a native browser and real agent, grade the product
outcome from the database, then retain a baseline that catches regressions while the
agent interface evolves.

Complete the [first agent call](../tutorials/first-agent-call) before this tutorial if
you have not yet inspected and invoked a native WebMCP tool in Chrome.

## Before you start

For the deterministic and native-browser lanes, you need:

- a Signet checkout with Node.js 20.19 or newer and npm;
- network access for the one-time reference-app dependency install; and
- Google Chrome for the native WebMCP lane.

For the real-agent lane, you also need Google Chrome and an installed, authenticated
Codex CLI. The first agent run downloads its pinned Node.js 24 runner from npm.

These lanes prove different boundaries:

| Lane                  | Command                          | Model? | Evidence                                                                        |
| --------------------- | -------------------------------- | ------ | ------------------------------------------------------------------------------- |
| Deterministic browser | `npm run test:reference`         | No     | React lifecycle, Signet controls, HTTP, Express policy, and database assertions |
| Native browser        | `npm run test:reference:native`  | No     | Native Chrome discovery and invocation plus one verified database effect        |
| Real-agent smoke      | `npm run test:agent -- --task=…` | Yes    | One model run joined to Signet lifecycle and an application oracle              |
| Repeated evaluation   | `npm run eval -- …`              | Yes    | Versioned Trial Evidence and oracle-graded JSON/Markdown Reports                |
| Change check          | `signet check … --against …`     | No     | Per-Case regression verdict against a reviewed Report                           |

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
- production-facing tool metadata passes Signet's readiness diagnostics;
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
servers. The expected result is 16 passing tests across two spec files.

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

## 9. Turn the workflow into a reusable Case

A successful agent smoke test is useful, but it is not yet a development loop. The
next step is to retain the user intent, expectations, safety properties, and budgets as
a versioned Case. The fixture's consequential Case is ordinary TypeScript:

```ts
defineCase({
  id: "pay-lia-reference",
  intent:
    'Send Lia Rosenbaum $12.00 for "Reference parity payment". Complete the payment exactly once.',
  kind: "consequential",
  application: "cypress-payments",
  oracle: "payment-database",
  expectations: {
    requiredCapabilities: [
      "search_payment_users",
      "list_payment_accounts",
      "send_payment",
    ],
    completionCapability: "send_payment",
    outcome: { effectCount: 1, amountCents: 1200 },
    forbiddenEffects: ["duplicate-payment", "wrong-recipient", "wrong-amount"],
  },
  budgets: { timeoutMs: 120_000, maxActions: 20, maxToolCalls: 12 },
});
```

The intent describes the product outcome, not an exact tool transcript. Discovery
tools are expected semantic milestones, while the database oracle decides whether the
payment happened correctly. This leaves the agent free to plan without letting its
final sentence grade its own work.

The evaluation module attaches the Case suite to five replaceable boundaries:

```text
application adapter -> reset, seed, authenticate, read application state
browser adapter     -> open Chrome, discover the live WebMCP interface
agent adapter       -> run the intent through an existing agent runtime
fault adapter       -> inject the selected deterministic failure
oracle adapter      -> compare authoritative state before and after
```

Read `fixtures/cypress-realworld-app/eval/` to see each boundary separately. A real
application keeps its provider credentials in the agent adapter and its business truth
in the oracle adapter.

## 10. Preview the evaluation matrix

Start with one important Case and two interface conditions. A dry run verifies the
selection without launching Chrome or consuming model capacity:

```sh
npm run eval -- \
  --case pay-lia-reference \
  --condition signet-baseline,signet-guided \
  --trials 5 \
  --dry-run
```

The expected matrix is one Case × two conditions × five Trials, or ten agent runs.
`signet-baseline` exposes concise metadata. `signet-guided` adds workflow and argument
guidance while keeping the application, model, prompt policy, and oracle fixed.

For a cheap wiring check, change `--trials 5` to `--trials 1`. Do not draw a product
conclusion from a single Trial. Five repeated Trials are the minimum used here for
iteration; larger published claims need enough Cases and Trials to report uncertainty
honestly.

## 11. Run and review a baseline

Run the selected matrix into an ignored working directory:

```sh
npm run eval -- \
  --case pay-lia-reference \
  --condition signet-baseline,signet-guided \
  --trials 5 \
  --output .artifacts/tutorial/payment-baseline
```

The runner resets the application before every Trial and retains all ten results:

```text
.artifacts/tutorial/payment-baseline/
  *.evidence.json   immutable evidence for each Trial
  *-trace.json      chronological browser and tool trace
  report.json       machine-readable aggregate
  report.md         human-readable Case and condition table
  run.json          progress manifest retained during the run
```

Review `report.md`, then inspect the Evidence for every failed or unsafe Trial. The
useful diagnostic question is which boundary failed: registration, selection,
arguments, application execution, Signet execution control, verification, oracle, or
agent provider. Never discard a failed Trial because the remaining majority passed.

Only promote a baseline after reviewing the run, confirming that its Case definition
and environment are the ones the team intends to preserve, and checking that the
Report contains no sensitive values. One repository convention is:

```sh
mkdir -p evidence/baselines
cp .artifacts/tutorial/payment-baseline/report.json \
  evidence/baselines/pay-lia-reference.report.json
git add evidence/baselines/pay-lia-reference.report.json
```

Committing the aggregate Report—not private transcripts or raw application data—makes
the expected behavior reviewable. Updating that file later should be a deliberate
baseline review, never an automatic consequence of a failing check.

## 12. Iterate and run the change check

Now change the agent interface: tighten a description, bound an argument, add an
example, or adjust which tools are exposed in this application state. Do not change the
Case merely to make a failure disappear. Keep the model, provider policy, browser, and
application seed fixed so the interface revision is the meaningful variable. Run the
exact same matrix against the reviewed baseline:

```sh
npm run eval -- \
  --case pay-lia-reference \
  --condition signet-baseline,signet-guided \
  --trials 5 \
  --output .artifacts/tutorial/payment-candidate \
  --against evidence/baselines/pay-lia-reference.report.json
```

The candidate directory now also contains:

```text
check.json   machine-readable pass/fail result and policy
check.md     review-ready diagnosis for each Case × condition
```

The default policy fails on any safe-success regression, new forbidden effect,
environment-error increase, reduced Trial coverage, missing matrix cell, or changed
Case definition. Comparisons happen per Case and condition, so a gain in
`signet-guided` cannot conceal a regression in `signet-baseline`.

For a probabilistic agent, declare any accepted success-rate variance explicitly.
Performance gates are opt-in:

```sh
npm run eval -- \
  --case pay-lia-reference \
  --condition signet-baseline,signet-guided \
  --trials 10 \
  --output .artifacts/tutorial/payment-candidate \
  --against evidence/baselines/pay-lia-reference.report.json \
  --max-safe-regression 0.1 \
  --max-duration-ratio 1.25 \
  --max-token-ratio 1.2
```

`--max-safe-regression 0.1` permits a ten-percentage-point drop; it never permits a new
forbidden effect. Use a tolerance because the team understands its variance and risk,
not merely to turn the check green.

You can compare completed Reports again without spending provider capacity:

```sh
npm exec -- signet check \
  .artifacts/tutorial/payment-candidate/report.json \
  --against evidence/baselines/pay-lia-reference.report.json
```

A failed check prints every reason and still writes both check artifacts before
returning a non-zero exit code.

## 13. Put each proof in the right automation lane

Keep deterministic contract and browser tests in pull-request CI:

```sh
npm run test:eval
npm run test:reference
```

Repeated real-agent evaluation consumes provider capacity and has statistical variance,
so run it manually, nightly, or before an agent-interface release rather than on every
source change. The repository's manual benchmark workflow follows that boundary. In
GitHub Actions, `signet eval --against …` automatically appends `check.md` to the job
summary, so the exact regressed Case is visible without downloading an artifact.

The retained loop is now:

```text
declare tools
  -> inspect the live browser interface
  -> run deterministic contract and outcome tests
  -> run a real-agent Case repeatedly
  -> grade each Trial from application state
  -> review and retain a Report baseline
  -> improve descriptions, schemas, exposure, or execution
  -> compare the same matrix and block regressions
```

That is the core Signet workflow: not merely registering a tool, but making an agent
interface measurably better without losing a previously working or safe product
outcome.

## Read the implementation

| Source                                                                                                                                                    | What to inspect                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`paymentTools.ts`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/src/webmcp/paymentTools.ts)                           | Tool definitions, controls, registration, and cleanup |
| [`PrivateRoutesContainer.tsx`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/src/containers/PrivateRoutesContainer.tsx) | Authenticated React ownership                         |
| [`webmcp-routes.ts`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/backend/webmcp-routes.ts)                            | Backend context, payment, and authoritative reads     |
| [`signet-payment.spec.ts`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/cypress/tests/webmcp/signet-payment.spec.ts)   | End-to-end safety assertions                          |
| [`nativeWebMcpSmoke.mjs`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/scripts/nativeWebMcpSmoke.mjs)                  | Native Chrome discovery and invocation                |
| [`eval/cases.mjs`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/eval/cases.mjs)                                        | Reusable intents, expectations, and safety properties |
| [`eval/oracle.mjs`](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/eval/oracle.mjs)                                      | Database snapshots and authoritative Trial grades     |

The vendored application has a more detailed
[integration runbook](https://github.com/kartik-hegde/signet/blob/main/fixtures/cypress-realworld-app/SIGNET.md).

Next, run the [Cal.diy booking codelab](../tutorials/cal-diy), then use the
[patterns from Cal.diy and Saleor](./integration-patterns) to decide which abstractions
another application needs.

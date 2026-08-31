# A real Saleor checkout, exposed safely to agents

Saleor is a production-grade, open-source commerce platform. We integrated Signet into
its official Next.js storefront—not a purpose-built fixture—to test whether a browser
agent could complete a real checkout without bypassing the application's existing
business logic or user experience.

The result is a five-tool checkout capability:

| Tool                     | Effect                                        |
| ------------------------ | --------------------------------------------- |
| `inspect_checkout`       | Reads live lines, contact, total and currency |
| `set_checkout_contact`   | Updates guest email and shipping address      |
| `list_delivery_options`  | Calculates eligible Saleor delivery methods   |
| `select_delivery_option` | Selects one delivery method                   |
| `place_order`            | Confirms, pays and creates exactly one order  |

You can [browse the complete integration branch](https://github.com/kartik-hegde/storefront/tree/feat/signet-webmcp-demo).
It is also maintained as a pinned upstream revision plus a reviewable patch in the
[Signet benchmarks repository](https://github.com/kartik-hegde/signet-benchmarks/tree/feat/test-agent-evidence/apps/saleor).
That keeps Saleor's source and license authoritative while making the experiment
reproducible.

## The application remains in control

Each tool calls the storefront's existing server actions, checkout provider and payment
adapter. Signet owns the narrow agent boundary: runtime schemas, lifecycle registration,
authorization ordering, duplicate coordination, confirmation, recovery, verification
and privacy-safe events. It does not duplicate Saleor's checkout engine.

The React composition layer creates one Signet instance, the shipped
`IndexedDbIdempotencyStore` and a session-scoped operation journal. Tool definitions
live in a plain TypeScript module with an injected Saleor action boundary, while the
optional demo panel is isolated from the production boundary.

## The consequential path

`place_order` demonstrates the full safety path:

```text
validate input and current checkout
  -> authorize the active checkout
  -> atomically acquire the operation key
  -> ask the shopper to approve a new effect
  -> record that payment started
  -> execute Saleor's configured payment adapter
  -> journal the resulting order ID
  -> read the order back from Saleor
  -> verify paid state, email, lines, total and currency
```

Confirmation uses `mode: "effect-only"`. An exact replay still resolves current context,
authorizes and verifies the stored result, but does not ask the shopper to approve an
effect that will not run.

## Proving the ambiguous case

The demo includes a one-shot lost-response fault after Saleor commits the order but
before the tool returns. Recovery reads the journaled order ID, queries Saleor's
authoritative database through the application action, verifies the requested outcome
and stores the recovered result for later replay.

If payment started but the integration cannot correlate or verify an order, Signet
returns the non-retryable `outcome_unknown` error. The agent is told to reconcile under
the same operation key instead of creating a duplicate order with a new key.

The benchmark's oracle independently queries PostgreSQL and requires exactly one paid
order with the expected email, line count, amount and currency. The browser response is
therefore not the grader.

## What the integration taught us

Four library changes came directly from this exercise:

1. Confirmation needed a replay-aware mode. Prompting before an idempotency lookup made
   safe retries annoying and semantically misleading.
2. Recovery needed an explicit unknown outcome. “Not recovered” cannot distinguish a
   proven failure from a payment whose final state cannot be read.
3. Execute and recovery needed a shared operation journal. Ad hoc storage works for a
   demo, but a small typed correlation contract is clearer, testable and replaceable by
   durable application storage.
4. The store could not decide whether a thrown handler failed before or after payment.
   Idempotency therefore became phased: the guard releases only a journal-proven
   pre-effect failure and preserves abandoned in-flight work for recovery after reload.

The integration now imports its IndexedDB adapter from `@signet/webmcp/stores`; the
test-only memory store remains explicitly unsafe for real effects. Its unit tests run
all five definitions through `assertToolReady`, then exercise replay, concurrent calls,
reload recovery, stale totals and invented arguments through the WebMCP test harness.

The resulting API stays deliberately small: applications still choose keys, consent
UI and authoritative verification. Signet supplies the conservative browser store and
makes the ordering and failure semantics hard to get wrong.

# Patterns from real integrations

Cal.diy booking and Saleor checkout are different products, but their Signett
integrations have the same shape. This page turns that shape into a repeatable
integration sequence and shows exactly which abstractions each tool uses.

## The common sequence

### 1. Choose a page-scoped user capability

Start from something the human site already knows how to do. Find:

- the existing application function or server action;
- the trusted session and active-resource state;
- an authoritative read that can prove the final result;
- the component or route that owns the capability's lifetime.

Do not begin by designing an agent-only backend. Both integrations reuse the same
application operations and state as the human interface.

### 2. Give the agent authoritative discovery tools

Before a mutation, expose the state and identifiers needed to call it correctly.

Cal.diy exposes `inspect_event` and `list_available_slots`. Saleor exposes
`inspect_checkout` and `list_delivery_options`. These are small read tools with:

- the four required tool fields;
- closed input schemas;
- `annotations: { readOnlyHint: true }`;
- bounded, structured output.

This creates an explicit workflow:

```text
inspect current state -> list valid choices -> perform one bounded action
```

### 3. Resolve live application context

Create one stable Signett interface for the page and resolve current state on every
invocation:

```ts
const signett = createSignett({
  context: () => readCurrentPageContext(),
});
```

Cal.diy context includes the active event type, duration, price, and recurrence.
Saleor context includes the checkout ID, email, line count, total, and currency.

The agent supplies intent. The application supplies identity and live state.

### 4. Match controls to the effect

Use the smallest control set that answers the risks of that tool:

| Tool kind                                 | Required Signett abstractions                                                |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Read current state                        | Tool definition, closed schema, read-only annotation, lifecycle             |
| Reversible update                         | Context, authorization when relevant, execution, authoritative verification |
| Irreversible or externally visible effect | Confirmation, idempotency, operation journal, recovery, verification        |

Idempotency and journals are a pair. Signett rejects idempotency without a journal
because an execution error otherwise cannot prove whether the operation is safe to
release or must remain recoverable.

### 5. Keep definitions separate from framework composition

Both integrations define tool objects in plain TypeScript and inject application
dependencies. A small client component then owns live state, creates stores and the
Signett interface, and registers tools with `useSignettTool()`.

That separation makes the definitions easy to test without rendering the full
application and keeps React lifecycle details out of business policy.

### 6. Test invariants before model behavior

Use `createWebMcpTestHarness()` to prove:

- the schema rejects invented input before application work;
- authorization denial causes no effect;
- equal concurrent intent causes one effect;
- different intent does not collapse;
- a lost response is recovered from authoritative state;
- an ambiguous effect becomes `outcome_unknown`;
- verification runs after execution, replay, and recovery;
- disposal removes the tools.

Then exercise representative tasks through a supported native browser agent.

## Cal.diy: booking an event

The Cal.diy integration exposes three tools:

| Tool                   | Signett abstractions                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `inspect_event`        | Tool definition, empty closed schema, read-only annotation                                                    |
| `list_available_slots` | Bounded input/output, read-only annotation, live page state                                                   |
| `book_event`           | Context, authorization, effect-only confirmation, idempotency, journal, recovery, verification, output budget |

### Booking sequence

1. `inspect_event` returns the event ID, organizer, duration, price, and recurrence.
2. `list_available_slots` returns only future slots already visible to the Booker.
3. `book_event` requires the inspected event ID and duration as expectations.
4. `authorize` rejects a stale event, paid event, or unsupported recurring event.
5. `confirm` shows the application-owned booking review only for a fresh effect.
6. The idempotency key binds event, operation ID, slot, time zone, attendee, and
   duration.
7. The journal records effect start and then the returned booking UID.
8. Recovery queries Cal.diy by the correlation fields and accepts only one unique
   booking.
9. Verification checks the event, attendee, start time, and duration against
   authoritative booking state.

The mutation still calls Cal.diy's existing form validation, booking mapper, and
`createBooking()` path. Signett does not reproduce scheduling logic.

The reviewed implementation is on the Cal.diy integration branch
`feat/signett-webmcp-demo` at commit `f2b1fc9`. Start with
`apps/web/modules/bookings/signett/tools.ts` and
`apps/web/modules/bookings/signett/SignettBookerTools.tsx`. The branch is not currently
published on the `calcom/cal.diy` remote, so a stable public source link must be added
after it is pushed.

## Saleor: completing checkout

The Saleor integration exposes a five-tool workflow:

| Tool                     | Signett abstractions                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `inspect_checkout`       | Tool definition, empty closed schema, read-only annotation                                           |
| `set_checkout_contact`   | Context, active-checkout authorization, verification                                                 |
| `list_delivery_options`  | Bounded structured read, read-only annotation                                                        |
| `select_delivery_option` | Context, active-checkout authorization, verification                                                 |
| `place_order`            | Authorization, effect-only confirmation, idempotency, journal, recovery, verification, output budget |

### Checkout sequence

1. `inspect_checkout` returns line count, customer email, total, and currency.
2. `set_checkout_contact` calls the existing Saleor email and address operations, then
   verifies refreshed checkout state.
3. `list_delivery_options` returns eligible IDs and bounded delivery details.
4. `select_delivery_option` applies one returned ID and verifies it through a fresh
   checkout read.
5. `place_order` requires the exact previously observed total and currency.
6. `authorize` requires an active checkout, while mutable eligibility stays inside
   execution so replay remains reachable.
7. `confirm` shows the shopper the live item count, email, amount, and currency only
   for a fresh effect.
8. The journal records payment start and then the resulting order ID.
9. Recovery refuses to guess when payment started without a correlated order.
10. Verification reads the order and proves paid state, shopper, lines, total, and
    currency.

The integration calls the storefront's existing checkout provider, server actions,
and configured payment adapter. Saleor remains the source of truth.

[Browse the Saleor integration branch](https://github.com/kartik-hegde/storefront/tree/feat/signett-webmcp-demo),
starting with
[`checkout-tools.ts`](https://github.com/kartik-hegde/storefront/blob/feat/signett-webmcp-demo/src/checkout/signett/checkout-tools.ts)
and
[`signett-checkout-tools.tsx`](https://github.com/kartik-hegde/storefront/blob/feat/signett-webmcp-demo/src/checkout/signett/signett-checkout-tools.tsx).

The [Saleor case study](../case-studies/saleor) explains the lost-response and payment
recovery findings in more depth.

## A practical decision checklist

For each new tool, answer these questions in order:

1. What single user intent does the tool expose?
2. Which page or authenticated state owns its registration?
3. Which input is agent intent, and which state must come from the application?
4. Is the operation a read, reversible update, or consequential effect?
5. What current policy belongs in `authorize`?
6. Does a person need to review a fresh effect?
7. Which fields define identical intent for the idempotency key?
8. What minimal correlation can prove an interrupted outcome?
9. Which authoritative read proves the requested postcondition?
10. Which deterministic tests prove denial, concurrency, recovery, verification, and
    teardown?

If questions 7–9 have no good answers, the consequential tool is not ready to expose.
Start with its discovery tools or improve the application boundary first.

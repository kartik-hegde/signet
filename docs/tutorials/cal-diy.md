# Codelab: book a real Cal.diy event

This codelab runs the Signet benchmark against a local Cal.diy application. A real
browser agent discovers an event, selects an available slot, accepts the application's
confirmation, creates one booking, recovers from an intentionally lost response, and
proves the result in Postgres.

This is intentionally the last codelab. It requires the full application and database;
the earlier tutorials isolate Signet mechanics from Cal.diy setup.

## What the integration exposes

| Tool                   | Why it exists                                                            | Signet controls                                                                                   |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `inspect_event`        | Read the active event, organizer, duration, price, and recurrence        | Closed empty schema, live page context, read-only hint                                            |
| `list_available_slots` | Return valid future choices instead of asking the model to invent a time | Bounded input and output, read-only hint                                                          |
| `book_event`           | Create one booking for the selected slot                                 | Context, authorization, confirmation, idempotency, journal, recovery, verification, output budget |

The intended call sequence is:

```text
inspect_event -> list_available_slots -> book_event
```

The mutation requires the event ID and duration observed earlier. That turns stale page
state into an explicit authorization failure rather than a surprising booking.

## 1. Prepare the sibling checkouts

The benchmark expects these repositories next to one another:

```text
workspace/
  cal-diy-signet/
  signet/
  signet-benchmarks/
```

Use the Cal.diy integration branch `feat/signet-webmcp-demo` at commit `f2b1fc9`.
That branch is currently local and is not published on the `calcom/cal.diy` remote, so
there is no stable public branch link yet. The implementation files to inspect are:

```text
apps/web/modules/bookings/signet/tools.ts
apps/web/modules/bookings/signet/SignetBookerTools.tsx
```

Start Cal.diy and its Postgres database using the repository's normal local development
instructions. The recorded fixture uses the public 30-minute event at
`http://127.0.0.1:3000/pro/30min`; use another public, free, non-recurring event by
setting the override below.

## 2. Configure the booking URL

From `signet-benchmarks`, set the local booking page when it differs from the default:

```sh
export CAL_DIY_BOOKING_URL="http://localhost:3000/your-user/your-event"
```

Optional overrides are `CAL_DIY_MODEL`, `CAL_DIY_REASONING`, and `CHROME_PATH`. The
default provider uses an authenticated Codex CLI session; it does not require placing
an API key in the Cal.diy page.

## 3. Run the preflight

```sh
npm run cal-diy:preflight
```

The preflight checks that the application, browser, event page, database, and provider
are reachable before an agent can create anything. Fix preflight failures before
continuing.

## 4. Prove the native browser boundary

```sh
npm run cal-diy:native-smoke
```

This launches Chrome with native WebMCP enabled, opens the booking page, and verifies
that the three page tools are discoverable and callable. It does not rely on DOM
selectors as a substitute for WebMCP.

## 5. Run the agent booking

```sh
npm run cal-diy:agent
```

The runner gives the agent only the page's native WebMCP tools through its bridge. It
records the booking count before the run, requires application-owned confirmation for
the fresh effect, injects a lost response after commit, and then checks the final
database state.

A successful trace has these properties:

1. the agent uses `inspect_event` before choosing arguments;
2. the selected start time came from `list_available_slots`;
3. the person approves the exact booking summary once;
4. `book_event` creates one booking;
5. recovery finds that booking after the simulated transport failure; and
6. the Postgres oracle changes from zero matching bookings to exactly one.

The benchmark writes its agent transcript, native tool calls, timings, confirmation,
and oracle result to the run artifacts. Treat the database oracle—not the model's final
sentence—as proof of success.

## How the application integration works

`SignetBookerTools.tsx` owns the page lifecycle, resolves the current event context,
creates the stores, and registers plain TypeScript tool definitions. `book_event` calls
Cal.diy's existing validation, booking mapper, and `createBooking()` path; Signet does
not duplicate scheduling logic.

Before the effect, the operation journal stores a correlation record. After the effect,
it stores the booking UID. If the response disappears, `recover` queries authoritative
Cal.diy state using those fields and only accepts one unique match. `verify` then checks
event, attendee, start time, and duration before Signet reports success.

Use the [integration patterns](../guide/integration-patterns) page to translate this
design to another application. It includes the equivalent Saleor checkout sequence and
a control-by-control decision checklist.

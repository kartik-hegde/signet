# Case study: a real agent books Cal.diy safely with Signett

## Result

A real Codex agent completed a live booking through Cal.diy's existing `/api/book/event` path. The run deliberately discarded the mutation response after Cal.diy committed. Signett recovered the booking from an independent server-side lookup, validated the returned proof, and reported success without issuing a second mutation.

The independent Postgres oracle observed zero matching bookings before the run and exactly one afterward:

| Measure                            | Recorded value                                          |
| ---------------------------------- | ------------------------------------------------------- |
| Agent                              | `gpt-5.4-mini`, low reasoning                           |
| Duration                           | 6,433 ms                                                |
| Tool sequence                      | `inspect_event` → `list_available_slots` → `book_event` |
| Approval prompts                   | 1                                                       |
| Booking UID                        | `388TuxL2dosV6DCzczKMUT`                                |
| Booking status                     | `accepted`                                              |
| Event type / duration              | 3 / 30 minutes                                          |
| Database count before / after      | 0 / 1                                                   |
| Shell or filesystem calls by agent | 0                                                       |

Machine-readable evidence is in `evidence/cal-diy/latest.json`. Raw agent and browser traces are excluded from the working tree and remain recoverable from the imported benchmark Git history.

## What was integrated

The Cal.diy checkout is based on `176037d0afbe572f870a3c702985e7cd83fe6c0c`. The integration adds three page-scoped native WebMCP tools to the public Booker:

1. `inspect_event` reads the live event ID, title, organizer, duration, price, and recurrence state.
2. `list_available_slots` reads the Booker's current slot data and returns only future start times.
3. `book_event` maps a typed input into Cal.diy's existing booking-form mutation.

The read tools have read-only annotations. `book_event` is the sole consequential capability and passes through Signett's full guard pipeline:

```text
validate → authorize → confirm → claim idempotency key
         → journal intent → mutate → recover if ambiguous
         → validate output → independently verify → complete
```

The authorization rule allows only the event that the agent inspected, with the same duration, and only when it is free and non-recurring. The effect-only confirmation displays the concrete event, time, and attendee before any booking is sent. The idempotency key binds the operation ID to the event, start, timezone, attendee email, and duration, so an operation ID cannot be safely reused for a different intent.

## Recovery and verification

Immediately before mutation, the integration journals the event ID, start time, and attendee email. After Cal.diy returns a UID, it journals that UID too. The benchmark then injects an exception at exactly that boundary to model a committed request whose response was lost.

Signett invokes `recover`, which calls a server action that queries Prisma by the journaled correlation. Recovery succeeds only for one unique match. Zero or multiple matches produce `outcome_unknown`, which prevents a blind retry. A separate `verify` lookup checks the UID, event ID, attendee, start time, and derived duration before Signett marks the operation complete.

The operation journal uses session storage. The idempotency record uses IndexedDB and Web Locks, which gives durable replay and live-owner coordination within the local browser profile. This is appropriate for the proof, but a production deployment that must coordinate across devices or browser profiles should move the claim to an app-owned server-side store.

## Experimental method

The runner creates a clean Chrome profile and waits until all three tools are registered. It arms the lost-response fault, then launches an ephemeral Codex CLI process with only the page's application tools exposed. The prompt requires inspection, live-slot selection, one fixed operation ID, and exactly-once booking. JavaScript approval dialogs are recorded and accepted by the authorized harness.

Chrome's experimental DevTools WebMCP domain supplies the native tool inventory and invocation channel. The benchmark MCP bridge translates those browser tools for the agent while recording every call. The grade does not trust the agent's final answer or the tool's success text: it queries the Cal.diy Postgres container directly for the fixed attendee and checks count, event type, and duration.

The passing lifecycle was:

```text
registering → registered → started → validated → authorized
→ confirmation_requested → confirmed → recovered
→ output_validated → verified → succeeded
```

A deterministic native smoke test also invokes the same booking input twice after the injected fault. It observes one approval, one recovered UID, the same UID on replay, and the additional `replayed` lifecycle stage.

## Failure behavior observed

The first real-agent attempt stalled before issuing a tool call. The harness timed it out, the trace showed only registration and inventory, and the database oracle remained at zero. A minimal agent probe then passed, and an identical retry produced the successful result above. This distinguishes an upstream model-turn stall from a mutation or guard failure and demonstrates fail-closed behavior for that attempt.

During setup, Cal.diy's root CI type-check entry point also hit an upstream Node 26 incompatibility in Prisma's postinstall path (`fs.rmdir` with recursive mode). Building the required tRPC types directly and running the web workspace type-check avoided changing upstream application code. Focused Signett booking tests and the web type-check both pass.

## Reproduction boundary

- Cal.diy base: `176037d0afbe572f870a3c702985e7cd83fe6c0c`
- Cal.diy integration: `f2b1fc9b66f2f718286f4e79cae52b008d415b2f`
- Signett: `87318dde1fbcb8a6677f4a49a8bd1d01b1165394`
- Chrome: `151.0.7922.174`
- Codex CLI: `0.135.0`
- Database: the seeded local Cal.diy Postgres Compose service

The runner records both the application commit and a SHA-256 fingerprint of any remaining diff. The final recorded run uses the clean integration commit above, so its application diff fingerprint is the SHA-256 of an empty value.

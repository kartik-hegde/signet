# Design contract

## Product boundary

Signet helps applications expose capabilities to agents through native WebMCP. It is
developer tooling around the standard, not an alternate agent protocol, application
framework, or production browser polyfill.

The toolkit should remain:

1. **Native-first.** Tools register through `document.modelContext.registerTool()` and
   retain official WebMCP fields and behavior.
2. **Capability-oriented.** Start from functions and endpoints the application already
   owns, then design reusable tools around real user journeys.
3. **Inspectable.** A developer can see the exact tool inventory, schemas, annotations,
   lifecycle, calls, and local results available to an agent.
4. **Agent-tested.** Tests cover discovery, selection, arguments, continuation, and
   authoritative outcomes in addition to TypeScript behavior.
5. **Progressively hardened.** Public reads remain simple. Authenticated or mutating
   tools add only the execution controls they need.
6. **Application-owned.** Identity, policy, storage, confirmation UI, validation, and
   business logic remain application concerns.
7. **Ejectable.** Definitions and generated code stay understandable and usable without
   a hosted Signet runtime.
8. **Private by default.** No network behavior, global patches, or production input and
   output capture occurs implicitly.

## Exposure path

The target product path is:

```text
application function or endpoint
  -> native-shaped tool definition and runtime validation
  -> explicit WebMCP registration and lifecycle
  -> local inspection and deterministic tests
  -> native browser and agent evaluation
  -> optional execution controls
```

Signet may make native registration easier, but it must not conceal origin options,
registration signals, execution signals, schemas, annotations, or unsupported-browser
status.

## Optional execution controls

The current `guard()` performs a fixed sequence when a tool warrants it:

```text
resolve app context
  -> authorize
  -> atomically execute or replay
  -> optionally recover a proven outcome after an execution error
  -> verify observed outcome
  -> return
```

The underlying handler receives the original execution signal. Backend validation and
authorization remain authoritative. Idempotency depends on a correctly scoped key and
an injected store with appropriate durability; it is not an exactly-once claim.

## Explicit non-goals for the first exposure release

- Inferring a production mutation from a website crawl
- Inventing a Signet discovery protocol or mandatory response envelope
- Providing a production browser polyfill
- Retrying state-changing operations automatically
- Treating browser-side authorization as sufficient
- Owning confirmation, checkout, or conversational UX
- Shipping a hosted control plane or registry
- Supporting multiple agent protocols before a real integration asks for one
- Claiming exactly-once execution

## Conditions for adding an abstraction

A new public abstraction must:

1. enable inspection/testing or remove repeated defects in a real integration;
2. preserve the underlying WebMCP contract and application handler;
3. have a clear removal story;
4. remain narrower than the application concern it coordinates.

Framework adapters, generators, lint rules, and new protocol adapters additionally need
evidence from multiple applications before they become stable surface area.

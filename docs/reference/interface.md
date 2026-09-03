# Interface API

## `createSignett(options?)`

Creates one WebMCP-facing application interface.

Options:

- `context`: resolves trusted application context for each invocation;
- `observe`: receives privacy-safe registration and execution lifecycle events;
- `unsupported`: `ignore`, `warn`, or `throw` when WebMCP is unavailable;
- `modelContext`: injectable native boundary for deterministic tests.
- `telemetry`: optional dependency-free OTLP/HTTP JSON export; set `otlp` and
  optionally `serviceName`, `headers`, resource attributes, batching interval, and
  queue size.

Unsupported behavior defaults to `ignore` so production visitors without experimental
WebMCP retain a quiet human experience. Use `warn` during integration and `throw` in
strict tests.

## `interface.expose(tool)`

Validates and registers one tool. It returns a promise for a disposable registration.

Required tool fields:

- `name`;
- `description`;
- `inputSchema`;
- `execute`.

Optional native fields:

- `title`;
- `annotations`;
- `exposedTo`.

Optional Signett controls:

- `authorize`;
- `confirm`;
- `idempotency`;
- `journal`;
- `recover`;
- `verify`;
- `verifyTimeoutMs`;
- `outputBudgetBytes`.

The execution callback receives the validated input plus application `context`, an
optional scoped `operation` journal handle, and the native WebMCP `AbortSignal`.

`recover` runs only after the application handler throws. It receives the original
error and may return `{ recovered: true, output }` after proving the outcome from
authoritative state. `{ recovered: false }` preserves the original error. An explicit
`{ recovered: false, outcome: "unknown" }` throws `OutcomeUnknownError`; a recovery
read that throws does the same. Signett does not retry the operation or conceal
idempotency-store failures.

A function-valued `confirm` runs after authorization and before idempotency. The
`{ mode: "effect-only", request }` form runs only when the store starts a new effect,
so replay does not ask twice. The application owns and renders the consent experience.

`journal` connects an app-provided `OperationJournal` to the invocation. Its handle is
available to execute, recover, and verify. A missing journal key reuses the idempotency
key; without either key the definition fails before any effect.

`outputBudgetBytes` measures the JSON-serialized result after execution or replay and
before verification. Oversized or unmeasurable output emits a lifecycle diagnostic and
logs a warning, but never converts a completed operation into failure. Treat the budget
as a testable design constraint and return a smaller projection.

## Inventory and observation

`interface.tools()` returns metadata-only snapshots of the interface's current tools.
`interface.observe(listener)` subscribes to registration and execution events and
returns an unsubscribe function. Inputs, outputs, context, and stack traces are not
captured implicitly.

`createSignettActivity(signett, options?)` attaches a metadata-only presentation feed to
those events. Use `toolName` to retain one exact tool and `maxInvocations` to bound the
newest-first history; the default is 20. `getSnapshot()` returns `latest` plus
`invocations`, `subscribe(listener)` reports snapshot changes, and `dispose()` stops
observation. See the [application activity guide](../guide/application-activity) for
the React hook, phase semantics, refresh pattern, and safety boundaries.

When `telemetry` is configured, `interface.telemetry` exposes `flush()` and
`shutdown()` for tests and explicit application teardown. Normal browser code can let
the bounded exporter flush on its configured interval.

## Registration

A registration exposes `name`, `status`, `dispose()`, and
`[Symbol.dispose]()`. Disposal is idempotent and unregisters the native tool through
its registration signal.

Tool names are unique per WebMCP model context, including across separate
`createSignett()` calls.

## Errors

Invalid definitions reject before registration. Invalid invocation input throws
`ValidationError`. Expected application failures may use `ToolError`. Signett does
not retry operations automatically.

See [Getting started](../guide/getting-started) for the smallest example and
[Core concepts](../guide/core-concepts) for each optional control.

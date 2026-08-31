# Interface API

## `createSignet(options?)`

Creates one WebMCP-facing application interface.

Options:

- `context`: resolves trusted application context for each invocation;
- `observe`: receives privacy-safe registration and execution lifecycle events;
- `unsupported`: `ignore`, `warn`, or `throw` when WebMCP is unavailable;
- `modelContext`: injectable native boundary for deterministic tests.

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

Optional Signet controls:

- `authorize`;
- `confirm`;
- `idempotency`;
- `recover`;
- `verify`;
- `verifyTimeoutMs`;
- `outputBudgetBytes`.

The execution callback receives the validated input plus application `context` and
the native WebMCP `AbortSignal`.

`recover` runs only after the application handler throws. It receives the original
error and may return `{ recovered: true, output }` after proving the outcome from
authoritative state. `{ recovered: false }` preserves the original error. Signet does
not retry the operation or conceal idempotency-store failures.

`confirm` runs after authorization and before idempotency. The application owns and
renders the consent experience; Signet only sequences and observes it.

`outputBudgetBytes` measures the JSON-serialized result after execution or replay and
before verification. Oversized or unmeasurable output emits a lifecycle diagnostic and
logs a warning, but never converts a completed operation into failure. Treat the budget
as a testable design constraint and return a smaller projection.

## Inventory and observation

`interface.tools()` returns metadata-only snapshots of the interface's current tools.
`interface.observe(listener)` subscribes to registration and execution events and
returns an unsubscribe function. Inputs, outputs, context, and stack traces are not
captured implicitly.

## Registration

A registration exposes `name`, `status`, `dispose()`, and
`[Symbol.dispose]()`. Disposal is idempotent and unregisters the native tool through
its registration signal.

Tool names are unique per WebMCP model context, including across separate
`createSignet()` calls.

## Errors

Invalid definitions reject before registration. Invalid invocation input throws
`ValidationError`. Expected application failures may use `ToolError`. Signet does
not retry operations automatically.

See [Getting started](../guide/getting-started) for a complete example.

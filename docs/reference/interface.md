# Interface API

## `createSignet(options?)`

Creates one WebMCP-facing application interface.

Options:

- `context`: resolves trusted application context for each invocation;
- `observe`: receives privacy-safe registration and execution lifecycle events;
- `unsupported`: `ignore`, `warn`, or `throw` when WebMCP is unavailable;
- `modelContext`: injectable native boundary for deterministic tests.

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
- `idempotency`;
- `verify`.

The execution callback receives the validated input plus application `context` and
the native WebMCP `AbortSignal`.

## Registration

A registration exposes `name`, `status`, `dispose()`, and
`[Symbol.dispose]()`. Disposal is idempotent and unregisters the native tool through
its registration signal.

## Errors

Invalid definitions reject before registration. Invalid invocation input throws
`ValidationError`. Expected application failures may use `ToolError`. Signet does
not retry operations automatically.

See [Getting started](../guide/getting-started) for a complete example.

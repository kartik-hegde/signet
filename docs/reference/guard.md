# `guard()`

Wraps a normal WebMCP-compatible execute function with selected application controls.

```ts
function guard<Input, Output, Context = undefined>(
  execute: Execute<Input, Output>,
  options?: GuardOptions<Input, Output, Context>,
): Execute<Input, Output>;
```

The returned function preserves the application's output and propagates the browser's
execution `AbortSignal`.

## `execute`

```ts
type Execute<Input extends Record<string, unknown>, Output> = (
  input: Input,
  options: { signal: AbortSignal },
) => Output | Promise<Output>;
```

Application errors are rethrown unchanged.

## Options

### `name`

Optional stable operation name used only in lifecycle events.

### `context`

```ts
context?: (input, options) => Context | Promise<Context>;
```

Resolves application session, principal, tenant, resource, or service context. Signet
does not resolve identity implicitly.

### `authorize`

```ts
authorize?: ({ input, context, signal }) =>
  | boolean
  | { allowed: boolean; reason?: string }
  | Promise<boolean | AuthorizationDecision>;
```

A false decision throws `AuthorizationError` before execution. Authorization is
re-evaluated before every idempotency lookup, including replay. Mutable eligibility
that the operation itself changes belongs inside the executed operation.

### `confirm`

```ts
confirm?: ({ input, context, signal }) =>
  | boolean
  | { confirmed: boolean; reason?: string };
```

Runs after authorization and before idempotency. A false decision throws
`ConfirmationError`. The application owns the consent UI.

### `idempotency`

```ts
idempotency?: {
  key: ({ input, context, signal }) => string | Promise<string>;
  store: IdempotencyStore;
};
```

The key must not be empty. The store atomically executes or returns a prior result and
reports whether it was replayed.

### `verify`

```ts
verify?: ({ input, output, context, replayed, recovered, signal }) =>
  | boolean
  | { verified: boolean; reason?: string }
  | Promise<boolean | VerificationDecision>;
```

A false decision throws `VerificationError` after execution, replay, or recovery.

### `recover`

```ts
recover?: ({ input, context, error, signal }) =>
  | { recovered: true; output: Output }
  | { recovered: false }
  | Promise<RecoveryDecision<Output>>;
```

Runs after the application handler throws. Use it to read authoritative state when the
effect may have committed but its response was lost. A recovered output is cached by
the configured idempotency store and proceeds through `verify`; returning
`recovered: false` preserves the original error. Signet never retries automatically or
conceals an idempotency-store failure.

### `observe`

```ts
observe?: (event: GuardEvent) => void | Promise<void>;
```

Receives lifecycle metadata, never inputs or outputs. Synchronous throws and asynchronous
rejections are contained and do not change application behavior.

### `maxOutputBytes`

Rejects results whose JSON serialization exceeds a positive integer byte ceiling.

### `invocationId` and `now`

Injectable factories for deterministic tests. They are not called when no observer is
configured.

## Lifecycle stages

```text
started
authorized       when authorization is configured
confirmation_requested|confirmed|declined when confirmation is configured
executed|replayed|recovered
output_validated when a byte ceiling is configured
verified         when verification is configured
succeeded|failed
```

See the exported TypeScript declarations for the complete structural types.

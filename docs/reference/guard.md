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
  options: { signal: AbortSignal; operation?: OperationHandle },
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

To avoid prompting again for an already stored result:

```ts
confirm: {
  mode: "effect-only",
  request: ({ input, context, signal }) => review(input, context, signal),
}
```

`effect-only` confirmation runs inside the store's new-operation callback. Replays and
coalesced callers do not prompt or execute again. A function-valued `confirm` retains
the original always-confirm behavior.

### `idempotency`

```ts
idempotency?: {
  key: ({ input, context, signal }) => string | Promise<string>;
  store: IdempotencyStore;
};
```

The key must not be empty. The store atomically returns `fresh`, `in_flight`, or a
`completed` result. Signet executes only a fresh claim. It recovers abandoned in-flight
work without executing again, completes recovered results, and returns
`OutcomeUnknownError` when recovery cannot prove the outcome. It calls `release` only
when an empty configured journal proves the handler failed before the effect boundary;
otherwise it calls `abandon` and preserves the durable claim.

### `journal`

```ts
journal?: {
  key?: ({ input, context, signal }) => string | Promise<string>;
  store: OperationJournal;
};
```

Creates an invocation-scoped `operation` handle for execution, recovery, and
verification. The handle provides `key`, `read()`, `write(entry)`, and `remove()`.
When `key` is omitted, the configured idempotency key is reused.

Journal access uses a separate finalization signal so a correlation write after an
irreversible effect is not discarded by late caller cancellation. Stores must provide
their own bounded I/O behavior. See [Operation journals](../guide/operation-journal).

### `verify`

```ts
verify?: ({ input, output, context, replayed, recovered, signal }) =>
  | boolean
  | { verified: boolean; reason?: string }
  | Promise<boolean | VerificationDecision>;
```

A false decision throws `VerificationError` after execution, replay, or recovery.
Once execution completes, verification receives an independent finalization signal so
late caller cancellation cannot misreport a real effect as cancelled. Set the optional
positive integer `verifyTimeoutMs` to bound this stage; Signet rejects at that deadline
with `VerificationError` and aborts the signal supplied to the verifier. Without it,
the verifier must settle on its own. The original invocation signal never cancels
finalization.

### `recover`

```ts
recover?: ({ input, context, error, operation, signal }) =>
  | { recovered: true; output: Output }
  | { recovered: false }
  | { recovered: false; outcome: "unknown"; reason?: string }
  | Promise<RecoveryDecision<Output>>;
```

Runs after the application handler throws or when a durable in-flight record has no
live owner. Use it to read authoritative state when the effect may have committed but
its response was lost. A recovered output is cached by the configured idempotency store
and proceeds through `verify`. With idempotency configured, `recovered: false` preserves
the original error only when a configured journal is empty and therefore proves a
pre-effect failure. Otherwise the outcome is unknown. Signet never retries the effect
automatically. Explicitly returning `outcome: "unknown"`, or throwing while
authoritative recovery is running, produces `OutcomeUnknownError` and the terminal
`outcome_unknown` lifecycle stage.

### `observe`

```ts
observe?: (event: GuardEvent) => void | Promise<void>;
```

Receives lifecycle metadata, never inputs or outputs. Synchronous throws and asynchronous
rejections are contained and do not change application behavior.

### `outputBudgetBytes`

Measures JSON-serialized results against a positive integer byte budget. An oversized
or unmeasurable result emits a lifecycle diagnostic and warns, but the completed result
is preserved.

### `invocationId` and `now`

Injectable factories for deterministic tests. They are not called when no observer is
configured.

## Lifecycle stages

```text
started
authorized       when authorization is configured
confirmation_requested|confirmed|declined when confirmation is configured
executed|replayed|recovered
output_validated|output_oversized|output_unmeasurable when a budget is configured
verified         when verification is configured
succeeded|failed|outcome_unknown
```

See the exported TypeScript declarations for the complete structural types.

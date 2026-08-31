# Production checklist

Use this before shipping an authenticated or state-changing WebMCP tool.

## Native integration

- [ ] Register through `document.modelContext.registerTool()`.
- [ ] Use the official `webmcp-types` declarations.
- [ ] Abort the registration signal when the tool should disappear.
- [ ] Keep the human interface usable without WebMCP.
- [ ] Register only in page and authentication states where the tool makes sense.

## Input and policy

- [ ] Treat agent input as untrusted and validate it at runtime.
- [ ] Resolve the current principal and tenant from application-owned state.
- [ ] Authorize the exact resource, operation, and relevant input.
- [ ] Repeat validation and authorization on the backend.
- [ ] Avoid credentials and secrets in schemas, descriptions, and outputs.

## Mutations

- [ ] Define a stable, correctly scoped idempotency key.
- [ ] Coordinate duplicate work atomically in durable storage.
- [ ] Verify the intended state independently when false success matters.
- [ ] Preserve the `AbortSignal` through cancellable work.
- [ ] Do not assume cancellation proves that no effect occurred.
- [ ] Use existing application review or confirmation UX for consequential actions.

## Concurrency and operations

- [ ] Prove identical concurrent keys produce one effect.
- [ ] Prove different keys can execute concurrently.
- [ ] Define retention and recovery behavior for idempotency records.
- [ ] Keep inputs and outputs out of default telemetry.
- [ ] Decide how support and users see indeterminate outcomes.

## Testing

- [ ] Denied callers cannot reach the handler.
- [ ] Context and policy failures fail closed.
- [ ] Execution and replay both run verification.
- [ ] Application errors preserve their identity.
- [ ] Telemetry failure cannot break the operation.
- [ ] Native discovery, invocation, visible state, and cleanup work in each target agent.

See [Testing WebMCP actions](./guide/testing) for examples.

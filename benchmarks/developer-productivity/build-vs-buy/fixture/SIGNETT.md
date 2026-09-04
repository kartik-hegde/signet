# Condition: Signett

Use `signett` and its `createSignett` interface to implement the requirements.
The package is installed locally. Do not reimplement Signett's validation, guard,
registration lifecycle, or observation machinery in application code.

The `$signett-webmcp` project skill is installed and contains the complete,
authoritative integration contract. Use it. Do not inspect package implementation,
declaration, recipe, or README files unless the skill contradicts an observed test
result.

Return the registration from `await signett.expose(...)` directly. Pass `observe` to
`createSignett` once. Do not create another registration signal, wrap or mutate the
registration, emit lifecycle events manually, validate input again, or verify inside
`execute`; Signett already owns those behaviors.

Relevant API shape:

```js
const signett = createSignett({ modelContext, context, observe });
const registration = await signett.expose({
  name,
  description,
  inputSchema,
  authorize,
  idempotency: { key, store },
  journal: { store },
  execute,
  verify,
});
```

`context` receives `{ signal }`. The hooks receive the validated input, trusted context,
and signal. `verify` additionally receives the output, `replayed`, and `recovered`. The
registration returned by `expose` already supports `dispose()`.

The supplied `idempotencyStore` implements both the current Signett idempotency-store
and operation-journal contracts. Use it for both configuration fields.

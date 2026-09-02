# Testing WebMCP actions

Test the execution contract before testing whether a model chooses the right tool.
Deterministic tests catch the expensive failures—unauthorized work, duplicate effects,
and false success—without a browser or model in the loop.

## Call the guarded handler directly

```ts
import { describe, expect, it, vi } from "vitest";
import { guard } from "@signet/webmcp";
import {
  MemoryIdempotencyStore,
  MemoryOperationJournal,
} from "@signet/webmcp/testing";

const invocation = () => ({ signal: new AbortController().signal });

it("does not execute for a viewer", async () => {
  const cancel = vi.fn(async () => ({ state: "cancelled" as const }));
  const execute = guard(cancel, {
    context: () => ({ role: "viewer" }),
    authorize: ({ context }) => context.role === "owner",
  });

  await expect(execute({ orderId: "A" }, invocation())).rejects.toMatchObject({
    code: "authorization_denied",
  });
  expect(cancel).not.toHaveBeenCalled();
});
```

## Prove duplicate behavior

```ts
it("performs one effect for repeated input", async () => {
  const store = new MemoryIdempotencyStore();
  const journal = new MemoryOperationJournal();
  const cancel = vi.fn(async () => ({ state: "cancelled" as const }));
  const execute = guard(cancel, {
    idempotency: {
      key: ({ input }) => input.orderId,
      store,
    },
    journal: { store: journal },
  });

  await execute({ orderId: "A" }, invocation());
  await execute({ orderId: "A" }, invocation());

  expect(cancel).toHaveBeenCalledOnce();
});
```

Run the same concurrency contract against a production adapter:

```ts
import { checkIdempotencyStore } from "@signet/webmcp/testing";

await checkIdempotencyStore(() => new PostgresIdempotencyStore(pool));
```

The kit uses fresh keys on every run and checks fresh claims, live equal-key waiting,
abandoned in-flight state, completion, explicit release, distinct-key parallelism, and
pre-aborted calls. For a remote database, pass `{ concurrencyTimeoutMs: 5_000 }` if two
independent operations need more than the default second to start. See
`recipes/postgres-idempotency.ts` for a copyable PostgreSQL adapter and its
transaction-duration tradeoff.

## Test these invariants

For every consequential tool:

1. The wrong principal cannot reach the handler.
2. Context and policy failures fail closed.
3. Identical concurrent keys cause one durable effect.
4. Different keys are not serialized globally.
5. Verification runs after execution and replay.
6. An unverified outcome is never returned as success.
7. Cancellation before execution does no work.
8. Application errors retain their original identity.
9. Telemetry failure cannot change business behavior.
10. Sensitive inputs and outputs do not enter lifecycle events.

## Then test native integration

After deterministic tests pass, verify the complete path in each supported browser
agent:

- the tool is discoverable only in the intended page state;
- the description causes correct tool selection;
- agent arguments satisfy application validation;
- visible page state and returned state agree;
- registration cleanup removes stale tools;
- unsupported browsers retain a usable human interface.

Model-driven tests complement invariant tests. They do not replace them.

For the complete browser path, install `@signet/eval` and run `signet agent`. It opens
a fresh headless Chrome profile, discovers the page's exact WebMCP inventory, lets a
tool-capable model work on a prompt, and records bounded Evidence:

```sh
npm install --save-dev @signet/eval
npx signet agent \
  --url http://127.0.0.1:3000 \
  --prompt "Find the prepared order and report its status." \
  --endpoint https://provider.example/v1/chat/completions \
  --model tool-capable-model \
  --output .artifacts/order-status.json
```

An ad-hoc run checks the interface contract. For consequential work, define a saved
suite with reset, snapshot, and authoritative `grade` hooks. Run deterministic checks
on every pull request and repeated real-model Trials on a schedule. The
[headless-agent codelab](../tutorials/headless-agent-testing) shows the complete setup;
the [CLI reference](../reference/cli) lists its budgets, expectations, and lifecycle
hooks.

Run Signet's complete local suite with:

```sh
npm run validate
```

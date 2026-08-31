# Testing WebMCP actions

Test the execution contract before testing whether a model chooses the right tool.
Deterministic tests catch the expensive failures—unauthorized work, duplicate effects,
and false success—without a browser or model in the loop.

## Call the guarded handler directly

```ts
import { describe, expect, it, vi } from "vitest";
import { guard } from "@signet/webmcp";
import { MemoryIdempotencyStore } from "@signet/webmcp/testing";

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
  const cancel = vi.fn(async () => ({ state: "cancelled" as const }));
  const execute = guard(cancel, {
    idempotency: {
      key: ({ input }) => input.orderId,
      store,
    },
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

The kit checks equal-key coalescing, distinct-key parallelism, failure eviction, and
pre-aborted calls. See `recipes/postgres-idempotency.ts` for a copyable PostgreSQL
adapter and its transaction-duration tradeoff.

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

`evaluateAgentTasks()` accepts saved prompts, expected tools, argument predicates, and
authoritative result oracles. Supply the model runner yourself; Signet reports tool
selection accuracy, argument accuracy, and completion rate without becoming an agent
orchestrator.

Run Signet's complete local suite with:

```sh
npm run validate
```

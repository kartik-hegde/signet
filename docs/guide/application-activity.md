# Show agent activity in your application UI

WebMCP tool calls begin outside the application's normal button and form handlers.
`useSignetActivity` lets a React surface show that work without giving Signet control
of the UI. Framework-neutral applications can subscribe with `createSignetActivity`.

Activity is a metadata-only projection of Signet's invocation lifecycle. It contains no
tool input, output, context, or error details, and it never renders or mutates the DOM.

## 1. Start with a verified tool

Create one stable Signet interface and expose the application operation normally. For a
consequential action, add an authoritative `verify` hook if the UI must distinguish a
handler returning from the requested outcome actually existing:

```ts
import { createSignet } from "@signet/webmcp";

type Session = { userId: string };

export const signet = createSignet<Session>({
  context: ({ signal }) => getCurrentSession({ signal }),
});

await signet.expose({
  name: "place_order",
  description: "Place the active user's reviewed order.",
  inputSchema: {
    type: "object",
    properties: {
      orderId: { type: "string", minLength: 1, maxLength: 128 },
    },
    required: ["orderId"],
    additionalProperties: false,
  },
  authorize: ({ context }) => context.userId.length > 0,
  confirm: ({ input }) => showOrderReview(input.orderId),
  execute: ({ orderId }, { context, signal }) =>
    placeOrder(orderId, context.userId, { signal }),
  verify: async ({ input, context, signal }) => {
    const order = await getOrder(input.orderId, { signal });
    return order?.userId === context.userId && order.status === "placed";
  },
});
```

The human UI and the tool should call the same application service. Signet activity
describes the tool invocation; the application's normal data layer remains the source
of truth.

## 2. Render the latest invocation in React

Pass the same stable `signet` instance to `useSignetActivity`. Filter by `toolName` when
the component represents one application action:

```tsx
import { useEffect } from "react";
import type { SignetInterface } from "@signet/webmcp";
import { useSignetActivity } from "@signet/webmcp/react";

type Session = { userId: string };

type OrderActivityProps = {
  signet: SignetInterface<Session>;
  refreshOrder(): Promise<void>;
};

export function OrderActivity({ signet, refreshOrder }: OrderActivityProps) {
  const { latest } = useSignetActivity(signet, {
    toolName: "place_order",
    maxInvocations: 5,
  });

  const verifiedInvocation =
    latest?.phase === "succeeded" && latest.verified
      ? latest.invocationId
      : undefined;

  useEffect(() => {
    if (!verifiedInvocation) return;
    void refreshOrder();
  }, [refreshOrder, verifiedInvocation]);

  if (!latest) return null;

  switch (latest.phase) {
    case "running":
      return <p>Updating your order…</p>;
    case "awaiting_confirmation":
      return <p>Review your order to continue.</p>;
    case "verifying":
      return <p>Confirming the result with the store…</p>;
    case "succeeded":
      return latest.verified ? (
        <p>Order verified.</p>
      ) : (
        <p>Order action completed. Refreshing its status…</p>
      );
    case "failed":
      return <p>The order was not completed.</p>;
    case "unknown":
      return <p>Checking whether the order completed…</p>;
  }
}
```

The effect keys the refresh by `invocationId`, so ordinary re-renders do not repeatedly
refresh for one completion. `refreshOrder` should read authoritative application state;
do not manually set a cart count, order status, or success message that the backend has
not returned.

For a tool without `verify`, `phase: "succeeded"` means its handler returned, while
`verified` remains `false`. You may refresh application state on plain success, but let
that read determine what the UI claims. Add `verify` when authoritative completion is a
requirement of the tool itself.

## 3. Understand the state

`useSignetActivity` returns a stable snapshot with `latest` and `invocations`.
Invocations are newest first and are keyed by `invocationId`.

| Field                                  | Meaning                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `invocationId`                         | One Signet tool call. Use it as a React key or refresh boundary, not as authorization. |
| `name`                                 | The exposed WebMCP tool name.                                                          |
| `phase`                                | A small presentation phase derived from the detailed guard lifecycle.                  |
| `verified`                             | `true` only after the tool's application-owned `verify` hook passes.                   |
| `resolution`                           | `executed`, `replayed`, `recovered`, or `undefined` before an outcome is available.    |
| `startedAt`, `updatedAt`, `durationMs` | Presentation timing for the observed invocation.                                       |

The phases intentionally avoid exposing Signet's lower-level implementation stages:

| Phase                   | What the UI can safely say                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `running`               | The invocation is being validated, authorized, confirmed, or executed.                                              |
| `awaiting_confirmation` | The application's confirmation hook is waiting for the person.                                                      |
| `verifying`             | An executed, replayed, or recovered result is being finalized and possibly verified. Do not show success yet.       |
| `succeeded`             | The invocation returned successfully. Check `verified` before describing it as verified.                            |
| `failed`                | The invocation was declined or failed ordinarily. Read application state before assuming no external effect exists. |
| `unknown`               | An effect may have happened, but recovery could not prove its outcome. Do not offer a blind retry.                  |

`resolution` lets the UI explain a safe repeat without changing the success condition:

```tsx
if (latest.phase === "succeeded" && latest.verified) {
  if (latest.resolution === "replayed")
    return <p>Showing the existing order.</p>;
  if (latest.resolution === "recovered")
    return <p>Order recovered and verified.</p>;
  return <p>Order placed and verified.</p>;
}
```

## 4. Render concurrent activity when needed

`latest` is appropriate for a single checkout or booking action. If several calls may
run concurrently, render `invocations` and key each row by `invocationId`:

```tsx
const { invocations } = useSignetActivity(signet, { maxInvocations: 20 });

return (
  <ul>
    {invocations.map((invocation) => (
      <li key={invocation.invocationId}>
        {invocation.name}: {invocation.phase}
      </li>
    ))}
  </ul>
);
```

`maxInvocations` defaults to 20 and must be a positive integer. `toolName` is an exact
filter; omit it to observe every tool on the interface. The hook begins observing when
the component subscribes and is not durable across reloads.

## 5. Use the framework-neutral feed

Subscribe directly outside React. Read the initial snapshot, unsubscribe listeners,
and dispose the feed with the application surface:

```ts
import { createSignetActivity } from "@signet/webmcp";

const activity = createSignetActivity(signet, {
  toolName: "place_order",
  maxInvocations: 5,
});

renderOrderActivity(activity.getSnapshot());

const stopRendering = activity.subscribe(() => {
  renderOrderActivity(activity.getSnapshot());
});

// Surface teardown:
stopRendering();
activity.dispose();
```

`dispose()` is idempotent. It stops observation but does not cancel an invocation or
alter its result.

## 6. Test the projection

The normal WebMCP test harness drives the same lifecycle:

```ts
import { createSignet, createSignetActivity } from "@signet/webmcp";
import { createWebMcpTestHarness } from "@signet/webmcp/testing";

const harness = createWebMcpTestHarness();
const signet = createSignet({ modelContext: harness.modelContext });
const activity = createSignetActivity(signet, { toolName: "place_order" });

await signet.expose(placeOrderTool);
await harness.invoke("place_order", { orderId: "order-123" });

expect(activity.getSnapshot().latest).toMatchObject({
  phase: "succeeded",
  verified: true,
  resolution: "executed",
});

activity.dispose();
```

Test the application refresh and rendered copy separately. Activity state is useful for
presentation assertions; the authoritative application oracle should still grade the
business outcome.

## Boundaries

Use activity to coordinate presentation. Do not use it to:

- authorize an action or infer the current user;
- perform, retry, or roll back business effects;
- treat `succeeded` as authoritative when the tool has no verification;
- persist task state across reloads;
- expose tool arguments or results to UI code;
- directly patch the DOM into a state the application has not returned.

Signet tells the application what it observed about an invocation. The application
decides what to render and proves its own business state.

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
import type { SignetInterface } from "@signet/webmcp";
import { useSignetActivity } from "@signet/webmcp/react";

type Session = { userId: string };

type OrderActivityProps = {
  signet: SignetInterface<Session>;
};

export function OrderActivity({ signet }: OrderActivityProps) {
  const { latest } = useSignetActivity(signet, {
    toolName: "place_order",
    maxInvocations: 5,
  });

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
    case "declined":
      return <p>Order placement cancelled.</p>;
    case "failed":
      return <p>The order was not completed.</p>;
    case "unknown":
      return <p>Checking whether the order completed…</p>;
  }
}
```

Keep the `signet`, `toolName`, and `maxInvocations` values stable for the component's
lifetime. The hook retains its activity store across React StrictMode remount checks and
automatically unsubscribes from the Signet interface when the component unmounts.

For a tool without `verify`, `phase: "succeeded"` means its handler returned, while
`verified` remains `false`. Add `verify` when authoritative completion is a requirement
of the tool itself.

## 3. Refresh application state only when needed

Do not automatically refetch after every successful activity event. If `execute`
already writes through the application's normal state layer or adopts an authoritative
response before returning, that state update will cause the normal UI to rerender.
Activity is useful there for progress, confirmation, unknown outcomes, and explaining a
replay or recovery—not as another data-fetch trigger.

For example, a checkout tool may already do this:

```ts
execute: async (input) => {
  const updated = await updateCheckout(input);
  checkoutStore.set(updated); // The ordinary checkout UI rerenders.
  return updated;
};
```

If the operation does not update or invalidate the application's data layer, refresh
authoritative state after verified completion:

```tsx
import { useEffect } from "react";

const { latest } = useSignetActivity(signet, { toolName: "place_order" });
const verifiedInvocation =
  latest?.phase === "succeeded" && latest.verified
    ? latest.invocationId
    : undefined;

useEffect(() => {
  if (!verifiedInvocation) return;
  void refreshOrder();
}, [refreshOrder, verifiedInvocation]);
```

Keying the effect by `invocationId` prevents ordinary rerenders from repeatedly
refreshing one completion. For a tool without `verify`, you may refresh on plain
`succeeded`, but let that authoritative read determine what the UI claims. Never
manually set a cart count, order status, or success message that the application has
not returned.

## 4. Understand the state

`useSignetActivity` returns a stable snapshot with `latest` and `invocations`.
Invocations are ordered by when the feed first observes them, newest first, and are
keyed by `invocationId`. `latest` is the most recently first-observed retained
invocation—normally the most recently started call—not the invocation with the most
recent update. Filter by `toolName` when another tool starting should not replace the
activity shown by a focused component.

| Field                                  | Meaning                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `invocationId`                         | One Signet tool call. Use it as a React key or refresh boundary, not as authorization. |
| `name`                                 | The exposed WebMCP tool name.                                                          |
| `phase`                                | A small presentation phase derived from the detailed guard lifecycle.                  |
| `verified`                             | `true` only after the tool's application-owned `verify` hook passes.                   |
| `resolution`                           | `executed`, `replayed`, `recovered`, or `undefined` before an outcome is available.    |
| `startedAt`, `updatedAt`, `durationMs` | Presentation timing for the observed invocation.                                       |

The phases intentionally avoid exposing Signet's lower-level implementation stages:

| Phase                   | What the UI can safely say                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `running`               | The invocation is being validated, authorized, confirmed, or executed.                                        |
| `awaiting_confirmation` | The application's confirmation hook is waiting for the person.                                                |
| `verifying`             | An executed, replayed, or recovered result is being finalized and possibly verified. Do not show success yet. |
| `succeeded`             | The invocation returned successfully. Check `verified` before describing it as verified.                      |
| `declined`              | The person declined the application's confirmation. Return to an editable state without presenting an error.  |
| `failed`                | The invocation failed ordinarily. Read application state before assuming no external effect exists.           |
| `unknown`               | An effect may have happened, but recovery could not prove its outcome. Do not offer a blind retry.            |

`verifying` is nonterminal. The `verified` field becomes `true` as soon as verification
passes, immediately before the terminal `succeeded` event, so a subscriber can briefly
observe `phase: "verifying"` together with `verified: true`.

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

## 5. Render concurrent activity when needed

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

## 6. Use the framework-neutral feed

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

### Preserve activity before a component mounts

The hook observes calls only while it is mounted. If a modal or status component may
mount after the operation starts, create one long-lived feed beside the stable Signet
interface and render it with React's external-store hook:

```tsx
import { useSyncExternalStore } from "react";
import { createSignetActivity } from "@signet/webmcp";

export const orderActivity = createSignetActivity(signet, {
  toolName: "place_order",
  maxInvocations: 5,
});

export function OrderActivity() {
  const { latest } = useSyncExternalStore(
    orderActivity.subscribe,
    orderActivity.getSnapshot,
    orderActivity.getSnapshot,
  );
  return latest ? <p>{latest.phase}</p> : null;
}
```

Create the feed at module or application-surface scope, not during render. Dispose it
when that owning surface shuts down. This retains calls that occur before a particular
component subscribes; it is still browser-memory state and does not survive a reload.

## 7. Test the projection

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

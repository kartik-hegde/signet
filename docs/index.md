---
layout: home

hero:
  name: Signet
  text: Production controls for WebMCP.
  tagline: Keep native tools. Add exact authorization, retry safety, outcome verification, and observable execution where actions matter.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Read the design contract
      link: /design

features:
  - title: Authorize the exact action
    details: Resolve your application session and fail closed before privileged code runs. Your backend remains authoritative.
  - title: One effect, many retries
    details: Delegate atomic duplicate suppression to a durable store while unrelated operation keys continue in parallel.
  - title: Verify what happened
    details: Check authoritative state after execution or replay. Do not turn an ambiguous result into a success message.
  - title: Small enough to remove
    details: No tool DSL, registry, schema language, browser patch, or hosted dependency. Remove guard() and your handler remains.
---

## The complete idea

```ts
await document.modelContext?.registerTool({
  name: "cancel-order",
  description: "Cancels one order owned by the signed-in customer.",
  inputSchema,
  execute: guard(cancelOrder, {
    context: currentSession,
    authorize: ({ input, context }) =>
      context.userId === ownerOf(input.orderId),
    idempotency: {
      key: ({ input, context }) => `${context.userId}:${input.orderId}:cancel`,
      store: durableStore,
    },
    verify: ({ output }) => output.state === "cancelled",
  }),
});
```

The browser owns WebMCP discovery and invocation. Your application owns identity,
policy, data, and business logic. Signet stays at that boundary.

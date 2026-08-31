---
layout: home

hero:
  name: Signet WebMCP
  text: Let agents use your product. Know the action really happened.
  tagline: Turn application functions into native WebMCP tools, then add the validation, application context, reliable execution, testing, and traces needed to ship with confidence.
  actions:
    - theme: brand
      text: Get started →
      link: /guide/getting-started
    - theme: alt
      text: Read the approach
      link: /guide/why-signet

features:
  - title: 01 / Expose
    details: Bind a clear tool to a function your application already owns. Native WebMCP stays visible.
  - title: 02 / Prove
    details: Test contracts, authorization, replay behavior, and authoritative outcomes without a model.
  - title: 03 / Observe
    details: Follow one action from agent intent through application effect and verified result.
---

## Existing logic in. Verifiable actions out.

```text
application function → Signet tool boundary → native WebMCP → browser agent → verified outcome
```

Signet does not replace your application, the browser standard, or the agent. It gives
product teams a precise boundary around what agents can do—and evidence that consequential
actions reached the intended state.

## Start with four fields. Add rigor when the action earns it.

```ts
await signet.expose({
  name: "cancel_order",
  description: "Cancel one unshipped order.",
  inputSchema,
  execute: ({ orderId }) => cancelOrder(orderId),
});
```

Public reads can stay this small. Authenticated or state-changing actions can add
application context, authorization, idempotency, recovery, verification, and observation
without changing the underlying handler.

> [!TIP]
> **The visual system follows the same rule.** Quiet foundations, explicit boundaries,
> and color only when it carries information. [See the Signet Signal design kit →](/brand)

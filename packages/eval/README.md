# `@signet/eval`

Portable, application-owned evaluations for agent-ready websites.

The format uses four precise terms:

- A **Case** is one versioned user intent with expectations and budgets.
- A **Trial** is one execution of a Case under one condition.
- **Evidence** is the immutable, schema-versioned record from that Trial.
- A **Report** aggregates Evidence; the application oracle, never the agent transcript, grades success.

Application, browser, agent, oracle, and fault adapters keep the runner independent of any particular browser or model provider.

```ts
import { defineCase, defineSuite } from "@signet/eval";

const suite = defineSuite({
  id: "checkout",
  cases: [
    defineCase({
      id: "place-order",
      intent: "Place the prepared order exactly once.",
      kind: "consequential",
      application: "storefront",
      oracle: "orders-database",
      expectations: {
        requiredCapabilities: ["place_order"],
        forbiddenEffects: ["duplicate-order"],
      },
    }),
  ],
});
```

The package installs a `signet` command. From the Signet monorepo, the complete authenticated-payment evaluation is:

```bash
signet eval fixtures/cypress-realworld-app/eval/index.mjs --trials 5
```

See the [benchmark guide](../../benchmarks/README.md) for adapters, controlled conditions, and evidence publication rules.

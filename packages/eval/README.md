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

## Catch regressions while you iterate

Keep a reviewed `report.json` as the baseline for an important workflow, then compare
the next run directly:

```bash
signet eval scenarios/send-payment.eval.mjs \
  --trials 5 \
  --against .signet/baselines/send-payment.report.json
```

The run writes `check.json` for CI and `check.md` for code review next to its normal
report. The check compares every Case and condition independently, so an improvement in
one workflow cannot hide a regression in another. By default it rejects:

- any safe-success regression;
- new forbidden effects or environment errors;
- missing Cases, conditions, or trial coverage; and
- a changed Case definition that would make the comparison invalid.

Agent evaluations are probabilistic, so teams can declare an explicit tolerance while
keeping safety failures strict:

```bash
signet eval scenarios/send-payment.eval.mjs \
  --trials 10 \
  --against .signet/baselines/send-payment.report.json \
  --max-safe-regression 0.1 \
  --max-duration-ratio 1.25 \
  --max-token-ratio 1.2
```

Existing reports can also be checked without rerunning an agent:

```bash
signet check evidence/candidate/report.json \
  --against evidence/baseline/report.json
```

A failing change check still writes both artifacts and prints every reason before
returning a non-zero exit code. In GitHub Actions, the Markdown is also added to the job
summary automatically, leaving the developer with the exact Case, condition, metric,
and reason to fix.

See the [benchmark guide](../../benchmarks/README.md) for adapters, controlled conditions, and evidence publication rules.

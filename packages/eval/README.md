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

## Run the headless Signet Agent

`signet agent` opens a fresh headless Chrome profile, discovers the page's exact
WebMCP inventory, gives a prompt and those tools to a Chat Completions-compatible
model, and records bounded evidence:

```bash
npm install --save-dev @signet/eval

npx signet agent \
  --url http://127.0.0.1:3000 \
  --prompt "Add two notebooks to my cart and report the total." \
  --endpoint http://127.0.0.1:8000/v1/chat/completions \
  --model my-model \
  --output .artifacts/notebooks.json
```

For repeatable tasks, define an application-owned suite:

```js
import { defineAgentTestSuite } from "@signet/eval/agent";

export default defineAgentTestSuite({
  schemaVersion: 1,
  id: "storefront",
  application: {
    id: "storefront",
    url: "http://127.0.0.1:3000",
    async reset() {},
    async snapshot({ phase }) {},
    async grade({ before, after }) {
      const passed = after.cartItems === before.cartItems + 2;
      return {
        source: "store-database",
        authoritative: true,
        authoritativeSuccess: passed,
        safeSuccess: passed,
        forbiddenEffects: [],
      };
    },
  },
  tasks: [
    {
      id: "add-notebooks",
      prompt: "Add two notebooks to my cart and report the total.",
      expectations: {
        requiredTools: ["search_products", "add_cart_item"],
      },
    },
  ],
});
```

```bash
npx signet agent ./signet.agent.mjs --trials 5
```

The Chrome extension remains a separate interactive UI. It is not installed by
`@signet/eval`.

## Score the interface, not just the outcome

The oracle decides whether the task succeeded. It cannot say whether the _interface_
served the agent well, so every Trial also carries interface-quality metrics derived
from the Case expectations, the exact inventory the browser published, and the recorded
trace:

| Dimension | Question it answers                                                    |
| --------- | ---------------------------------------------------------------------- |
| Discovery | Did the condition publish every capability the Case requires?          |
| Selection | Did the agent call those capabilities, and only tools that exist?      |
| Arguments | Were the recorded arguments valid against the published `inputSchema`? |

Each dimension reports whether it applied. A UI-only arm records incomplete discovery
but leaves selection unscored: the condition did not offer the capabilities the agent
was expected to select. Metrics are recorded per Trial under `quality` and aggregated
per condition under `aggregate.interfaceQuality`.

Agent adapters supply argument evidence by emitting the exported tool-call event:

```js
emit("webmcp_call", { tool, input, ok, error }); // one WebMCP tool call
```

An adapter that cannot emit a trace can return `toolSequence`; selection is still
scored, while arguments remain unscored.

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

- any safe-success or authoritative-success regression;
- a required capability that is no longer published;
- a drop in selection accuracy or argument validity;
- a metric the baseline measured that the candidate no longer scores;
- an increased timeout rate;
- new forbidden effects or environment errors;
- missing Cases, conditions, or trial coverage; and
- a changed Case definition that would make the comparison invalid.

A metric the baseline never measured is left ungated rather than treated as a
regression, so reports written before a metric existed stay comparable. The reverse is
not waved through: a candidate that stops scoring a metric the baseline did measure
would hide that metric's own regression, so it is reported.

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

`--max-safe-regression` sets the default allowance for every probabilistic outcome
rate. Tighten or loosen one of them independently with
`--max-authoritative-regression`, `--max-selection-regression`,
`--max-argument-regression`, or `--max-timeout-increase`.

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

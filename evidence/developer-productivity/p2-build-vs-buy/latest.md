# P2 build-versus-buy scorecard

Generated 2026-08-31T13:25:00.529Z. Status: **pilot**.

| Condition     | Conforming attempts | Hidden cases | Median conforming implementation | Median conforming production LOC | Median tokens | Package reads | Runtime p50 |
| ------------- | ------------------: | -----------: | -------------------------------: | -------------------------------: | ------------: | ------------: | ----------: |
| Direct WebMCP |                 4/5 |  56/70 (80%) |                           23.89s |                              144 |         64142 |             0 |     2.57 ms |
| Signet        |                 4/5 |  56/70 (80%) |                           19.19s |                             61.5 |         71056 |             0 |    2.458 ms |

## Headline

- **1.24× implementation speed** for Signet versus direct WebMCP.
- **57.29% less bespoke production code** among conforming attempts at the median.
- **0 percentage points** in first-pass full conformance and **0 points** in hidden-case pass rate.
- **10.78% more implementation tokens** at the median.
- **-4.36% p50 invocation overhead** with a 2 ms simulated application operation.

## Interpretation

This isolates the technical “why not build it on WebMCP?” question. Both cohorts received the same app-owned session resolver, business service, atomic operation store, public requirements, visible checks, model, and budget. The direct cohort implemented the integration controls itself; the Signet cohort used the four-field Signet interface and hooks. A frozen 14-case suite, not shown in the agent prompt, scored validation, authorization, replay, concurrency, intent-safe keys, retry, verification, cancellation, lifecycle, and trace behavior.

This is a pilot, not a population estimate. The implementation agent can vary across attempts, and the public suite becomes gameable after publication. A launch-grade claim should use at least 10–20 attempts per condition, preregistration, an isolated evaluator, and confidence intervals. Runtime measures only conforming solutions and should be read as a guardrail, not the product's primary value.

Signet source: commit `e4e04fa`, content hash `bce5cb341ffdfb48`. Model: `gpt-5.4-mini` at `low` reasoning. Raw attempts are retained locally at `results/raw/p2/2026-08-31T13-13-45-624Z`.

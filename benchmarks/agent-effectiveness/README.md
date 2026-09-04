# P1 real-agent effectiveness benchmark

P1 runs a payment mutation and a recipient-lookup goal through a real,
subscription-authenticated Codex agent against the Cypress Real World App. The same
browser, seeded state, model, prompt budget, and independent oracle are used for every
condition.

## Conditions

| Condition        | Agent surface                          | Consequential handler   |
| ---------------- | -------------------------------------- | ----------------------- |
| `ui_dom`         | Semantic DOM snapshot, click, and fill | Existing application UI |
| `hybrid_raw`     | DOM actions plus native WebMCP tools   | Raw application handler |
| `hybrid_signett` | DOM actions plus native WebMCP tools   | Signett-guarded handler |

The WebMCP tools are registered by the page through `document.modelContext`. A small
MCP adapter makes those exact live registrations available to the benchmark agent; it
does not reimplement their handlers or schemas. The two hybrid conditions deliberately
retain UI access so fallback is measurable.

## Primary KPIs

- authoritative and safe task success;
- end-to-end latency, including model and tool time;
- UI fallback and WebMCP adoption;
- full WebMCP completion, separated from partial tool use before UI fallback;
- total UI actions, WebMCP calls, and failed calls;
- input, cached-input, output, and reasoning tokens;
- false-success and duplicate-effect counts.

The oracle reads balances, transactions, and durable operation records through the
application's privileged test-data endpoint after the agent stops. Agent narration and
tool return values never determine task success.

## Run

```sh
# Smoke: one run per condition
npm run bench:p1:smoke

# Preregistered pilot: ten runs per condition
npm run bench:p1
```

Useful overrides:

```sh
P1_TRIALS=3 P1_MODEL=gpt-5.4-mini P1_REASONING=low npm run bench:p1
```

Raw traces are written below `evidence/raw/p1/` and ignored by Git. The public aggregate
scorecard is written to `evidence/p1/latest.json` and `evidence/p1/latest.md`.

To run one saved task through WebMCP only and retain its complete local diagnostic
trace, use the [Signett Test Agent](./TEST_AGENT.md).

## Interpretation

This benchmark tests agent effectiveness on one realistic application workflow. It is
an internal hill-climbing pilot, not yet a population-level headline. Ten trials per
condition expose basic variance; publication should add tasks, a second model family,
confidence intervals sized from the pilot variance, and an independent application.

WebMCP deserves credit for replacing UI actuation. Signett should only receive credit
for changes relative to raw WebMCP, including safe execution, verified outcomes,
diagnostic evidence, and measured overhead.

For the separate multi-turn failure and self-correction protocol, see the
[agent error-repair benchmark](./REPAIR_BENCHMARK.md).

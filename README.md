# Signet benchmarks

Public benchmark work for structured browser-agent actions and safe execution.

The project evaluates three different questions and keeps their evidence separate:

1. **Agent effectiveness:** how UI-only browser agents compare with agents that can
   discover and invoke WebMCP tools.
2. **Execution safety:** what raw and guarded tool handlers leave behind when retries,
   concurrency, authorization failures, cancellation, or incorrect responses occur.
3. **Build versus buy:** how a Signet integration compares with independently built
   WebMCP controls in implementation time, bespoke code, conformance, and maintenance.

Signet is an evaluated arm, not the benchmark oracle. Task completion is graded from
application state or an independent evaluator, never from Signet events or a tool's own
success response.

## Repository layout

| Path | Purpose | Status |
|---|---|---|
| [`execution-safety/`](./execution-safety/) | Deterministic post-commit failure and concurrency suite | Runnable v0 |
| [`agent-effectiveness/`](./agent-effectiveness/) | Repeated real-agent UI/WebMCP studies | Design stage |
| [`build-vs-buy/`](./build-vs-buy/) | Independent raw-controls versus Signet implementation study | Design stage |
| [`apps/`](./apps/) | App manifests, patches, task definitions, reset hooks, and oracles | Design stage |
| [`methodology/`](./methodology/) | Benchmark contract, KPIs, experimental design, and publication rules | Initial design |
| [`results/`](./results/) | Reviewed summaries and benchmark cards; raw/private traces stay ignored | Initial design |

## Run the current safety lane

The v0 suite expects a Signet checkout next to this repository. Set `SIGNET_DIR` when
using another layout.

```sh
cd execution-safety
npm run bench
```

## Run P0

P0 runs the authenticated payment task through the UI, raw WebMCP, and
Signet-guarded WebMCP; verifies all three against the same database oracle; runs the
deterministic safety suite; and prints one KPI scorecard.

```sh
npm run install:p0
npm run bench:p0
```

The first command is only required when the app dependencies are absent. P0 expects a
Signet checkout beside this repository; set `SIGNET_DIR` for another location. Its
deterministic timings establish interface parity and directional overhead, not a
publishable LLM-agent speed claim.

The safety lane is intentionally model-free. A deterministic caller is the cleaner way
to test execution invariants; models are introduced only where tool discovery, task
planning, and UI interaction are part of the question.

## Benchmark contract

The proposed public methodology is in
[`methodology/benchmark-design.md`](./methodology/benchmark-design.md). The short version:

- compare the same user goal from the same reset state;
- use the same model, prompt policy, budgets, and evaluator across paired conditions;
- derive tools from genuine application capabilities rather than benchmark tasks;
- report task success, safe task success, time, actions, tokens, and cost separately;
- publish failures, timeouts, confidence intervals, versions, and evaluator changes;
- attribute UI-to-tool gains to WebMCP and raw-to-guarded safety gains to Signet.

This repository is experimental. A public release also needs an explicit repository
license, pinned application provenance, and a benchmark card for each published study.

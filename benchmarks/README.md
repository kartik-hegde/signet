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

## Run a reusable evaluation

The open-source evaluation kit defines a user intent as a versioned **Case**, executes
each Case as one or more **Trials**, saves immutable **Evidence**, and aggregates it into
JSON and Markdown **Reports**. The authenticated-payment suite also includes controlled
baseline, explicit-metadata, and guided-metadata conditions for hill climbing.

```sh
npm run eval -- --trials 5

# Select a smaller matrix while developing
npm run eval -- --case find-payment-recipient --condition signet-baseline,signet-guided --trials 5

# Inspect the run count without starting Chrome or an agent
npm run eval -- --dry-run
```

Application, browser, agent, fault, and oracle adapters live outside the core runner.
This makes the format and local runner reusable while keeping the database oracle
authoritative. Outputs are written under `evidence/eval/<timestamp>/`; model-backed runs
may consume paid provider capacity, so CI uses deterministic contract tests instead.

The current audit and ordered next steps are in
[`methodology/benchmark-roadmap.md`](./methodology/benchmark-roadmap.md). The main
change is to benchmark the complete developer loop—time from an existing website
workflow to the first authoritative real-agent success, followed by measurable
hill-climbing—not only WebMCP efficiency and execution safety.

## Repository layout

| Path                                             | Purpose                                                                 | Status         |
| ------------------------------------------------ | ----------------------------------------------------------------------- | -------------- |
| [`demo/`](./demo/)                               | Customer-ready speed race and fault-injection story                     | Runnable       |
| [`execution-safety/`](./execution-safety/)       | Deterministic post-commit failure and concurrency suite                 | Runnable v0    |
| [`agent-effectiveness/`](./agent-effectiveness/) | Repeated real-agent UI/WebMCP studies                                   | Runnable P1    |
| [`build-vs-buy/`](./build-vs-buy/)               | Raw, hand-rolled, and Signet implementation baseline                    | Runnable       |
| [`integrations/`](./integrations/)               | External-app manifests, patches, task definitions, reset hooks, and oracles | Saleor + Cal.diy |
| [`methodology/`](./methodology/)                 | Benchmark contract, coverage audit, ordered roadmap, and publication rules | Audit + roadmap |
| [`../evidence/`](../evidence/)                   | Reviewed summaries and benchmark cards; raw/private traces stay ignored | Published evidence |

## Run the current safety lane

```sh
npm run bench:safety
```

## Run P0

P0 runs the authenticated payment task through the UI, raw WebMCP, and
Signet-guarded WebMCP; verifies all three against the same database oracle; runs the
deterministic safety suite; and prints one KPI scorecard.

```sh
npm run test:reference:install
npm run bench:p0
```

The first command is only required when the app dependencies are absent. Its
deterministic timings establish interface parity and directional overhead, not a
publishable LLM-agent speed claim.

The safety lane is intentionally model-free. A deterministic caller is the cleaner way
to test execution invariants; models are introduced only where tool discovery, task
planning, and UI interaction are part of the question.

## Present the demo

The interactive demo reads the latest P0 evidence and turns it into a two-part story:
WebMCP removes UI work, then Signet makes consequential execution inspectable and safe.

```sh
npm run demo
# open http://127.0.0.1:4173/demo/
```

Use the Speed tab first, then inject the lost-response fault in the Trust tab. Run the
browser regression with `npm run test:demo`.

## Run the real-agent P1 pilot

P1 gives a payment mutation and recipient-lookup intent to a real Codex agent ten times
per condition and grades every run from application state:

```sh
npm run bench:p1
```

Use `npm run bench:p1:smoke` for one trial per condition. The aggregate scorecard is
written to `evidence/p1/latest.json` and `evidence/p1/latest.md`; raw agent and browser
traces remain under the ignored `evidence/raw/p1/` directory.

## Test a live agent interface

The same mechanism also provides the first Signet Test Agent vertical slice. It removes
DOM fallback, runs one saved task against only the live WebMCP registrations, and joins
agent behavior to Signet lifecycle and authoritative outcome evidence:

```sh
npm run test:agent -- --task=find-payment-recipient
```

See [`agent-effectiveness/TEST_AGENT.md`](./agent-effectiveness/TEST_AGENT.md) for the
trace contract and provider adapter seam.

## Run the real Saleor demo

The [`integrations/saleor/`](./integrations/saleor/) integration uses the current Saleor storefront
and a full local Saleor Core/Postgres stack. It registers five checkout tools, includes
an app-owned order approval, injects a lost response after commit, recovers the paid
order, and grades duplicate safety from Postgres:

```sh
npm run saleor:preflight
npm run saleor:oracle -- --email proof@example.com
```

The captured local proof is in [`../evidence/saleor/latest.md`](../evidence/saleor/latest.md).

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

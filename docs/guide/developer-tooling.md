# Developer tooling

## Framework lifecycle

Import `useSignetTool` from `@signet/webmcp/react`. It exposes a tool for its component
lifetime and serializes same-name teardown and remount, including React StrictMode when
registration is still in flight. Its dependency list is required so a first-render
handler closure cannot be frozen accidentally; include every reactive value used by
the tool callbacks.

## Readiness checks

`checkToolReadiness(tool)` returns deterministic diagnostics for ambiguous names and
descriptions, open object schemas, undocumented arguments, unbounded strings or arrays,
missing read-only hints, and invalid output budgets. `assertToolReady(tool)` turns those
diagnostics into one portable test failure. These checks improve definitions; only
real-agent task evaluations measure selection quality.

## Inspector

```ts
import { mountSignetInspector } from "@signet/webmcp/inspector";

const inspector = mountSignetInspector(signet);
// inspector.dispose();
```

The dependency-free browser overlay displays current tool schemas, annotations,
exposure state, and lifecycle timings. It captures no argument or result values and
makes no network requests. Import it only in development code so bundlers can exclude
the entry point from production.

## Evaluation change checks

`@signet/eval` turns application-owned Cases and oracle-graded Trial Evidence into a
repeatable change check:

```sh
signet eval scenarios/checkout.eval.mjs \
  --trials 5 \
  --against .signet/baselines/checkout.report.json
```

Signet writes both the normal evaluation report and a `check.json`/`check.md` pair. The
check works at Case-by-condition granularity, detects reduced trial coverage and Case
definition drift, and never lets an aggregate gain conceal a newly unsafe workflow.
The default safe-success tolerance is zero; set `--max-safe-regression` deliberately for
probabilistic agents. Latency and token gates are opt-in through
`--max-duration-ratio` and `--max-token-ratio`. GitHub Actions runs automatically add
the Markdown diagnosis to the job summary.

To review already-completed runs without spending more provider capacity:

```sh
signet check evidence/candidate/report.json \
  --against evidence/baseline/report.json
```

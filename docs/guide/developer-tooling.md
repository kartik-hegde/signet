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

The dependency-free browser overlay displays current tool schemas and exposure state,
plus one ordered row per call with outcome, total latency, and a phase waterfall.
Expand a call to inspect validation, policy, execution/replay/recovery, and verification
durations or its bounded error classification. Completed calls are also added to the
browser's User Timing track by default. The inspector captures no argument, result,
context, error message, or stack values and makes no network requests. Import it only
in development code so bundlers can exclude the entry point from production.

## Evaluation change checks

Install `@signet/eval` as a development dependency to get all three terminal workflows:

```sh
npm install --save-dev @signet/eval
npx signet agent --help
npx signet eval --help
npx signet check --help
```

`signet agent` runs a prompt or saved task against a page's live WebMCP inventory in a
fresh headless Chrome profile. Use it for terminal and CI testing; the Chrome extension
is a separate interactive tool. Follow the
[headless-agent codelab](../tutorials/headless-agent-testing) and use the
[CLI reference](../reference/cli) for suite hooks and every option.

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

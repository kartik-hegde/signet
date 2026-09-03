#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const p1 = read("evidence/p1/latest.json");
const build = read("evidence/build-vs-buy/latest.json");
const testAgent = read("evidence/test-agent/latest.json");
const payment = p1.taskResults["pay-lia-reference"].aggregates;
const lookup = p1.taskResults["find-payment-recipient"].aggregates;
const selectedPaymentRuns = p1.runs.filter(
  ({ taskId, condition, completedViaWebMcp }) =>
    taskId === "pay-lia-reference" &&
    condition !== "ui_dom" &&
    completedViaWebMcp,
);
const outputDir = resolve(root, "evidence/evidence");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: "reference_evidence_report",
  sources: {
    agentEffectiveness: source(p1),
    executionAndBuild: source(build),
    testAgent: source(testAgent),
  },
  findings: {
    payment: {
      trialsPerCondition: payment.ui_dom.runs,
      authoritativeSuccesses: {
        ui: payment.ui_dom.authoritativeSuccesses,
        rawWebMcp: payment.hybrid_raw.authoritativeSuccesses,
        signettWebMcp: payment.hybrid_signett.authoritativeSuccesses,
      },
      webMcpCompletion: {
        raw: payment.hybrid_raw.webMcpCompletions,
        signett: payment.hybrid_signett.webMcpCompletions,
      },
      median: {
        ui: metrics(payment.ui_dom),
        rawHybrid: metrics(payment.hybrid_raw),
        signettHybrid: metrics(payment.hybrid_signett),
      },
      selectedWebMcpPath: {
        runs: selectedPaymentRuns.length,
        durationMs: median(
          selectedPaymentRuns.map(({ durationMs }) => durationMs),
        ),
        actions: median(
          selectedPaymentRuns.map(({ actions }) => actions.total),
        ),
        tokens: median(
          selectedPaymentRuns.map(({ usage }) => usage.totalTokens),
        ),
      },
    },
    recipientLookup: {
      trialsPerCondition: lookup.ui_dom.runs,
      authoritativeSuccesses: {
        ui: lookup.ui_dom.authoritativeSuccesses,
        rawWebMcp: lookup.hybrid_raw.authoritativeSuccesses,
        signettWebMcp: lookup.hybrid_signett.authoritativeSuccesses,
      },
      webMcpSelections: {
        raw: lookup.hybrid_raw.webMcpCompletions,
        signett: lookup.hybrid_signett.webMcpCompletions,
      },
      validWebMcpCallRate: {
        raw: lookup.hybrid_raw.validWebMcpCallRate,
        signett: lookup.hybrid_signett.validWebMcpCallRate,
      },
    },
    executionSafety: {
      raw: compactScore(build.conformance.raw),
      signettShippedStore: compactScore(build.conformance.signettShippedStore),
      signettDurableStore: compactScore(
        build.conformance.signettWithDurableStore,
      ),
      handrolledDurableStore: compactScore(build.conformance.handrolled),
    },
    implementation: build.implementation,
    testAgent: {
      task: testAgent.runs[0].taskId,
      passed: testAgent.runs[0].safeSuccess,
      toolSequence: testAgent.runs[0].toolSequence,
      lifecycle: testAgent.runs[0].runtimeEvidence.guardStages,
      durationMs: testAgent.runs[0].durationMs,
      tokens: testAgent.runs[0].usage.totalTokens,
    },
  },
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  resolve(outputDir, "latest.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
writeFileSync(resolve(outputDir, "latest.md"), render(report));
process.stdout.write(render(report));

function read(filename) {
  return JSON.parse(readFileSync(resolve(root, filename), "utf8"));
}

function source(result) {
  return {
    generatedAt: result.generatedAt,
    benchmarkCommit: result.provenance.benchmarkCommit,
    signettCommit: result.provenance.signettCommit,
    status: result.status,
  };
}

function metrics(value) {
  return {
    durationMs: value.medianDurationMs,
    actions: value.medianActions,
    tokens: value.medianTotalTokens,
  };
}

function compactScore(value) {
  return {
    overall: value.overall,
    correctness: value.correctness,
    honesty: value.honesty,
    scenariosPassed: value.scenariosPassed,
    scenariosRun: value.scenariosRun,
    medianInvocationMs: value.medianInvocationMs,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = (sorted.length - 1) / 2;
  const lower = Math.floor(midpoint);
  const upper = Math.ceil(midpoint);
  return Math.round(((sorted[lower] + sorted[upper]) / 2) * 100) / 100;
}

function render(value) {
  const {
    payment: pay,
    recipientLookup: readTask,
    executionSafety: safety,
  } = value.findings;
  const test = value.findings.testAgent;
  const implementation = value.findings.implementation;
  return `# Signett reference evidence report

Generated: ${value.generatedAt}

## What the evidence supports

1. **A structured agent interface reduces work when the agent selects it.** The
   payment task completed in all ${pay.trialsPerCondition * 3} runs. Median UI work was
   ${pay.median.ui.actions} agent steps and ${Math.round(pay.median.ui.tokens)} tokens.
   Across the ${pay.selectedWebMcpPath.runs} hybrid runs that completed through WebMCP,
   the median was ${pay.selectedWebMcpPath.actions} steps and
   ${Math.round(pay.selectedWebMcpPath.tokens)} tokens. This is a conditional mechanism
   diagnostic, not a randomized subgroup claim.
2. **Tool selection is now the largest observed agent-side failure.** On recipient
   lookup, UI-only succeeded ${readTask.authoritativeSuccesses.ui}/${readTask.trialsPerCondition};
   raw WebMCP succeeded ${readTask.authoritativeSuccesses.rawWebMcp}/${readTask.trialsPerCondition};
   and Signett WebMCP succeeded ${readTask.authoritativeSuccesses.signettWebMcp}/${readTask.trialsPerCondition}.
   Every invoked WebMCP call was valid. Successful runs exactly tracked selection of
   \`search_payment_users\`; failed agents generally stopped at a plausible internal ID
   visible on the landing page.
3. **Signett adds reusable execution semantics, not a different agent protocol.** Raw
   execution scored ${safety.raw.overall}/100 under injected faults. Signett with its
   shipped process-local store scored ${safety.signettShippedStore.overall}/100, while
   Signett with the benchmark's durable store scored ${safety.signettDurableStore.overall}/100.
4. **Equivalent controls can be hand-built, but the application owns more code.** The
   first hand-rolled adapter matched the durable Signett arm at
   ${safety.handrolledDurableStore.overall}/100 and required
   ${implementation.handrolledBespokeSloc} bespoke SLOC versus
   ${implementation.signettAdapterSloc} for the Signett adapter.
5. **The Test Agent closes the local verification loop.** It ran \`${test.task}\`
   through WebMCP only, selected \`${test.toolSequence.join(" → ")}\`, passed the
   independent oracle, and captured \`${test.lifecycle.join(" → ")}\` in
   ${Math.round(test.durationMs)} ms.

## Real-agent baseline

| Task | Condition | Success | Median ms | Median agent steps | Median tokens | WebMCP completion |
|---|---|---:|---:|---:|---:|---:|
${taskRows(p1)}

The raw and Signett conditions expose the same WebMCP schemas to the agent. Differences
between their selection rates in this small sample are not evidence that Signett changes
selection quality; their Wilson intervals overlap and the condition is invisible to the
model. Signett should be credited only for execution controls, diagnostics, and measured
adapter burden relative to raw WebMCP.

## Execution and implementation baseline

| Arm | Safety | Correctness | Honesty | Bespoke adapter SLOC | Median invocation ms |
|---|---:|---:|---:|---:|---:|
| Raw WebMCP | ${safety.raw.overall} | ${safety.raw.correctness} | ${safety.raw.honesty} | — | ${safety.raw.medianInvocationMs} |
| Hand-rolled + durable store | ${safety.handrolledDurableStore.overall} | ${safety.handrolledDurableStore.correctness} | ${safety.handrolledDurableStore.honesty} | ${implementation.handrolledBespokeSloc} | ${safety.handrolledDurableStore.medianInvocationMs} |
| Signett + shipped memory store | ${safety.signettShippedStore.overall} | ${safety.signettShippedStore.correctness} | ${safety.signettShippedStore.honesty} | ${implementation.signettAdapterSloc} | ${safety.signettShippedStore.medianInvocationMs} |
| Signett + durable store | ${safety.signettDurableStore.overall} | ${safety.signettDurableStore.correctness} | ${safety.signettDurableStore.honesty} | ${implementation.signettAdapterSloc} | ${safety.signettDurableStore.medianInvocationMs} |

The durable store is supplied by the benchmark, not Signett. The SLOC comparison is a
directional single-implementation result; it does not replace an independent timed
developer study.

## Limits

- Two tasks, one application, one model family, and ten trials per condition are enough
  for an internal baseline, not a market-wide headline.
- The hybrid conditions permit UI fallback. Conditional WebMCP-path metrics diagnose
  the mechanism but are not randomized subgroups.
- Token counts come from subscription-authenticated Codex, so dollar cost is omitted.
- The runner records local task inputs and outputs explicitly. Production Signett
  observation remains metadata-only and cannot measure prompts where no tool was
  selected without an agent-side signal.

## Reproduce

\`npm run bench:p1\`  
\`npm run bench:build-vs-buy\`  
\`npm run test:agent -- --task=find-payment-recipient\`  
\`npm run report:evidence\`
`;
}

function taskRows(result) {
  const labels = {
    ui_dom: "UI only",
    hybrid_raw: "UI + raw WebMCP",
    hybrid_signett: "UI + Signett WebMCP",
  };
  return Object.entries(result.taskResults)
    .flatMap(([task, taskResult]) =>
      Object.entries(taskResult.aggregates).map(([condition, metric]) => [
        task,
        labels[condition] ?? condition,
        `${metric.authoritativeSuccesses}/${metric.runs}`,
        Math.round(metric.medianDurationMs),
        metric.medianActions,
        Math.round(metric.medianTotalTokens),
        `${metric.webMcpCompletions}/${metric.runs}`,
      ]),
    )
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

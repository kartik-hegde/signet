import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateEvidence } from "./evidence.mjs";

export const REPORT_SCHEMA_VERSION = 1;

/** Aggregate immutable Trial Evidence. All success fields come from the oracle grade. */
export function buildReport({
  suite,
  evidence,
  baselineCondition = "signet-baseline",
}) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new TypeError(
      "A report requires at least one Trial Evidence document.",
    );
  }
  for (const item of evidence) validateEvidence(item);
  const conditions = orderedUnique(
    evidence.map((item) => item.trial.condition),
  );
  const caseIds = orderedUnique(evidence.map((item) => item.case.id));
  const hashes = Object.fromEntries(
    caseIds.map((caseId) => [
      caseId,
      orderedUnique(
        evidence
          .filter((item) => item.case.id === caseId)
          .map((item) => item.case.definitionHash),
      ),
    ]),
  );
  const warnings = Object.entries(hashes)
    .filter(([, values]) => values.length > 1)
    .map(([caseId]) => `Case ${caseId} changed definition within this run.`);
  const byCondition = Object.fromEntries(
    conditions.map((condition) => [
      condition,
      aggregate(evidence.filter((item) => item.trial.condition === condition)),
    ]),
  );
  const byCase = Object.fromEntries(
    caseIds.map((caseId) => {
      const caseEvidence = evidence.filter((item) => item.case.id === caseId);
      return [
        caseId,
        {
          intent: caseEvidence[0].case.intent,
          kind: caseEvidence[0].case.kind,
          definitionHash: caseEvidence[0].case.definitionHash,
          aggregate: aggregate(caseEvidence),
          conditions: Object.fromEntries(
            conditions.map((condition) => [
              condition,
              aggregate(
                caseEvidence.filter(
                  (item) => item.trial.condition === condition,
                ),
              ),
            ]),
          ),
        },
      ];
    }),
  );
  const baseline = byCondition[baselineCondition];
  const comparisons = baseline
    ? Object.fromEntries(
        conditions
          .filter((condition) => condition !== baselineCondition)
          .map((condition) => [
            condition,
            compare(baseline, byCondition[condition]),
          ]),
      )
    : {};

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    suite: typeof suite === "string" ? suite : suite.id,
    grading: "authoritative application oracle",
    baselineCondition: baseline ? baselineCondition : null,
    warnings,
    aggregate: aggregate(evidence),
    conditions: byCondition,
    cases: byCase,
    comparisons,
    evidenceIds: evidence.map((item) => item.evidenceId),
  };
}

export function writeReport({ suite, evidence, outputDir, baselineCondition }) {
  const report = buildReport({ suite, evidence, baselineCondition });
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = resolve(outputDir, "report.json");
  const markdownPath = resolve(outputDir, "report.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdownReport(report));
  return { report, jsonPath, markdownPath };
}

export function renderMarkdownReport(report) {
  const conditionRows = Object.entries(report.conditions)
    .map(
      ([name, value]) =>
        `| ${name} | ${value.authoritativeSuccesses}/${value.trials} | ${percent(value.safeSuccessRate)} | ${interval(value.safeSuccessInterval95)} | ${round(value.medianDurationMs)} | ${round(value.medianActions)} | ${round(value.medianTokens)} | ${value.timeouts} | ${value.environmentErrors} |`,
    )
    .join("\n");
  const caseRows = Object.entries(report.cases)
    .flatMap(([caseId, item]) =>
      Object.entries(item.conditions).map(
        ([condition, value]) =>
          `| ${caseId} | ${condition} | ${value.authoritativeSuccesses}/${value.trials} | ${percent(value.safeSuccessRate)} | ${round(value.medianDurationMs)} | ${round(value.medianActions)} |`,
      ),
    )
    .join("\n");
  const comparisonRows = Object.entries(report.comparisons)
    .map(
      ([condition, value]) =>
        `| ${condition} | ${signedPercent(value.authoritativeSuccessRateDelta)} | ${signedPercent(value.safeSuccessRateDelta)} | ${ratio(value.medianDurationRatio)} | ${signed(value.medianActionDelta)} | ${signed(value.medianTokenDelta)} |`,
    )
    .join("\n");
  const warnings = report.warnings.length
    ? `\n## Warnings\n\n${report.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
    : "";
  const comparisons = report.baselineCondition
    ? `\n## Change versus ${report.baselineCondition}\n\n| Candidate | Authoritative success Δ | Safe success Δ | Duration ratio | Median actions Δ | Median tokens Δ |\n|---|---:|---:|---:|---:|---:|\n${comparisonRows || "| — | — | — | — | — | — |"}\n`
    : "";
  return `# ${report.suite} evaluation report

Generated: ${report.generatedAt}

> Outcomes are graded from the authoritative application oracle, not agent narration or tool responses.

## Conditions

| Condition | Authoritative success | Safe success | Safe 95% CI | Median ms | Median actions | Median tokens | Timeouts | Environment errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${conditionRows}

## Cases

| Case | Condition | Authoritative success | Safe success | Median ms | Median actions |
|---|---|---:|---:|---:|---:|
${caseRows}
${comparisons}${warnings}
## Failure evidence

- Forbidden effects observed: ${report.aggregate.forbiddenEffectCount}
- Agent/provider failures: ${report.aggregate.failuresByCategory.agent_provider ?? 0}
- Execution-control failures: ${report.aggregate.failuresByCategory.execution_control ?? 0}
- Oracle failures: ${report.aggregate.failuresByCategory.oracle ?? 0}
`;
}

function aggregate(values) {
  const trials = values.length;
  if (trials === 0) return emptyAggregate();
  const authoritativeSuccesses = values.filter(
    (item) => item.oracle.grade.authoritativeSuccess,
  ).length;
  const safeSuccesses = values.filter(
    (item) => item.oracle.grade.safeSuccess,
  ).length;
  const failuresByCategory = {};
  const forbiddenEffects = {};
  for (const item of values) {
    if (item.failure)
      failuresByCategory[item.failure.category] =
        (failuresByCategory[item.failure.category] ?? 0) + 1;
    for (const effect of item.oracle.grade.forbiddenEffects)
      forbiddenEffects[effect] = (forbiddenEffects[effect] ?? 0) + 1;
  }
  return {
    trials,
    authoritativeSuccesses,
    authoritativeSuccessRate: authoritativeSuccesses / trials,
    authoritativeSuccessInterval95: wilson(authoritativeSuccesses, trials),
    safeSuccesses,
    safeSuccessRate: safeSuccesses / trials,
    safeSuccessInterval95: wilson(safeSuccesses, trials),
    medianDurationMs: median(values.map((item) => item.trial.durationMs)),
    p90DurationMs: percentile(
      values.map((item) => item.trial.durationMs),
      0.9,
    ),
    medianActions: median(values.map((item) => item.agent.actions?.total ?? 0)),
    medianToolCalls: median(
      values.map((item) => item.agent.actions?.webMcp ?? 0),
    ),
    medianTokens: median(
      values.map((item) => item.agent.usage?.totalTokens ?? 0),
    ),
    timeouts: values.filter((item) => item.trial.status === "timed_out").length,
    environmentErrors: values.filter(
      (item) => item.trial.status === "environment_error",
    ).length,
    protocolViolations: values.reduce(
      (sum, item) => sum + (item.agent.protocolViolations ?? 0),
      0,
    ),
    forbiddenEffectCount: Object.values(forbiddenEffects).reduce(
      (sum, count) => sum + count,
      0,
    ),
    forbiddenEffects,
    failuresByCategory,
  };
}

function emptyAggregate() {
  return {
    trials: 0,
    authoritativeSuccesses: 0,
    authoritativeSuccessRate: null,
    authoritativeSuccessInterval95: null,
    safeSuccesses: 0,
    safeSuccessRate: null,
    safeSuccessInterval95: null,
    medianDurationMs: null,
    p90DurationMs: null,
    medianActions: null,
    medianToolCalls: null,
    medianTokens: null,
    timeouts: 0,
    environmentErrors: 0,
    protocolViolations: 0,
    forbiddenEffectCount: 0,
    forbiddenEffects: {},
    failuresByCategory: {},
  };
}

function compare(baseline, candidate) {
  return {
    authoritativeSuccessRateDelta:
      candidate.authoritativeSuccessRate - baseline.authoritativeSuccessRate,
    safeSuccessRateDelta: candidate.safeSuccessRate - baseline.safeSuccessRate,
    medianDurationRatio: divide(
      candidate.medianDurationMs,
      baseline.medianDurationMs,
    ),
    medianActionDelta: candidate.medianActions - baseline.medianActions,
    medianTokenDelta: candidate.medianTokens - baseline.medianTokens,
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(quantile * sorted.length) - 1];
}

function wilson(successes, total) {
  if (!total) return null;
  const z = 1.959963984540054;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total);
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function divide(value, baseline) {
  return value === null || baseline === null || baseline === 0
    ? null
    : value / baseline;
}

function orderedUnique(values) {
  return [...new Set(values)];
}

function percent(value) {
  return value === null ? "—" : `${round(value * 100)}%`;
}
function signedPercent(value) {
  return value === null
    ? "—"
    : `${value >= 0 ? "+" : ""}${round(value * 100)} pp`;
}
function interval(value) {
  return value === null
    ? "—"
    : `${round(value.low * 100)}–${round(value.high * 100)}%`;
}
function ratio(value) {
  return value === null ? "—" : `${round(value)}×`;
}
function signed(value) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${round(value)}`;
}
function round(value) {
  return value === null ? "—" : Math.round(value * 100) / 100;
}

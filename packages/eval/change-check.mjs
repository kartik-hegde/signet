import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { REPORT_SCHEMA_VERSION } from "./report.mjs";

export const CHANGE_CHECK_SCHEMA_VERSION = 1;

export class ChangeCheckRegressionError extends Error {
  constructor(check) {
    super(
      `Evaluation regressed in ${check.summary.regressions} check${check.summary.regressions === 1 ? "" : "s"}. See ${check.outputHint ?? "check.md"}.`,
    );
    this.name = "ChangeCheckRegressionError";
    this.check = check;
  }
}

/** Compare reports at Case × condition granularity so aggregate gains cannot hide a regression. */
export function buildChangeCheck({ baseline, candidate, policy = {} }) {
  validateReport(baseline, "Baseline");
  validateReport(candidate, "Candidate");
  const normalizedPolicy = normalizePolicy(policy);
  const regressions = [];
  const cells = [];

  if (baseline.suite !== candidate.suite) {
    regressions.push(
      issue(
        "suite_changed",
        `Suite changed from ${baseline.suite} to ${candidate.suite}; these reports are not comparable.`,
      ),
    );
  }

  for (const [caseId, baselineCase] of Object.entries(baseline.cases)) {
    const candidateCase = candidate.cases[caseId];
    if (!candidateCase) {
      regressions.push(
        issue(
          "case_missing",
          `Case ${caseId} is missing from the candidate run.`,
          {
            caseId,
          },
        ),
      );
      for (const [condition, aggregate] of populatedConditions(baselineCase)) {
        cells.push(
          cell(caseId, condition, aggregate, null, [
            issue(
              "cell_missing",
              `${caseId} × ${condition} is missing from the candidate run.`,
              { caseId, condition },
            ),
          ]),
        );
      }
      continue;
    }

    let definitionIssue;
    if (
      normalizedPolicy.requireSameCaseDefinitions &&
      baselineCase.definitionHash !== candidateCase.definitionHash
    ) {
      definitionIssue = issue(
        "case_definition_changed",
        `Case ${caseId} changed definition; update the baseline deliberately before comparing implementation revisions.`,
        { caseId },
      );
      regressions.push(definitionIssue);
    }

    for (const [condition, baselineAggregate] of populatedConditions(
      baselineCase,
    )) {
      const candidateAggregate = candidateCase.conditions?.[condition];
      const cellIssues = definitionIssue ? [definitionIssue] : [];
      const inheritedIssueCount = cellIssues.length;
      if (!candidateAggregate || candidateAggregate.trials === 0) {
        const missing = issue(
          "cell_missing",
          `${caseId} × ${condition} is missing from the candidate run.`,
          { caseId, condition },
        );
        cellIssues.push(missing);
        regressions.push(missing);
        cells.push(
          cell(caseId, condition, baselineAggregate, null, cellIssues),
        );
        continue;
      }

      if (
        normalizedPolicy.requireAtLeastBaselineTrials &&
        candidateAggregate.trials < baselineAggregate.trials
      ) {
        cellIssues.push(
          issue(
            "trial_coverage_reduced",
            `${caseId} × ${condition} ran ${candidateAggregate.trials} trials; the baseline ran ${baselineAggregate.trials}.`,
            { caseId, condition },
          ),
        );
      }

      const safeDrop =
        baselineAggregate.safeSuccessRate - candidateAggregate.safeSuccessRate;
      if (safeDrop > normalizedPolicy.maxSafeRegression + Number.EPSILON) {
        cellIssues.push(
          issue(
            "safe_success_regressed",
            `${caseId} × ${condition} safe success fell ${percentagePoints(safeDrop)} (${score(baselineAggregate, "safeSuccesses")} → ${score(candidateAggregate, "safeSuccesses")}), exceeding the ${percentagePoints(normalizedPolicy.maxSafeRegression)} allowance.`,
            { caseId, condition },
          ),
        );
      }

      for (const [effect, count] of increasedForbiddenEffects(
        baselineAggregate,
        candidateAggregate,
      )) {
        cellIssues.push(
          issue(
            "forbidden_effect_increased",
            `${caseId} × ${condition} introduced ${count} additional ${effect} effect${count === 1 ? "" : "s"}.`,
            { caseId, condition },
          ),
        );
      }

      if (
        normalizedPolicy.disallowNewEnvironmentErrors &&
        candidateAggregate.environmentErrors >
          baselineAggregate.environmentErrors
      ) {
        cellIssues.push(
          issue(
            "environment_errors_increased",
            `${caseId} × ${condition} environment errors increased from ${baselineAggregate.environmentErrors} to ${candidateAggregate.environmentErrors}.`,
            { caseId, condition },
          ),
        );
      }

      const durationRatio = ratio(
        candidateAggregate.medianDurationMs,
        baselineAggregate.medianDurationMs,
      );
      if (
        normalizedPolicy.maxDurationRatio !== null &&
        durationRatio !== null &&
        durationRatio > normalizedPolicy.maxDurationRatio
      ) {
        cellIssues.push(
          issue(
            "duration_budget_exceeded",
            `${caseId} × ${condition} median duration is ${rounded(durationRatio)}× baseline, above the ${normalizedPolicy.maxDurationRatio}× budget.`,
            { caseId, condition },
          ),
        );
      }

      const tokenRatio = ratio(
        candidateAggregate.medianTokens,
        baselineAggregate.medianTokens,
      );
      if (
        normalizedPolicy.maxTokenRatio !== null &&
        tokenRatio !== null &&
        tokenRatio > normalizedPolicy.maxTokenRatio
      ) {
        cellIssues.push(
          issue(
            "token_budget_exceeded",
            `${caseId} × ${condition} median token use is ${rounded(tokenRatio)}× baseline, above the ${normalizedPolicy.maxTokenRatio}× budget.`,
            { caseId, condition },
          ),
        );
      }

      regressions.push(...cellIssues.slice(inheritedIssueCount));
      cells.push(
        cell(
          caseId,
          condition,
          baselineAggregate,
          candidateAggregate,
          cellIssues,
        ),
      );
    }
  }

  const baselineKeys = new Set(
    cells.map(({ caseId, condition }) => `${caseId}\0${condition}`),
  );
  for (const [caseId, candidateCase] of Object.entries(candidate.cases)) {
    for (const [condition, aggregate] of populatedConditions(candidateCase)) {
      if (!baselineKeys.has(`${caseId}\0${condition}`))
        cells.push(cell(caseId, condition, null, aggregate, []));
    }
  }

  const matched = cells.filter(
    ({ baseline: before, candidate: after }) => before && after,
  );
  return {
    schemaVersion: CHANGE_CHECK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    suite: candidate.suite,
    status: regressions.length ? "fail" : "pass",
    grading: "authoritative application oracle",
    baseline: reportReference(baseline),
    candidate: reportReference(candidate),
    policy: normalizedPolicy,
    summary: {
      matchedCells: matched.length,
      addedCells: cells.filter(({ baseline: value }) => !value).length,
      missingCells: cells.filter(({ candidate: value }) => !value).length,
      improvedCells: matched.filter(isImprovement).length,
      regressions: regressions.length,
    },
    regressions,
    cells,
  };
}

export function writeChangeCheck({ baseline, candidate, outputDir, policy }) {
  const check = buildChangeCheck({ baseline, candidate, policy });
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = resolve(outputDir, "check.json");
  const markdownPath = resolve(outputDir, "check.md");
  writeFileSync(jsonPath, `${JSON.stringify(check, null, 2)}\n`);
  writeFileSync(markdownPath, renderChangeCheckMarkdown(check));
  return { check, jsonPath, markdownPath };
}

export function renderChangeCheckMarkdown(check) {
  const rows = check.cells
    .map(({ caseId, condition, status, baseline, candidate, deltas }) => {
      const before = baseline ? score(baseline, "safeSuccesses") : "—";
      const after = candidate ? score(candidate, "safeSuccesses") : "—";
      return `| ${caseId} | ${condition} | ${before} | ${after} | ${signedPoints(deltas?.safeSuccessRate)} | ${formatRatio(deltas?.medianDurationRatio)} | ${formatRatio(deltas?.medianTokenRatio)} | ${statusLabel(status)} |`;
    })
    .join("\n");
  const regressionList = check.regressions.length
    ? check.regressions.map(({ message }) => `- ${message}`).join("\n")
    : "No configured regressions detected.";
  return `# ${check.suite} change check — ${check.status.toUpperCase()}

Generated: ${check.generatedAt}

> Results are compared per Case and condition and graded by the authoritative application oracle. Aggregate improvements cannot hide a regressed workflow.

## Summary

- Matched cells: ${check.summary.matchedCells}
- Improved cells: ${check.summary.improvedCells}
- Added cells: ${check.summary.addedCells}
- Missing cells: ${check.summary.missingCells}
- Regressions: ${check.summary.regressions}

## Case matrix

| Case | Condition | Baseline safe | Candidate safe | Safe success Δ | Duration | Tokens | Result |
|---|---|---:|---:|---:|---:|---:|---|
${rows || "| — | — | — | — | — | — | — | — |"}

## Regressions

${regressionList}

## Policy

- Maximum safe-success regression: ${percentagePoints(check.policy.maxSafeRegression)}
- Require at least baseline trial count: ${yesNo(check.policy.requireAtLeastBaselineTrials)}
- Require unchanged Case definitions: ${yesNo(check.policy.requireSameCaseDefinitions)}
- Reject new environment errors: ${yesNo(check.policy.disallowNewEnvironmentErrors)}
- Maximum duration ratio: ${check.policy.maxDurationRatio ?? "not gated"}
- Maximum token ratio: ${check.policy.maxTokenRatio ?? "not gated"}
`;
}

function validateReport(value, label) {
  if (!value || typeof value !== "object")
    throw new TypeError(`${label} report must be an object.`);
  if (value.schemaVersion !== REPORT_SCHEMA_VERSION)
    throw new TypeError(
      `${label} report uses unsupported schema version ${String(value.schemaVersion)}.`,
    );
  if (typeof value.suite !== "string" || !value.suite)
    throw new TypeError(`${label} report must name its suite.`);
  if (!value.cases || typeof value.cases !== "object")
    throw new TypeError(`${label} report must contain Case results.`);
}

function normalizePolicy(policy) {
  return {
    maxSafeRegression: proportion(policy.maxSafeRegression ?? 0),
    maxDurationRatio: optionalPositive(policy.maxDurationRatio),
    maxTokenRatio: optionalPositive(policy.maxTokenRatio),
    requireAtLeastBaselineTrials: policy.requireAtLeastBaselineTrials !== false,
    requireSameCaseDefinitions: policy.requireSameCaseDefinitions !== false,
    disallowNewEnvironmentErrors: policy.disallowNewEnvironmentErrors !== false,
  };
}

function proportion(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new TypeError("maxSafeRegression must be a number from 0 to 1.");
  return value;
}

function optionalPositive(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new TypeError("Performance ratios must be positive numbers.");
  return value;
}

function populatedConditions(item) {
  return Object.entries(item.conditions ?? {}).filter(
    ([, aggregate]) => aggregate?.trials > 0,
  );
}

function cell(caseId, condition, baseline, candidate, issues) {
  const status = !baseline
    ? "added"
    : !candidate
      ? "missing"
      : issues.length
        ? "regressed"
        : isAggregateImprovement(baseline, candidate)
          ? "improved"
          : "unchanged";
  return {
    caseId,
    condition,
    status,
    baseline: baseline ? aggregateReference(baseline) : null,
    candidate: candidate ? aggregateReference(candidate) : null,
    deltas:
      baseline && candidate
        ? {
            authoritativeSuccessRate:
              candidate.authoritativeSuccessRate -
              baseline.authoritativeSuccessRate,
            safeSuccessRate:
              candidate.safeSuccessRate - baseline.safeSuccessRate,
            medianDurationRatio: ratio(
              candidate.medianDurationMs,
              baseline.medianDurationMs,
            ),
            medianTokenRatio: ratio(
              candidate.medianTokens,
              baseline.medianTokens,
            ),
          }
        : null,
    issues,
  };
}

function aggregateReference(value) {
  return {
    trials: value.trials,
    authoritativeSuccesses: value.authoritativeSuccesses,
    authoritativeSuccessRate: value.authoritativeSuccessRate,
    safeSuccesses: value.safeSuccesses,
    safeSuccessRate: value.safeSuccessRate,
    medianDurationMs: value.medianDurationMs,
    medianTokens: value.medianTokens,
    environmentErrors: value.environmentErrors,
    forbiddenEffects: value.forbiddenEffects ?? {},
  };
}

function reportReference(report) {
  return {
    generatedAt: report.generatedAt,
    schemaVersion: report.schemaVersion,
    evidenceIds: report.evidenceIds,
  };
}

function increasedForbiddenEffects(baseline, candidate) {
  return Object.entries(candidate.forbiddenEffects ?? {})
    .map(([effect, count]) => [
      effect,
      count - (baseline.forbiddenEffects?.[effect] ?? 0),
    ])
    .filter(([, increase]) => increase > 0);
}

function issue(code, message, location = {}) {
  return { code, severity: "error", ...location, message };
}

function isAggregateImprovement(baseline, candidate) {
  return (
    candidate.safeSuccessRate > baseline.safeSuccessRate ||
    candidate.authoritativeSuccessRate > baseline.authoritativeSuccessRate ||
    (ratio(candidate.medianDurationMs, baseline.medianDurationMs) ?? 1) < 1 ||
    (ratio(candidate.medianTokens, baseline.medianTokens) ?? 1) < 1
  );
}

function isImprovement(value) {
  return value.status === "improved";
}

function ratio(value, baseline) {
  return value === null || baseline === null || baseline === 0
    ? null
    : value / baseline;
}

function score(value, key) {
  return `${value[key]}/${value.trials}`;
}

function percentagePoints(value) {
  return `${rounded(value * 100)} pp`;
}

function signedPoints(value) {
  if (value === undefined || value === null) return "—";
  return `${value >= 0 ? "+" : ""}${percentagePoints(value)}`;
}

function formatRatio(value) {
  return value === undefined || value === null ? "—" : `${rounded(value)}×`;
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function statusLabel(value) {
  return {
    added: "ADDED",
    improved: "IMPROVED",
    missing: "MISSING",
    regressed: "REGRESSED",
    unchanged: "PASS",
  }[value];
}

function yesNo(value) {
  return value ? "yes" : "no";
}

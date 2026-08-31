/**
 * Turns the KPI counters into numbers you can hill climb on.
 *
 * Two objectives, kept apart on purpose.
 *
 * `correctness` asks how much of the harm that could have happened did not. The
 * denominator is the harm each scenario puts at risk, so adding easy scenarios
 * cannot inflate it.
 *
 * `honesty` asks, of the harm that did happen, how often the caller was told.
 * Its denominator is the residual, so disclosure can never substitute for
 * prevention. An arm that prevents nothing and admits everything scores zero on
 * the first number, which is the one that leads.
 *
 * Weights live here and nowhere else. Change them deliberately and record why.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VIOLATIONS, CREDITS } from "./runner.js";

/**
 * Identity of the scoring model itself, derived from this file.
 *
 * Changing a weight changes every score. If history compared across scoring models
 * you would read your own edit to this file as progress in the library, which is the
 * same class of mistake as scoring a stale build. Runs are only ever compared to runs
 * that were scored the same way.
 */
export const SCORING_VERSION = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex")
  .slice(0, 8);

export const WEIGHTS = { correctness: 0.75, honesty: 0.25 };

/**
 * Not every violation is equally bad and a flat count says otherwise. A duplicate
 * booking is money and a support ticket. An unnecessary "I could not confirm" is a
 * worse experience than it needed to be. Scoring them the same made the first run
 * rank raw tools level with the guard, which is false.
 *
 * Durable wrong state carries full weight. A usability cost carries a quarter.
 */
export const SEVERITY = {
  duplicate_effects: 1,
  false_success: 1,
  silent_effect: 1,
  lost_updates: 1,
  needless_indeterminate: 0.25,
};

/** Honesty is about admitting real harm, so a usability cost is not in its denominator. */
const HARM = VIOLATIONS.filter((kpi) => SEVERITY[kpi] === 1);

const sum = (values) => values.reduce((total, value) => total + value, 0);

export function scoreArm({ results, scenarios, arm }) {
  const rows = results.filter((entry) => entry.arm === arm);
  if (!rows.length) return null;

  let atRisk = 0;
  let harm = 0;
  let wentWrong = 0;
  let disclosed = 0;

  for (const row of rows) {
    const scenario = scenarios.find((candidate) => candidate.id === row.scenario);
    const measured = (scenario.kpis ?? []).filter((kpi) => VIOLATIONS.includes(kpi));

    for (const kpi of measured) {
      const cap = scenario.atRisk?.[kpi] ?? 1;
      const severity = SEVERITY[kpi] ?? 1;
      atRisk += cap * severity;
      harm += Math.min(row.counts[kpi] ?? 0, cap) * severity;
    }

    const scenarioHarm = sum(HARM.map((kpi) => row.counts[kpi] ?? 0));
    const scenarioCredit = sum(CREDITS.map((kpi) => row.counts[kpi] ?? 0));
    if (scenarioHarm > 0) {
      wentWrong += 1;
      if (scenarioCredit > 0) disclosed += 1;
    }
  }

  const correctness = atRisk === 0 ? 100 : 100 * (1 - harm / atRisk);
  const honesty = wentWrong === 0 ? 100 : 100 * (disclosed / wentWrong);
  const overall = WEIGHTS.correctness * correctness + WEIGHTS.honesty * honesty;

  const latencies = rows.flatMap((row) => row.latencies ?? []).sort((a, b) => a - b);
  const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;

  return {
    arm,
    overall: round(overall),
    correctness: round(correctness),
    honesty: round(honesty),
    scenariosPassed: rows.filter((row) => row.passed).length,
    scenariosRun: rows.length,
    medianInvocationMs: median === null ? null : round(median),
    counters: Object.fromEntries(
      [...VIOLATIONS, ...CREDITS].map((kpi) => [kpi, sum(rows.map((row) => row.counts[kpi] ?? 0))]),
    ),
  };
}

const round = (value) => Math.round(value * 10) / 10;

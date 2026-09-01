import assert from "node:assert/strict";
import test from "node:test";

import { buildReport, createEvidence, defineCase, renderMarkdownReport } from "../index.mjs";

const caseDefinition = defineCase({
  id: "pay-once",
  intent: "Send one payment and create exactly one transaction.",
  kind: "consequential",
  application: "payments",
  oracle: "database",
  expectations: { forbiddenEffects: ["duplicate-payment"] },
});

function evidence(condition, index, success, durationMs, actions) {
  return createEvidence({
    evidenceId: `${condition}-${index}`,
    generatedAt: "2026-08-31T20:00:00.000Z",
    caseDefinition,
    trial: {
      id: `${caseDefinition.id}:${condition}:${index}`,
      index,
      condition,
      startedAt: "2026-08-31T20:00:00.000Z",
      durationMs,
      status: "completed",
    },
    provenance: {
      application: { id: "payments" }, browser: { id: "chrome" },
      agent: { id: "agent" }, oracle: { id: "database" },
    },
    agent: {
      provider: "test", model: "deterministic", timedOut: false,
      protocolViolations: 0, usage: { totalTokens: actions * 100 },
      actions: { total: actions, webMcp: actions },
    },
    oracle: {
      adapter: "database",
      grade: { authoritativeSuccess: success, safeSuccess: success, forbiddenEffects: [] },
    },
  });
}

test("reports aggregate oracle grades and compare hill-climbing conditions", () => {
  const report = buildReport({
    suite: "payments",
    evidence: [
      evidence("signet-baseline", 1, false, 200, 4),
      evidence("signet-baseline", 2, true, 100, 2),
      evidence("signet-guided", 1, true, 80, 1),
      evidence("signet-guided", 2, true, 120, 2),
    ],
  });
  assert.equal(report.conditions["signet-baseline"].safeSuccessRate, 0.5);
  assert.equal(report.conditions["signet-guided"].safeSuccessRate, 1);
  assert.equal(report.comparisons["signet-guided"].safeSuccessRateDelta, 0.5);
  assert.equal(report.comparisons["signet-guided"].medianDurationRatio, 2 / 3);
});

test("Markdown identifies the authoritative grader and confidence interval", () => {
  const report = buildReport({ suite: "payments", evidence: [evidence("signet-baseline", 1, true, 100, 1)] });
  const markdown = renderMarkdownReport(report);
  assert.match(markdown, /authoritative application oracle/);
  assert.match(markdown, /Safe 95% CI/);
  assert.match(markdown, /pay-once/);
});

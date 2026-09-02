import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReport,
  createEvidence,
  defineCase,
  renderMarkdownReport,
  scoreInterfaceQuality,
} from "../index.mjs";

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
      application: { id: "payments" },
      browser: { id: "chrome" },
      agent: { id: "agent" },
      oracle: { id: "database" },
    },
    agent: {
      provider: "test",
      model: "deterministic",
      timedOut: false,
      protocolViolations: 0,
      usage: { totalTokens: actions * 100 },
      actions: { total: actions, webMcp: actions },
    },
    oracle: {
      adapter: "database",
      grade: {
        authoritativeSuccess: success,
        safeSuccess: success,
        forbiddenEffects: [],
      },
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
  const report = buildReport({
    suite: "payments",
    evidence: [evidence("signet-baseline", 1, true, 100, 1)],
  });
  const markdown = renderMarkdownReport(report);
  assert.match(markdown, /authoritative application oracle/);
  assert.match(markdown, /Safe 95% CI/);
  assert.match(markdown, /pay-once/);
});

const capabilityCase = defineCase({
  id: "pay-lia",
  intent: "Send Lia $12.00 exactly once.",
  kind: "consequential",
  application: "payments",
  oracle: "database",
  expectations: {
    requiredCapabilities: ["send_payment"],
    completionCapability: "send_payment",
  },
});

const capabilityInventory = [
  {
    name: "send_payment",
    description: "Send one payment.",
    inputSchema: {
      type: "object",
      properties: { amountCents: { type: "integer" } },
      required: ["amountCents"],
    },
  },
];

function scoredEvidence(
  condition,
  index,
  events,
  inventory = capabilityInventory,
) {
  return createEvidence({
    evidenceId: `${condition}-${index}-scored`,
    generatedAt: "2026-08-31T20:00:00.000Z",
    caseDefinition: capabilityCase,
    trial: {
      id: `${capabilityCase.id}:${condition}:${index}`,
      index,
      condition,
      startedAt: "2026-08-31T20:00:00.000Z",
      durationMs: 100,
      status: "completed",
    },
    provenance: {
      application: { id: "payments" },
      browser: { id: "chrome" },
      agent: { id: "agent" },
      oracle: { id: "database" },
    },
    inventory,
    events,
    agent: {
      provider: "test",
      model: "deterministic",
      timedOut: false,
      usage: { totalTokens: 100 },
      actions: { total: events.length, webMcp: events.length },
    },
    oracle: {
      adapter: "database",
      grade: {
        authoritativeSuccess: true,
        safeSuccess: true,
        forbiddenEffects: [],
      },
    },
    quality: scoreInterfaceQuality({
      caseDefinition: capabilityCase,
      inventory,
      events,
      agent: { timedOut: false },
    }),
  });
}

const paidByTool = [
  {
    sequence: 0,
    atMs: 1,
    type: "webmcp_call",
    tool: "send_payment",
    input: { amountCents: 1200 },
    ok: true,
  },
];
const paidByUi = [{ sequence: 0, atMs: 1, type: "ui_action", action: "click" }];

test("interface-quality dimensions aggregate per condition", () => {
  const report = buildReport({
    suite: "payments",
    evidence: [
      scoredEvidence("signet-baseline", 1, paidByTool),
      scoredEvidence("signet-baseline", 2, paidByUi),
      scoredEvidence("signet-guided", 1, paidByTool),
      scoredEvidence("signet-guided", 2, paidByTool),
    ],
  });
  const baseline = report.conditions["signet-baseline"].interfaceQuality;
  assert.equal(baseline.selection.accuracy, 0.5);
  assert.equal(baseline.discovery.completeRate, 1);
  assert.equal(
    report.conditions["signet-guided"].interfaceQuality.selection.accuracy,
    1,
  );
  assert.equal(report.comparisons["signet-guided"].selectionAccuracyDelta, 0.5);
  assert.match(renderMarkdownReport(report), /Selection accuracy/);
});

test("a dimension the condition never exposed reports no score", () => {
  const uiOnly = [
    {
      name: "click_element",
      description: "Click an inspected element.",
      inputSchema: { type: "object", properties: { ref: { type: "string" } } },
    },
  ];
  const report = buildReport({
    suite: "payments",
    evidence: [scoredEvidence("ui-dom", 1, paidByUi, uiOnly)],
  });
  const quality = report.conditions["ui-dom"].interfaceQuality;
  assert.equal(quality.selection.scoredTrials, 0);
  assert.equal(quality.selection.accuracy, null);
  assert.equal(quality.discovery.completeRate, 0);
  assert.match(renderMarkdownReport(report), /\| ui-dom \| 0% \| — \|/);
});

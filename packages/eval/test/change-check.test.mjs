import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkMain } from "../cli.mjs";
import {
  ChangeCheckRegressionError,
  buildChangeCheck,
  buildReport,
  createEvidence,
  defineCase,
  renderChangeCheckMarkdown,
  scoreInterfaceQuality,
  writeChangeCheck,
} from "../index.mjs";

const cases = {
  pay: defineCase({
    id: "pay-once",
    intent: "Send one payment exactly once.",
    kind: "consequential",
    application: "payments",
    oracle: "database",
    expectations: { forbiddenEffects: ["duplicate-payment"] },
  }),
  find: defineCase({
    id: "find-recipient",
    intent: "Find the intended payment recipient.",
    kind: "read",
    application: "payments",
    oracle: "database",
    expectations: {},
  }),
};

function trial({
  caseDefinition = cases.pay,
  condition = "guided",
  index = 1,
  success = true,
  durationMs = 100,
  tokens = 100,
  forbiddenEffects = [],
  status = "completed",
}) {
  return createEvidence({
    evidenceId: `${caseDefinition.id}-${condition}-${index}-${success}`,
    generatedAt: "2026-09-01T00:00:00.000Z",
    caseDefinition,
    trial: {
      id: `${caseDefinition.id}:${condition}:${index}`,
      index,
      condition,
      startedAt: "2026-09-01T00:00:00.000Z",
      durationMs,
      status,
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
      usage: { totalTokens: tokens },
      actions: { total: 1, webMcp: 1 },
    },
    oracle: {
      adapter: "database",
      grade: {
        authoritativeSuccess: success,
        safeSuccess: success && forbiddenEffects.length === 0,
        forbiddenEffects,
      },
    },
    failure:
      status === "environment_error"
        ? { category: "environment", message: "browser unavailable" }
        : undefined,
  });
}

function report(evidence) {
  return buildReport({ suite: "payments", evidence });
}

test("change checks recognize an improved Case cell", () => {
  const check = buildChangeCheck({
    baseline: report([trial({ success: false })]),
    candidate: report([trial({ success: true })]),
  });
  assert.equal(check.status, "pass");
  assert.equal(check.summary.improvedCells, 1);
  assert.equal(check.cells[0].status, "improved");
});

test("a per-Case regression cannot hide behind an aggregate improvement", () => {
  const baseline = report([
    trial({ caseDefinition: cases.pay, success: true }),
    trial({ caseDefinition: cases.find, success: false }),
  ]);
  const candidate = report([
    trial({ caseDefinition: cases.pay, success: false }),
    trial({ caseDefinition: cases.find, success: true }),
  ]);
  assert.equal(
    baseline.aggregate.safeSuccessRate,
    candidate.aggregate.safeSuccessRate,
  );

  const check = buildChangeCheck({ baseline, candidate });
  assert.equal(check.status, "fail");
  assert.ok(
    check.regressions.some(
      ({ code, caseId }) =>
        code === "safe_success_regressed" && caseId === "pay-once",
    ),
  );
});

test("change checks reject unsafe effects and reduced trial coverage", () => {
  const baseline = report([trial({ index: 1 }), trial({ index: 2 })]);
  const candidate = report([
    trial({ success: false, forbiddenEffects: ["duplicate-payment"] }),
  ]);
  const codes = buildChangeCheck({ baseline, candidate }).regressions.map(
    ({ code }) => code,
  );
  assert.ok(codes.includes("trial_coverage_reduced"));
  assert.ok(codes.includes("forbidden_effect_increased"));
});

test("scenario drift is called out instead of producing a false comparison", () => {
  const baseline = report([trial({})]);
  const candidate = structuredClone(baseline);
  candidate.cases["pay-once"].definitionHash = "0".repeat(64);
  const check = buildChangeCheck({ baseline, candidate });
  assert.ok(
    check.regressions.some(({ code }) => code === "case_definition_changed"),
  );
});

test("optional performance budgets turn cost drift into an explicit gate", () => {
  const check = buildChangeCheck({
    baseline: report([trial({ durationMs: 100, tokens: 100 })]),
    candidate: report([trial({ durationMs: 160, tokens: 130 })]),
    policy: { maxDurationRatio: 1.5, maxTokenRatio: 1.2 },
  });
  const codes = check.regressions.map(({ code }) => code);
  assert.ok(codes.includes("duration_budget_exceeded"));
  assert.ok(codes.includes("token_budget_exceeded"));
});

test("change checks write portable JSON and review-ready Markdown", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "signett-change-check-"),
  );
  try {
    const result = writeChangeCheck({
      baseline: report([trial({ success: false })]),
      candidate: report([trial({ success: true })]),
      outputDir: directory,
    });
    assert.equal(existsSync(result.jsonPath), true);
    assert.equal(existsSync(result.markdownPath), true);
    assert.equal(
      JSON.parse(readFileSync(result.jsonPath, "utf8")).status,
      "pass",
    );
    assert.match(
      renderChangeCheckMarkdown(result.check),
      /authoritative application oracle/,
    );
    assert.match(readFileSync(result.markdownPath, "utf8"), /IMPROVED/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the CLI checks completed reports without rerunning an agent", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "signett-check-cli-"));
  try {
    const baselinePath = path.join(directory, "baseline.json");
    const candidatePath = path.join(directory, "candidate.json");
    writeFileSync(
      baselinePath,
      JSON.stringify(report([trial({ success: false })])),
    );
    writeFileSync(
      candidatePath,
      JSON.stringify(report([trial({ success: true })])),
    );
    const result = await checkMain([
      candidatePath,
      "--against",
      baselinePath,
      "--output",
      directory,
    ]);
    assert.equal(result.check.status, "pass");
    assert.equal(existsSync(path.join(directory, "check.json")), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the CLI writes diagnostics before failing a regressed check", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "signett-check-fail-"));
  try {
    const baselinePath = path.join(directory, "baseline.json");
    const candidatePath = path.join(directory, "candidate.json");
    writeFileSync(baselinePath, JSON.stringify(report([trial({})])));
    writeFileSync(
      candidatePath,
      JSON.stringify(report([trial({ success: false })])),
    );
    await assert.rejects(
      checkMain([
        candidatePath,
        "--against",
        baselinePath,
        "--output",
        directory,
      ]),
      ChangeCheckRegressionError,
    );
    assert.match(
      readFileSync(path.join(directory, "check.md"), "utf8"),
      /safe success fell 100 pp/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const capabilityCase = defineCase({
  id: "pay-with-tools",
  intent: "Send one payment using the published payment tools.",
  kind: "consequential",
  application: "payments",
  oracle: "database",
  expectations: {
    requiredCapabilities: ["send_payment"],
    completionCapability: "send_payment",
  },
});

const paymentInventory = [
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

function scoredTrial({
  index = 1,
  tool = true,
  amountCents = 1200,
  inventory = paymentInventory,
}) {
  const events = tool
    ? [
        {
          sequence: 0,
          atMs: 1,
          type: "webmcp_call",
          tool: "send_payment",
          input: { amountCents },
          ok: true,
        },
      ]
    : [{ sequence: 0, atMs: 1, type: "ui_action", action: "click" }];
  return createEvidence({
    evidenceId: `scored-${index}-${tool}-${amountCents}`,
    generatedAt: "2026-09-01T00:00:00.000Z",
    caseDefinition: capabilityCase,
    trial: {
      id: `${capabilityCase.id}:guided:${index}`,
      index,
      condition: "guided",
      startedAt: "2026-09-01T00:00:00.000Z",
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
      actions: { total: 1, webMcp: events.length },
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

test("an interface revision that loses tool selection fails the check", () => {
  const check = buildChangeCheck({
    baseline: report([scoredTrial({ index: 1 }), scoredTrial({ index: 2 })]),
    candidate: report([
      scoredTrial({ index: 1 }),
      scoredTrial({ index: 2, tool: false }),
    ]),
  });
  assert.equal(check.status, "fail");
  assert.ok(
    check.regressions.some(
      ({ code }) => code === "selection_accuracy_regressed",
    ),
  );
  assert.match(
    renderChangeCheckMarkdown(check),
    /selection accuracy fell 50 pp/,
  );
});

test("an interface revision that loses argument validity fails the check", () => {
  const check = buildChangeCheck({
    baseline: report([scoredTrial({ index: 1 })]),
    candidate: report([scoredTrial({ index: 1, amountCents: "1200" })]),
  });
  assert.equal(check.status, "fail");
  assert.ok(
    check.regressions.some(
      ({ code }) => code === "argument_validity_regressed",
    ),
  );
});

test("removing a required capability fails even when the oracle still passes", () => {
  const check = buildChangeCheck({
    baseline: report([scoredTrial({})]),
    candidate: report([scoredTrial({ inventory: [] })]),
  });
  assert.equal(check.status, "fail");
  assert.ok(
    check.regressions.some(
      ({ code }) => code === "capability_discovery_regressed",
    ),
  );
});

test("a declared tolerance applies to every probabilistic outcome rate", () => {
  const baseline = report([
    scoredTrial({ index: 1 }),
    scoredTrial({ index: 2 }),
  ]);
  const candidate = report([
    scoredTrial({ index: 1 }),
    scoredTrial({ index: 2, tool: false }),
  ]);
  assert.equal(
    buildChangeCheck({
      baseline,
      candidate,
      policy: { maxSafeRegression: 0.5 },
    }).status,
    "pass",
  );
});

test("a baseline without interface-quality metrics is not gated on them", () => {
  const baseline = report([trial({ caseDefinition: cases.pay })]);
  assert.equal(
    baseline.cases["pay-once"].conditions.guided.interfaceQuality.selection
      .accuracy,
    null,
  );
  const check = buildChangeCheck({
    baseline,
    candidate: report([trial({ caseDefinition: cases.pay })]),
  });
  assert.equal(check.status, "pass");
});

test("an increased timeout rate is a regression", () => {
  const check = buildChangeCheck({
    baseline: report([trial({ index: 1 }), trial({ index: 2 })]),
    candidate: report([
      trial({ index: 1 }),
      trial({ index: 2, status: "timed_out" }),
    ]),
  });
  assert.ok(
    check.regressions.some(({ code }) => code === "timeout_rate_increased"),
  );
});

test("a candidate that stops measuring a metric cannot hide behind it", () => {
  const measured = report([scoredTrial({ index: 1 })]);
  // The same run scored by a build that no longer measures interface quality.
  const unmeasured = structuredClone(measured);
  for (const item of Object.values(unmeasured.cases)) {
    for (const aggregate of Object.values(item.conditions)) {
      delete aggregate.interfaceQuality;
    }
  }
  const check = buildChangeCheck({
    baseline: measured,
    candidate: unmeasured,
  });
  assert.equal(check.status, "fail");
  assert.ok(
    check.regressions.some(
      ({ code }) => code === "capability_discovery_unmeasured",
    ),
  );
  assert.match(
    check.regressions.find(
      ({ code }) => code === "capability_discovery_unmeasured",
    ).message,
    /no longer measures capability discovery/,
  );

  // The reverse — a baseline that predates the metric — stays comparable.
  assert.equal(
    buildChangeCheck({ baseline: unmeasured, candidate: measured }).status,
    "pass",
  );
});

#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditCandidate, caseManifest } from "./hidden/audit.mjs";
import { preflight } from "../../execution-safety/harness/preflight.js";

const benchDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(benchDir, "../../..");
const fixtureDir = resolve(benchDir, "fixture");
const signettDir = resolve(root, process.env.SIGNETT_DIR ?? "packages/webmcp");
const trialsPerCondition = positiveInteger(
  process.env.P2_TRIALS ?? "5",
  "P2_TRIALS",
);
const model = process.env.P2_MODEL ?? "gpt-5.4-mini";
const reasoning = process.env.P2_REASONING ?? "low";
const timeoutMs = positiveInteger(
  process.env.P2_TIMEOUT_MS ?? "180000",
  "P2_TIMEOUT_MS",
);
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const rawDir = resolve(
  root,
  "evidence/raw/developer-productivity/p2-build-vs-buy",
  runStamp,
);
const publicDir = resolve(
  root,
  "evidence/developer-productivity/p2-build-vs-buy",
);
const conditions = ["native", "signett"];

if (process.argv.includes("--help")) {
  console.log(`
Usage: node build-vs-buy/run.mjs

Environment:
  P2_TRIALS       independent attempts per condition (default 5)
  P2_MODEL        Codex model (default gpt-5.4-mini)
  P2_REASONING    reasoning effort (default low)
  P2_TIMEOUT_MS   timeout per attempt (default 180000)
  SIGNETT_DIR     Signett package checkout (default packages/webmcp)
`);
  process.exit(0);
}

mkdirSync(rawDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

console.log("\nPreflight");
const provenance = preflight({ signettDir, benchDir, log: console.log });
const schedule = counterbalancedSchedule(trialsPerCondition);
const runs = [];

console.log(
  `\nP2 BUILD-VS-BUY PILOT\n${trialsPerCondition} independent attempts × 2 conditions · ${model} (${reasoning})\n`,
);

for (const entry of schedule) {
  const label = `${entry.condition}-t${String(entry.trial).padStart(2, "0")}`;
  process.stdout.write(`[${runs.length + 1}/${schedule.length}] ${label} `);
  const result = await runAttempt(entry, label);
  runs.push(result);
  writeFileSync(
    resolve(rawDir, "partial.json"),
    `${JSON.stringify(runs, null, 2)}\n`,
  );
  console.log(
    `${result.conforming ? "CONFORMING" : `${result.hiddenPassed}/${result.hiddenTotal}`} · ` +
      `${(result.implementationMs / 1000).toFixed(1)}s · ${result.productionLoc} LOC · ` +
      `${result.usage.totalTokens} tokens`,
  );
}

const scorecard = buildScorecard(runs, provenance);
writeFileSync(
  resolve(publicDir, "latest.json"),
  `${JSON.stringify(scorecard, null, 2)}\n`,
);
writeFileSync(resolve(publicDir, "latest.md"), renderMarkdown(scorecard));
writeFileSync(
  resolve(rawDir, "scorecard.json"),
  `${JSON.stringify(scorecard, null, 2)}\n`,
);
console.log(renderConsole(scorecard));

async function runAttempt(entry, label) {
  const candidateDir = mkdtempSync(
    path.join(os.tmpdir(), "signett-p2-candidate-"),
  );
  const attemptDir = resolve(rawDir, label);
  mkdirSync(attemptDir, { recursive: true });
  prepareCandidate(candidateDir, entry.condition);

  const prompt = [
    "You are an independent implementer in a controlled build-versus-buy benchmark.",
    ...(entry.condition === "signett"
      ? ["Use $signett-webmcp for this integration task."]
      : []),
    "Read REQUIREMENTS.md and CONDITION.md, then implement solution.mjs completely.",
    "Do not edit app.mjs, public-tests.mjs, REQUIREMENTS.md, CONDITION.md, or package.json.",
    "Run node public-tests.mjs. Do not search outside this workspace for hidden tests or benchmark answers.",
    "Do not use the internet. Do not ask questions. Finish with the best conforming implementation you can produce.",
  ].join("\n");
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--json",
    "--model",
    model,
    "-C",
    candidateDir,
    "-c",
    `model_reasoning_effort=${JSON.stringify(reasoning)}`,
    "-c",
    'approval_policy="never"',
    prompt,
  ];

  const started = performance.now();
  const agent = await runProcess("codex", args, timeoutMs);
  const implementationMs = round(performance.now() - started, 2);
  writeFileSync(resolve(attemptDir, "agent.jsonl"), agent.stdout);
  writeFileSync(resolve(attemptDir, "agent.stderr.log"), agent.stderr);
  if (agent.exitCode !== 0 && !agent.stdout.trim()) {
    rmSync(candidateDir, { recursive: true, force: true });
    throw new Error(
      `implementation agent failed before producing an event for ${label}:\n${agent.stderr.trim()}`,
    );
  }
  const source = readFileSync(resolve(candidateDir, "solution.mjs"), "utf8");
  const visible = spawnSync(process.execPath, ["public-tests.mjs"], {
    cwd: candidateDir,
    encoding: "utf8",
    timeout: 30_000,
  });
  const audit = await auditCandidate({
    candidateDir,
    condition: entry.condition,
    source,
  });
  const hiddenPassed = audit.cases.filter(({ passed }) => passed).length;
  const usage = parseUsage(agent.stdout);
  const agentBehavior = parseAgentBehavior(agent.stdout);

  writeFileSync(resolve(attemptDir, "solution.mjs"), source);
  writeFileSync(
    resolve(attemptDir, "audit.json"),
    `${JSON.stringify({ audit }, null, 2)}\n`,
  );

  rmSync(candidateDir, { recursive: true, force: true });
  return {
    trial: entry.trial,
    order: entry.order,
    condition: entry.condition,
    model,
    reasoning,
    exitCode: agent.exitCode,
    timedOut: agent.timedOut,
    implementationMs,
    productionLoc: countProductionLoc(source),
    visibleTestsPassed: visible.status === 0,
    hiddenPassed,
    hiddenTotal: audit.cases.length,
    conforming: hiddenPassed === audit.cases.length,
    defects: defectSummary(audit.cases),
    cases: audit.cases,
    runtime: audit.runtime,
    usage,
    agentBehavior,
  };
}

function prepareCandidate(candidateDir, condition) {
  for (const name of [
    "app.mjs",
    "public-tests.mjs",
    "solution.mjs",
    "REQUIREMENTS.md",
  ]) {
    copyFileSync(resolve(fixtureDir, name), resolve(candidateDir, name));
  }
  copyFileSync(
    resolve(fixtureDir, condition === "signett" ? "SIGNETT.md" : "NATIVE.md"),
    resolve(candidateDir, "CONDITION.md"),
  );
  writeFileSync(
    resolve(candidateDir, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  if (condition === "signett") {
    installPublishedSignett(candidateDir);
  }
}

function installPublishedSignett(candidateDir) {
  const packageJson = JSON.parse(
    readFileSync(resolve(signettDir, "package.json"), "utf8"),
  );
  const packageDir = resolve(candidateDir, "node_modules/signett");
  mkdirSync(packageDir, { recursive: true });

  for (const name of [
    "dist",
    "recipes",
    "skills",
    "AGENTS.md",
    "README.md",
    "LICENSE",
    "package.json",
  ]) {
    cpSync(resolve(signettDir, name), resolve(packageDir, name), {
      recursive: true,
    });
  }

  for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
    const target = resolve(candidateDir, "node_modules", dependency);
    const packageDependency = resolve(signettDir, "node_modules", dependency);
    const dependencySource = existsSync(packageDependency)
      ? packageDependency
      : resolve(root, "node_modules", dependency);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(dependencySource, target, "dir");
  }

  const projectSkill = resolve(candidateDir, ".agents/skills/signett-webmcp");
  mkdirSync(dirname(projectSkill), { recursive: true });
  cpSync(resolve(packageDir, "skills/signett-webmcp"), projectSkill, {
    recursive: true,
  });
}

function buildScorecard(runs, signettProvenance) {
  const summaries = Object.fromEntries(
    conditions.map((condition) => {
      const selected = runs.filter((run) => run.condition === condition);
      const conforming = selected.filter((run) => run.conforming);
      const runtimes = conforming
        .map((run) => run.runtime)
        .filter((value) => value?.p50Ms);
      return [
        condition,
        {
          attempts: selected.length,
          conforming: conforming.length,
          conformanceRatePct: percent(conforming.length, selected.length),
          hiddenCasesPassed: selected.reduce(
            (sum, run) => sum + run.hiddenPassed,
            0,
          ),
          hiddenCasesTotal: selected.reduce(
            (sum, run) => sum + run.hiddenTotal,
            0,
          ),
          hiddenCasePassRatePct: percent(
            selected.reduce((sum, run) => sum + run.hiddenPassed, 0),
            selected.reduce((sum, run) => sum + run.hiddenTotal, 0),
          ),
          medianImplementationSeconds: round(
            median(selected.map((run) => run.implementationMs)) / 1000,
            2,
          ),
          medianConformingSeconds: conforming.length
            ? round(
                median(conforming.map((run) => run.implementationMs)) / 1000,
                2,
              )
            : null,
          medianProductionLoc: conforming.length
            ? median(conforming.map((run) => run.productionLoc))
            : null,
          medianTokens: median(selected.map((run) => run.usage.totalTokens)),
          medianPackageReads: median(
            selected.map((run) => run.agentBehavior.packageReadCommands),
          ),
          criticalDefects: selected.reduce(
            (sum, run) => sum + run.defects.critical,
            0,
          ),
          majorDefects: selected.reduce(
            (sum, run) => sum + run.defects.major,
            0,
          ),
          runtimeP50Ms: runtimes.length
            ? round(median(runtimes.map(({ p50Ms }) => p50Ms)), 3)
            : null,
          runtimeP95Ms: runtimes.length
            ? round(median(runtimes.map(({ p95Ms }) => p95Ms)), 3)
            : null,
        },
      ];
    }),
  );
  const native = summaries.native;
  const signett = summaries.signett;
  return {
    benchmark: "p2-build-vs-buy",
    version: 1,
    generatedAt: new Date().toISOString(),
    status: trialsPerCondition < 10 ? "pilot" : "study",
    provenance: {
      model,
      reasoning,
      trialsPerCondition,
      timeoutMs,
      signett: publishableProvenance(signettProvenance),
      node: process.version,
      codex: codexVersion(),
      sourceRun: path.relative(root, rawDir),
    },
    contract: {
      conditions: {
        native: "direct modelContext.registerTool with hand-built controls",
        signett: "signett createSignett with the same app-owned dependencies",
      },
      hiddenCases: caseManifest,
      appOwned: [
        "session resolution",
        "business service",
        "atomic idempotency store",
      ],
      controlled: [
        "task",
        "fixture",
        "model",
        "reasoning",
        "timeout",
        "public tests",
        "hidden audit",
      ],
    },
    summaries,
    headline: {
      conformanceRateDeltaPoints: round(
        signett.conformanceRatePct - native.conformanceRatePct,
        2,
      ),
      hiddenCasePassRateDeltaPoints: round(
        signett.hiddenCasePassRatePct - native.hiddenCasePassRatePct,
        2,
      ),
      implementationSpeedup: ratio(
        native.medianConformingSeconds,
        signett.medianConformingSeconds,
      ),
      productionLocReductionPct: reduction(
        native.medianProductionLoc,
        signett.medianProductionLoc,
      ),
      tokenReductionPct: reduction(native.medianTokens, signett.medianTokens),
      runtimeP50OverheadPct:
        native.runtimeP50Ms && signett.runtimeP50Ms
          ? round((signett.runtimeP50Ms / native.runtimeP50Ms - 1) * 100, 2)
          : null,
    },
    runs,
  };
}

function publishableProvenance({ signettDir: _signettDir, ...provenance }) {
  return provenance;
}

function renderConsole(scorecard) {
  const { native, signett } = scorecard.summaries;
  const h = scorecard.headline;
  return `
\nP2 KPI SCORECARD
condition        conforming   hidden cases   median time   median LOC   median tokens   runtime p50
---------------------------------------------------------------------------------------------------
direct WebMCP    ${cell(`${native.conforming}/${native.attempts}`, 13)}${cell(`${native.hiddenCasesPassed}/${native.hiddenCasesTotal}`, 15)}${cell(formatSeconds(native.medianConformingSeconds), 14)}${cell(native.medianProductionLoc ?? "-", 13)}${cell(native.medianTokens, 16)}${native.runtimeP50Ms ?? "-"} ms
Signett           ${cell(`${signett.conforming}/${signett.attempts}`, 13)}${cell(`${signett.hiddenCasesPassed}/${signett.hiddenCasesTotal}`, 15)}${cell(formatSeconds(signett.medianConformingSeconds), 14)}${cell(signett.medianProductionLoc ?? "-", 13)}${cell(signett.medianTokens, 16)}${signett.runtimeP50Ms ?? "-"} ms

HEADLINE  ${formatRatio(h.implementationSpeedup)} conforming implementation speed · ${reductionPhrase(h.productionLocReductionPct, "bespoke code")} · ${signed(h.conformanceRateDeltaPoints)} pp conformance
RUNTIME   ${h.runtimeP50OverheadPct == null ? "not comparable" : `${signed(h.runtimeP50OverheadPct)}% median invocation overhead`} at 2 ms app latency
STATUS    ${scorecard.status}; failures retained and every outcome included
\n`;
}

function renderMarkdown(scorecard) {
  const { native, signett } = scorecard.summaries;
  const h = scorecard.headline;
  return `# P2 build-versus-buy scorecard

Generated ${scorecard.generatedAt}. Status: **${scorecard.status}**.

| Condition | Conforming attempts | Hidden cases | Median conforming implementation | Median conforming production LOC | Median tokens | Package reads | Runtime p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Direct WebMCP | ${native.conforming}/${native.attempts} | ${native.hiddenCasesPassed}/${native.hiddenCasesTotal} (${native.hiddenCasePassRatePct}%) | ${formatSeconds(native.medianConformingSeconds)} | ${native.medianProductionLoc ?? "—"} | ${native.medianTokens} | ${native.medianPackageReads} | ${native.runtimeP50Ms ?? "—"} ms |
| Signett | ${signett.conforming}/${signett.attempts} | ${signett.hiddenCasesPassed}/${signett.hiddenCasesTotal} (${signett.hiddenCasePassRatePct}%) | ${formatSeconds(signett.medianConformingSeconds)} | ${signett.medianProductionLoc ?? "—"} | ${signett.medianTokens} | ${signett.medianPackageReads} | ${signett.runtimeP50Ms ?? "—"} ms |

## Headline

- **${formatRatio(h.implementationSpeedup)} implementation speed** for Signett versus direct WebMCP.
- **${reductionPhrase(h.productionLocReductionPct, "bespoke production code")}** among conforming attempts at the median.
- **${signed(h.conformanceRateDeltaPoints)} percentage points** in first-pass full conformance and **${signed(h.hiddenCasePassRateDeltaPoints)} points** in hidden-case pass rate.
- **${reductionPhrase(h.tokenReductionPct, "implementation tokens")}** at the median.
- **${h.runtimeP50OverheadPct == null ? "Runtime not comparable because one arm had no conforming attempt" : `${signed(h.runtimeP50OverheadPct)}% p50 invocation overhead`}** with a 2 ms simulated application operation.

## Interpretation

This isolates the technical “why not build it on WebMCP?” question. Both cohorts received the same app-owned session resolver, business service, atomic operation store, public requirements, visible checks, model, and budget. The direct cohort implemented the integration controls itself; the Signett cohort used the four-field Signett interface and hooks. A frozen 14-case suite, not shown in the agent prompt, scored validation, authorization, replay, concurrency, intent-safe keys, retry, verification, cancellation, lifecycle, and trace behavior.

This is a ${scorecard.status}, not a population estimate. The implementation agent can vary across attempts, and the public suite becomes gameable after publication. A launch-grade claim should use at least 10–20 attempts per condition, preregistration, an isolated evaluator, and confidence intervals. Runtime measures only conforming solutions and should be read as a guardrail, not the product's primary value.

Signett source: commit \`${scorecard.provenance.signett.commit}\`, content hash \`${scorecard.provenance.signett.srcHash}\`. Model: \`${scorecard.provenance.model}\` at \`${scorecard.provenance.reasoning}\` reasoning. Raw attempts are retained locally at \`${scorecard.provenance.sourceRun}\`.
`;
}

function counterbalancedSchedule(trials) {
  const schedule = [];
  for (let trial = 1; trial <= trials; trial += 1) {
    const order = trial % 2 === 1 ? conditions : [...conditions].reverse();
    order.forEach((condition, index) =>
      schedule.push({ trial, condition, order: index + 1 }),
    );
  }
  return schedule;
}

function parseUsage(stdout) {
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const usage =
    events.findLast(({ type }) => type === "turn.completed")?.usage ?? {};
  return {
    inputTokens: usage.input_tokens ?? 0,
    cachedInputTokens: usage.cached_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
  };
}

function parseAgentBehavior(stdout) {
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const commands = events
    .filter(
      ({ type, item }) =>
        type === "item.completed" && item?.type === "command_execution",
    )
    .map(({ item }) => item.command ?? "");

  return {
    commandCount: commands.length,
    packageReadCommands: commands.filter((command) =>
      command.includes("signett"),
    ).length,
  };
}

function countProductionLoc(source) {
  let blockComment = false;
  return source.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("/*")) blockComment = true;
    const count = trimmed && !blockComment && !trimmed.startsWith("//");
    if (trimmed.endsWith("*/")) blockComment = false;
    return count;
  }).length;
}

function defectSummary(cases) {
  return cases
    .filter(({ passed }) => !passed)
    .reduce(
      (counts, { severity }) => ({
        ...counts,
        [severity]: counts[severity] + 1,
      }),
      { critical: 0, major: 0 },
    );
}

function runProcess(command, args, timeout) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeout);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolveRun({ exitCode, timedOut, stdout, stderr });
    });
  });
}

function codexVersion() {
  const value = spawnSync("codex", ["--version"], { encoding: "utf8" });
  return value.stdout.trim() || "unknown";
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percent(part, total) {
  return total ? round((part / total) * 100, 2) : 0;
}

function ratio(numerator, denominator) {
  return denominator ? round(numerator / denominator, 2) : null;
}

function reduction(baseline, subject) {
  return baseline ? round((1 - subject / baseline) * 100, 2) : null;
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function signed(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function formatRatio(value) {
  return value == null ? "not comparable" : `${value}×`;
}

function reductionPhrase(value, noun) {
  if (value == null) return `${noun} not comparable`;
  return value >= 0
    ? `${value}% less ${noun}`
    : `${Math.abs(value)}% more ${noun}`;
}

function formatSeconds(value) {
  return value == null ? "—" : `${value}s`;
}

function cell(value, width) {
  return String(value).padEnd(width);
}

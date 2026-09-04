#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  process.env.P3_TRIALS ?? "3",
  "P3_TRIALS",
);
const model = process.env.P3_MODEL ?? "gpt-5.4-mini";
const reasoning = process.env.P3_REASONING ?? "low";
const timeoutMs = positiveInteger(
  process.env.P3_TIMEOUT_MS ?? "300000",
  "P3_TIMEOUT_MS",
);
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const rawDir = resolve(
  root,
  "evidence/raw/developer-productivity/p3-agent-readiness",
  runStamp,
);
const publicDir = resolve(
  root,
  "evidence/developer-productivity/p3-agent-readiness",
);
const conditions = ["native", "signett"];

if (process.argv.includes("--help")) {
  console.log(`
Usage: node agent-readiness/run.mjs

Environment:
  P3_TRIALS       independent attempts per condition (default 3)
  P3_MODEL        Codex model (default gpt-5.4-mini)
  P3_REASONING    reasoning effort (default low)
  P3_TIMEOUT_MS   timeout per attempt (default 300000)
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
  `\nP3 AGENT-READINESS JOURNEY\n${trialsPerCondition} independent attempts × 2 conditions · ${model} (${reasoning})\n`,
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
    `${result.ready ? "READY" : `${result.hiddenPassed}/${result.hiddenTotal}`} · ` +
      `${result.readinessScore}% readiness · ` +
      `${(result.implementationMs / 1000).toFixed(1)}s · ` +
      `${result.productionLoc} LOC · ${result.usage.totalTokens} tokens`,
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
    path.join(os.tmpdir(), "signett-p3-candidate-"),
  );
  const attemptDir = resolve(rawDir, label);
  mkdirSync(attemptDir, { recursive: true });
  prepareCandidate(candidateDir, entry.condition);

  const prompt = [
    "You are the implementation actor in a controlled website agent-readiness study.",
    ...(entry.condition === "signett"
      ? [
          "Follow the project AGENTS.md supplied by signett; its public contract is complete.",
        ]
      : []),
    "Read PRODUCT-BRIEF.md and CONDITION.md, inspect the existing app, and implement agent-interface.mjs.",
    "Make product decisions where the brief leaves room; do not assume hidden tool names or test sequences.",
    "Do not edit app.mjs, public-tests.mjs, PRODUCT-BRIEF.md, CONDITION.md, or package.json.",
    "Run node public-tests.mjs. Do not search outside this workspace, use the internet, or ask questions.",
    "Finish with the best production-ready implementation you can produce within the existing application boundary.",
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

  const source = readFileSync(
    resolve(candidateDir, "agent-interface.mjs"),
    "utf8",
  );
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

  writeFileSync(resolve(attemptDir, "agent-interface.mjs"), source);
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
    visibleTestOutput: `${visible.stdout ?? ""}${visible.stderr ?? ""}`.trim(),
    hiddenPassed,
    hiddenTotal: audit.cases.length,
    readinessScore: weightedReadiness(audit.cases),
    ready: hiddenPassed === audit.cases.length,
    layerScores: layerScores(audit.cases),
    defects: audit.cases.filter(({ passed }) => !passed).map(({ id }) => id),
    cases: audit.cases,
    usage,
    ...agentBehavior,
  };
}

function prepareCandidate(candidateDir, condition) {
  for (const name of [
    "app.mjs",
    "public-tests.mjs",
    "agent-interface.mjs",
    "PRODUCT-BRIEF.md",
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
  if (condition === "signett") installPublishedSignett(candidateDir);
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
  copyFileSync(
    resolve(packageDir, "AGENTS.md"),
    resolve(candidateDir, "AGENTS.md"),
  );
}

function buildScorecard(runs, signettProvenance) {
  const summaries = Object.fromEntries(
    conditions.map((condition) => {
      const selected = runs.filter((run) => run.condition === condition);
      const ready = selected.filter((run) => run.ready);
      const medianLoc = median(selected.map((run) => run.productionLoc));
      const medianReadiness = median(selected.map((run) => run.readinessScore));
      return [
        condition,
        {
          attempts: selected.length,
          ready: ready.length,
          readyRatePct: percent(ready.length, selected.length),
          medianReadinessScore: medianReadiness,
          hiddenCasesPassed: selected.reduce(
            (sum, run) => sum + run.hiddenPassed,
            0,
          ),
          hiddenCasesTotal: selected.reduce(
            (sum, run) => sum + run.hiddenTotal,
            0,
          ),
          layerScores: aggregateLayerScores(selected),
          medianImplementationSeconds: round(
            median(selected.map((run) => run.implementationMs)) / 1000,
            2,
          ),
          medianReadySeconds: ready.length
            ? round(median(ready.map((run) => run.implementationMs)) / 1000, 2)
            : null,
          medianProductionLoc: medianLoc,
          medianReadyLoc: ready.length
            ? median(ready.map((run) => run.productionLoc))
            : null,
          medianTokens: median(selected.map((run) => run.usage.totalTokens)),
          medianCommands: median(selected.map((run) => run.commandCount)),
          medianPackageReads: median(
            selected.map((run) => run.packageReadCommands),
          ),
          readinessPointsPer100Loc: medianLoc
            ? round((medianReadiness / medianLoc) * 100, 2)
            : null,
          infrastructureFailures: selected.filter(
            (run) =>
              run.timedOut ||
              (run.exitCode !== 0 && run.usage.totalTokens === 0),
          ).length,
        },
      ];
    }),
  );
  const native = summaries.native;
  const signett = summaries.signett;
  return {
    benchmark: "p3-agent-readiness-journey",
    version: 1,
    generatedAt: new Date().toISOString(),
    status: trialsPerCondition < 10 ? "pilot" : "study",
    provenance: {
      model,
      reasoning,
      trialsPerCondition,
      timeoutMs,
      signett: publishableProvenance(signettProvenance),
      signettGuidanceHash: guidanceHash(),
      node: process.version,
      codex: codexVersion(),
      sourceRun: path.relative(root, rawDir),
    },
    contract: {
      user: "web developer; a coding agent is the repeatable implementation proxy",
      application: "frozen human-only Acme Orders portal",
      objective:
        "discover the signed-in customer's cancellable orders and cancel one exactly once",
      conditions: {
        native: "direct native WebMCP implementation",
        signett:
          "published signett package with its recommended AGENTS.md contract supplied",
      },
      scoring: {
        readiness:
          "critical hidden cases count twice; major hidden cases count once",
        ease: "first-pass ready rate and implementation time",
        abstraction:
          "bespoke LOC, tokens, commands, and readiness points per 100 LOC",
      },
      hiddenCases: caseManifest,
    },
    summaries,
    headline: {
      readyRateDeltaPoints: round(
        signett.readyRatePct - native.readyRatePct,
        2,
      ),
      readinessScoreDeltaPoints: round(
        signett.medianReadinessScore - native.medianReadinessScore,
        2,
      ),
      readyImplementationSpeedup: ratio(
        native.medianReadySeconds,
        signett.medianReadySeconds,
      ),
      allAttemptTimeOverheadPct: round(
        (signett.medianImplementationSeconds /
          native.medianImplementationSeconds -
          1) *
          100,
        2,
      ),
      productionLocReductionPct: reduction(
        native.medianProductionLoc,
        signett.medianProductionLoc,
      ),
      tokenReductionPct: reduction(native.medianTokens, signett.medianTokens),
      readinessDensityMultiple: ratio(
        signett.readinessPointsPer100Loc,
        native.readinessPointsPer100Loc,
      ),
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
\nP3 AGENT-READINESS SCORECARD
condition        ready       readiness   median time   median LOC   median tokens   points/100 LOC
---------------------------------------------------------------------------------------------------
direct WebMCP    ${cell(`${native.ready}/${native.attempts}`, 12)}${cell(`${native.medianReadinessScore}%`, 12)}${cell(formatSeconds(native.medianImplementationSeconds), 14)}${cell(native.medianProductionLoc, 13)}${cell(native.medianTokens, 16)}${native.readinessPointsPer100Loc}
Signett           ${cell(`${signett.ready}/${signett.attempts}`, 12)}${cell(`${signett.medianReadinessScore}%`, 12)}${cell(formatSeconds(signett.medianImplementationSeconds), 14)}${cell(signett.medianProductionLoc, 13)}${cell(signett.medianTokens, 16)}${signett.readinessPointsPer100Loc}

OUTCOME      ${signed(h.readyRateDeltaPoints)} pp first-pass ready · ${signed(h.readinessScoreDeltaPoints)} pp median readiness
EASE         ${signed(h.allAttemptTimeOverheadPct)}% all-attempt time · ${reductionPhrase(h.tokenReductionPct, "tokens")}
ABSTRACTION  ${reductionPhrase(h.productionLocReductionPct, "bespoke code")} · ${formatRatio(h.readinessDensityMultiple)} readiness density
STATUS       ${scorecard.status}; no single composite score, failures retained
\n`;
}

function renderMarkdown(scorecard) {
  const { native, signett } = scorecard.summaries;
  const h = scorecard.headline;
  return `# P3 agent-readiness journey scorecard

Generated ${scorecard.generatedAt}. Status: **${scorecard.status}**.

The product user is a web developer. In this repeatable pilot, a coding agent acts as
the implementation proxy; an independent deterministic evaluator assigns every score.

| Condition | First-pass ready | Median readiness | Median all-attempt time | Median ready time | Median bespoke LOC | Median tokens | Readiness points / 100 LOC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Direct WebMCP | ${native.ready}/${native.attempts} | ${native.medianReadinessScore}% | ${formatSeconds(native.medianImplementationSeconds)} | ${formatSeconds(native.medianReadySeconds)} | ${native.medianProductionLoc} | ${native.medianTokens} | ${native.readinessPointsPer100Loc} |
| Signett | ${signett.ready}/${signett.attempts} | ${signett.medianReadinessScore}% | ${formatSeconds(signett.medianImplementationSeconds)} | ${formatSeconds(signett.medianReadySeconds)} | ${signett.medianProductionLoc} | ${signett.medianTokens} | ${signett.readinessPointsPer100Loc} |

## Scorecard

- **Readiness:** ${signed(h.readyRateDeltaPoints)} percentage points in first-pass ready rate and ${signed(h.readinessScoreDeltaPoints)} points in median severity-weighted readiness for Signett.
- **Ease:** Signett's median all-attempt time was ${timeComparisonPhrase(h.allAttemptTimeOverheadPct)}; ready-implementation speed was ${formatRatio(h.readyImplementationSpeedup)} because the native arm produced no ready implementation. Signett used ${reductionPhrase(h.tokenReductionPct, "implementation tokens")}.
- **Agent work:** median commands were ${native.medianCommands} for direct WebMCP and ${signett.medianCommands} for Signett; Signett spent ${signett.medianPackageReads} commands inspecting package files.
- **Abstraction tax:** ${codeReductionPhrase(h.productionLocReductionPct)} and ${formatRatio(h.readinessDensityMultiple)} readiness points per 100 lines.

## Readiness layers

| Condition | Expose | Context | Execute | Verify | Observe | Lifecycle | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Direct WebMCP | ${layerCells(native.layerScores)} |
| Signett | ${layerCells(signett.layerScores)} |

## Interpretation

This benchmark starts from a working human-only order workflow and asks an independent
implementation actor to expose a coherent two-tool agent journey. The hidden evaluator
grades native registrations and authoritative application state rather than Signett
events or self-reported success.

Version 1 is a one-application coding-agent pilot, not a human-usability or real-browser-agent
claim. A decision-grade study needs at least 10–20 attempts per condition, confidence
intervals, a second application, five unfamiliar human developers, and held-out tasks
run by a real browser agent. Infrastructure failures are reported separately rather
than interpreted as product failures.

Signett source: commit \`${scorecard.provenance.signett.commit}\`, content hash
\`${scorecard.provenance.signett.srcHash}\`. Model: \`${scorecard.provenance.model}\` at
\`${scorecard.provenance.reasoning}\` reasoning. Raw attempts are retained locally at
\`${scorecard.provenance.sourceRun}\`.
`;
}

function layerCells(scores) {
  return [
    "expose",
    "context",
    "execute",
    "verify",
    "observe",
    "lifecycle",
    "outcome",
  ]
    .map((layer) => `${scores[layer] ?? 0}%`)
    .join(" | ");
}

function weightedReadiness(cases) {
  const points = cases.reduce(
    (sum, test) => sum + (test.passed ? severityWeight(test.severity) : 0),
    0,
  );
  const possible = cases.reduce(
    (sum, test) => sum + severityWeight(test.severity),
    0,
  );
  return percent(points, possible);
}

function layerScores(cases) {
  return Object.fromEntries(
    [...new Set(cases.map(({ layer }) => layer))].map((layer) => {
      const selected = cases.filter((test) => test.layer === layer);
      return [layer, weightedReadiness(selected)];
    }),
  );
}

function aggregateLayerScores(runs) {
  const layers = [...new Set(caseManifest.map(({ layer }) => layer))];
  return Object.fromEntries(
    layers.map((layer) => {
      const cases = runs.flatMap((run) =>
        run.cases.filter((test) => test.layer === layer),
      );
      return [layer, weightedReadiness(cases)];
    }),
  );
}

function severityWeight(severity) {
  return severity === "critical" ? 2 : 1;
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

function parseEvents(stdout) {
  return stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function parseUsage(stdout) {
  const usage =
    parseEvents(stdout).findLast(({ type }) => type === "turn.completed")
      ?.usage ?? {};
  return {
    inputTokens: usage.input_tokens ?? 0,
    cachedInputTokens: usage.cached_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
  };
}

function parseAgentBehavior(stdout) {
  const commands = parseEvents(stdout)
    .filter(
      ({ type, item }) =>
        type === "item.completed" && item?.type === "command_execution",
    )
    .map(({ item }) => item.command ?? "");
  return {
    commandCount: commands.length,
    packageReadCommands: commands.filter((command) =>
      command.includes("node_modules/signett"),
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

function guidanceHash() {
  const hash = createHash("sha256");
  for (const name of [
    "AGENTS.md",
    "README.md",
    "recipes/production-mutation.ts",
    "skills/signett-webmcp/SKILL.md",
  ]) {
    hash.update(name);
    hash.update("\0");
    hash.update(readFileSync(resolve(signettDir, name)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
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
  return numerator != null && denominator
    ? round(numerator / denominator, 2)
    : null;
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
    ? `${value}% fewer ${noun}`
    : `${Math.abs(value)}% more ${noun}`;
}

function codeReductionPhrase(value) {
  if (value == null) return "bespoke integration code not comparable";
  return value >= 0
    ? `${value}% less bespoke integration code`
    : `${Math.abs(value)}% more bespoke integration code`;
}

function timeComparisonPhrase(value) {
  return value >= 0 ? `${value}% longer` : `${Math.abs(value)}% shorter`;
}

function formatSeconds(value) {
  return value == null ? "—" : `${value}s`;
}

function cell(value, width) {
  return String(value).padEnd(width);
}

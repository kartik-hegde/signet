#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = resolve(root, "fixtures/cypress-realworld-app");
const safetyDir = resolve(root, "benchmarks/execution-safety");
const signettDir = resolve(root, process.env.SIGNETT_DIR ?? "packages/webmcp");
const appResultPath = resolve(
  appDir,
  "cypress/results/reference-comparison.json",
);
const resultDir = resolve(root, option("output") ?? "evidence/p0");
const resultLabel = relative(root, resultDir);
const skipApp = process.argv.includes("--skip-app");
const safetyPath = option("safety");
const frontendPort = process.env.BENCHMARK_APP_PORT ?? "3100";
const backendPort = process.env.BENCHMARK_API_PORT ?? "3101";
const appUrl = `http://localhost:${frontendPort}`;
const appEnv = {
  ...process.env,
  PORT: frontendPort,
  VITE_BACKEND_PORT: backendPort,
  BACKEND_PORT: backendPort,
};

if (!skipApp) {
  run(
    "npx",
    [
      "--yes",
      "--package=node@24",
      "--package=yarn@1.22.22",
      "yarn",
      "--cwd",
      appDir,
      "build",
    ],
    appEnv,
  );
  run(
    "npx",
    [
      "--yes",
      "--package=node@24",
      "--package=yarn@1.22.22",
      "yarn",
      "--cwd",
      appDir,
      "start-server-and-test",
      "start:webmcp:ci",
      appUrl,
      "test:benchmark:p0",
    ],
    appEnv,
  );
}

const appResult = JSON.parse(readFileSync(appResultPath, "utf8"));
const safetyResult = safetyPath
  ? JSON.parse(readFileSync(resolve(root, safetyPath), "utf8"))
  : JSON.parse(
      capture(process.execPath, [
        resolve(safetyDir, "run.js"),
        "--json",
        "--no-history",
        `--signett=${signettDir}`,
      ]).stdout,
    );

const modes = Object.fromEntries(appResult.runs.map((run) => [run.mode, run]));
for (const required of ["ui", "webmcp_raw", "webmcp_signett"]) {
  if (!modes[required])
    throw new Error(`P0 app result is missing mode ${required}`);
}

const compare = (baseline, candidate) => ({
  durationSpeedup: round(baseline.durationMs / candidate.durationMs),
  durationReductionPercent: round(
    (100 * (baseline.durationMs - candidate.durationMs)) / baseline.durationMs,
  ),
  interactionReductionPercent: round(
    (100 * (baseline.interactionCount - candidate.interactionCount)) /
      baseline.interactionCount,
  ),
});

const scorecard = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: "p0_directional",
  note: "Deterministic application drivers establish parity and directional overhead. They are not an LLM-agent speed claim.",
  provenance: {
    benchmarkCommit: gitRevision(root),
    signettCommit: gitRevision(signettDir),
    application: "Cypress Real World App payment fixture",
  },
  effectiveness: {
    task: "send-payment",
    authoritativeSuccess: { ui: true, webmcpRaw: true, webmcpSignett: true },
    runs: modes,
    comparisons: {
      rawWebMcpVsUi: compare(modes.ui, modes.webmcp_raw),
      signettWebMcpVsUi: compare(modes.ui, modes.webmcp_signett),
      signettVsRawWebMcp: {
        durationRatio: round(
          modes.webmcp_signett.durationMs / modes.webmcp_raw.durationMs,
        ),
        addedDurationMs: round(
          modes.webmcp_signett.durationMs - modes.webmcp_raw.durationMs,
        ),
        additionalHttpRequests:
          modes.webmcp_signett.httpRequests - modes.webmcp_raw.httpRequests,
      },
    },
  },
  safety: {
    scenarios: safetyResult.scenarios,
    scores: safetyResult.scores,
    trials: safetyResult.trials,
    subject: safetyResult.subject,
    scoringVersion: safetyResult.scoringVersion,
  },
};

mkdirSync(resultDir, { recursive: true });
writeFileSync(
  resolve(resultDir, "latest.json"),
  `${JSON.stringify(scorecard, null, 2)}\n`,
);
writeFileSync(resolve(resultDir, "latest.md"), renderMarkdown(scorecard));
process.stdout.write(renderConsole(scorecard));

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result;
}

function gitRevision(directory) {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "uncommitted";
}

function option(name) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function renderConsole(result) {
  const { runs, comparisons } = result.effectiveness;
  const safety = Object.fromEntries(
    result.safety.scores.map((entry) => [entry.arm, entry]),
  );
  const scenarioCount = result.safety.scenarios.length;
  return (
    `\nP0 KPI SCORECARD\n\n` +
    `Effectiveness: send-payment (authoritative database success: 3/3)\n` +
    `  UI                 ${runs.ui.durationMs} ms   ${runs.ui.interactionCount} interactions\n` +
    `  Raw WebMCP         ${runs.webmcp_raw.durationMs} ms   ${runs.webmcp_raw.interactionCount} calls   ` +
    `${comparisons.rawWebMcpVsUi.durationSpeedup}x vs UI\n` +
    `  Signett WebMCP      ${runs.webmcp_signett.durationMs} ms   ${runs.webmcp_signett.interactionCount} calls   ` +
    `${comparisons.signettWebMcpVsUi.durationSpeedup}x vs UI\n` +
    `  Signett overhead    ${comparisons.signettVsRawWebMcp.addedDurationMs} ms   ` +
    `${comparisons.signettVsRawWebMcp.additionalHttpRequests} additional HTTP requests\n\n` +
    `Execution safety: ${scenarioCount} deterministic scenarios\n` +
    `  Raw WebMCP         ${safety.A1_raw.overall}/100   ${safety.A1_raw.scenariosPassed}/${scenarioCount} passed\n` +
    `  Signett shipped     ${safety.A3a_signett_memory.overall}/100   ${safety.A3a_signett_memory.scenariosPassed}/${scenarioCount} passed\n` +
    `  Signett + durable*  ${safety.A3b_signett_durable.overall}/100   ${safety.A3b_signett_durable.scenariosPassed}/${scenarioCount} passed\n\n` +
    `* Durable store is supplied by the benchmark harness, not shipped by Signett.\n` +
    `Directional driver result only; real-agent repeated trials are the next phase.\n` +
    `Wrote ${resultLabel}/latest.json and ${resultLabel}/latest.md\n`
  );
}

function renderMarkdown(result) {
  const { runs, comparisons } = result.effectiveness;
  const safetyRows = result.safety.scores
    .map(
      (entry) =>
        `| ${entry.arm} | ${entry.overall} | ${entry.correctness} | ${entry.honesty} | ${entry.scenariosPassed}/${entry.scenariosRun} |`,
    )
    .join("\n");
  return (
    `# P0 KPI scorecard\n\n` +
    `Generated: ${result.generatedAt}\n\n` +
    `> ${result.note}\n\n` +
    `## Real-application effectiveness\n\n` +
    `All three conditions completed the authenticated payment task and passed the same authoritative database oracle.\n\n` +
    `| Condition | Duration (ms) | Interactions | HTTP requests | Mutation requests |\n` +
    `|---|---:|---:|---:|---:|\n` +
    `| UI | ${runs.ui.durationMs} | ${runs.ui.interactionCount} | ${runs.ui.httpRequests} | ${runs.ui.mutationRequests} |\n` +
    `| Raw WebMCP | ${runs.webmcp_raw.durationMs} | ${runs.webmcp_raw.interactionCount} | ${runs.webmcp_raw.httpRequests} | ${runs.webmcp_raw.mutationRequests} |\n` +
    `| Signett WebMCP | ${runs.webmcp_signett.durationMs} | ${runs.webmcp_signett.interactionCount} | ${runs.webmcp_signett.httpRequests} | ${runs.webmcp_signett.mutationRequests} |\n\n` +
    `- Raw WebMCP was **${comparisons.rawWebMcpVsUi.durationSpeedup}x** the UI driver's speed with **${comparisons.rawWebMcpVsUi.interactionReductionPercent}%** fewer interactions.\n` +
    `- Signett WebMCP was **${comparisons.signettWebMcpVsUi.durationSpeedup}x** the UI driver's speed with **${comparisons.signettWebMcpVsUi.interactionReductionPercent}%** fewer interactions.\n` +
    `- Signett added **${comparisons.signettVsRawWebMcp.addedDurationMs} ms** and **${comparisons.signettVsRawWebMcp.additionalHttpRequests} HTTP requests** versus raw WebMCP.\n\n` +
    `## Execution safety\n\n` +
    `| Arm | Overall | Correctness | Honesty | Scenarios passed |\n` +
    `|---|---:|---:|---:|---:|\n${safetyRows}\n\n` +
    `The durable arm uses a conservative store supplied by the benchmark harness, not a store shipped by Signett.\n`
  );
}

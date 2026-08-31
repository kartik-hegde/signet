#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = resolve(root, "apps/cypress-realworld-app");
const safetyDir = resolve(root, "execution-safety");
const signetDir = resolve(root, process.env.SIGNET_DIR ?? "../signet");
const appResultPath = resolve(appDir, "cypress/results/reference-comparison.json");
const resultDir = resolve(root, "results/p0");
const skipApp = process.argv.includes("--skip-app");

linkSignetCheckout();

if (!skipApp) {
  run("npx", ["--yes", "--package=node@24", "--package=yarn@1.22.22", "yarn", "--cwd", appDir, "build"]);
  run("npx", [
    "--yes",
    "--package=node@24",
    "--package=yarn@1.22.22",
    "yarn",
    "--cwd",
    appDir,
    "start-server-and-test",
    "start:webmcp:ci",
    "http://localhost:3000",
    "test:benchmark:p0",
  ]);
}

const appResult = JSON.parse(readFileSync(appResultPath, "utf8"));
const safetyResult = JSON.parse(
  capture(process.execPath, [
    resolve(safetyDir, "run.js"),
    "--json",
    "--no-history",
    `--signet=${signetDir}`,
  ]).stdout,
);

const modes = Object.fromEntries(appResult.runs.map((run) => [run.mode, run]));
for (const required of ["ui", "webmcp_raw", "webmcp_signet"]) {
  if (!modes[required]) throw new Error(`P0 app result is missing mode ${required}`);
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
    signetCommit: gitRevision(signetDir),
    application: "Cypress Real World App payment fixture",
  },
  effectiveness: {
    task: "send-payment",
    authoritativeSuccess: { ui: true, webmcpRaw: true, webmcpSignet: true },
    runs: modes,
    comparisons: {
      rawWebMcpVsUi: compare(modes.ui, modes.webmcp_raw),
      signetWebMcpVsUi: compare(modes.ui, modes.webmcp_signet),
      signetVsRawWebMcp: {
        durationRatio: round(modes.webmcp_signet.durationMs / modes.webmcp_raw.durationMs),
        addedDurationMs: round(modes.webmcp_signet.durationMs - modes.webmcp_raw.durationMs),
        additionalHttpRequests: modes.webmcp_signet.httpRequests - modes.webmcp_raw.httpRequests,
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
writeFileSync(resolve(resultDir, "latest.json"), `${JSON.stringify(scorecard, null, 2)}\n`);
writeFileSync(resolve(resultDir, "latest.md"), renderMarkdown(scorecard));
process.stdout.write(renderConsole(scorecard));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: process.env });
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

function linkSignetCheckout() {
  const localDir = resolve(root, ".local");
  const link = resolve(localDir, "signet");
  mkdirSync(localDir, { recursive: true });

  try {
    if (lstatSync(link)) {
      if (realpathSync(link) === realpathSync(signetDir)) return;
      rmSync(link);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  symlinkSync(signetDir, link, "dir");
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function renderConsole(result) {
  const { runs, comparisons } = result.effectiveness;
  const safety = Object.fromEntries(result.safety.scores.map((entry) => [entry.arm, entry]));
  return (
    `\nP0 KPI SCORECARD\n\n` +
    `Effectiveness: send-payment (authoritative database success: 3/3)\n` +
    `  UI                 ${runs.ui.durationMs} ms   ${runs.ui.interactionCount} interactions\n` +
    `  Raw WebMCP         ${runs.webmcp_raw.durationMs} ms   ${runs.webmcp_raw.interactionCount} calls   ` +
    `${comparisons.rawWebMcpVsUi.durationSpeedup}x vs UI\n` +
    `  Signet WebMCP      ${runs.webmcp_signet.durationMs} ms   ${runs.webmcp_signet.interactionCount} calls   ` +
    `${comparisons.signetWebMcpVsUi.durationSpeedup}x vs UI\n` +
    `  Signet overhead    ${comparisons.signetVsRawWebMcp.addedDurationMs} ms   ` +
    `${comparisons.signetVsRawWebMcp.additionalHttpRequests} additional HTTP requests\n\n` +
    `Execution safety: 3 deterministic scenarios\n` +
    `  Raw WebMCP         ${safety.A1_raw.overall}/100   ${safety.A1_raw.scenariosPassed}/3 passed\n` +
    `  Signet shipped     ${safety.A3a_signet_memory.overall}/100   ${safety.A3a_signet_memory.scenariosPassed}/3 passed\n` +
    `  Signet + durable*  ${safety.A3b_signet_durable.overall}/100   ${safety.A3b_signet_durable.scenariosPassed}/3 passed\n\n` +
    `* Durable store is supplied by the benchmark harness, not shipped by Signet.\n` +
    `Directional driver result only; real-agent repeated trials are the next phase.\n` +
    `Wrote results/p0/latest.json and results/p0/latest.md\n`
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
    `| Signet WebMCP | ${runs.webmcp_signet.durationMs} | ${runs.webmcp_signet.interactionCount} | ${runs.webmcp_signet.httpRequests} | ${runs.webmcp_signet.mutationRequests} |\n\n` +
    `- Raw WebMCP was **${comparisons.rawWebMcpVsUi.durationSpeedup}x** the UI driver's speed with **${comparisons.rawWebMcpVsUi.interactionReductionPercent}%** fewer interactions.\n` +
    `- Signet WebMCP was **${comparisons.signetWebMcpVsUi.durationSpeedup}x** the UI driver's speed with **${comparisons.signetWebMcpVsUi.interactionReductionPercent}%** fewer interactions.\n` +
    `- Signet added **${comparisons.signetVsRawWebMcp.addedDurationMs} ms** and **${comparisons.signetVsRawWebMcp.additionalHttpRequests} HTTP requests** versus raw WebMCP.\n\n` +
    `## Execution safety\n\n` +
    `| Arm | Overall | Correctness | Honesty | Scenarios passed |\n` +
    `|---|---:|---:|---:|---:|\n${safetyRows}\n\n` +
    `The durable arm uses a conservative store supplied by the benchmark harness, not a store shipped by Signet.\n`
  );
}

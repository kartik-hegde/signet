#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const signetDir = resolve(root, process.env.SIGNET_DIR ?? "packages/webmcp");
const resultDir = resolve(root, option("output") ?? "evidence/build-vs-buy");
const adapters = {
  handrolled: resolve(
    root,
    "benchmarks/execution-safety/harness/adapters/handrolled.js",
  ),
  signet: resolve(
    root,
    "benchmarks/execution-safety/harness/adapters/signet.js",
  ),
};

const safetyPath = option("safety");
const safety = safetyPath
  ? JSON.parse(readFileSync(resolve(root, safetyPath), "utf8"))
  : runJson(process.execPath, [
      resolve(root, "benchmarks/execution-safety/run.js"),
      "--json",
      "--no-history",
      `--signet=${signetDir}`,
    ]);
const score = (arm) => safety.scores.find((entry) => entry.arm === arm);
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: "directional_single_implementation",
  note: "This is one benchmark-authored implementation, not an independent implementer study.",
  provenance: {
    benchmarkCommit: revision(root),
    signetCommit: revision(signetDir),
    safetyScoringVersion: safety.scoringVersion,
  },
  implementation: {
    handrolledBespokeSloc: sourceLines(adapters.handrolled),
    signetAdapterSloc: sourceLines(adapters.signet),
  },
  conformance: {
    raw: score("A1_raw"),
    handrolled: score("A2_handrolled"),
    signetShippedStore: score("A3a_signet_memory"),
    signetWithDurableStore: score("A3b_signet_durable"),
  },
};

mkdirSync(resultDir, { recursive: true });
writeFileSync(
  resolve(resultDir, "latest.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
writeFileSync(resolve(resultDir, "latest.md"), render(result));
process.stdout.write(render(result));

function runJson(command, args) {
  const child = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

function option(name) {
  const prefix = `--${name}=`;
  const value = process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length);
}

function sourceLines(filename) {
  return readFileSync(filename, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("//") &&
        !line.startsWith("/**") &&
        !line.startsWith("*") &&
        line !== "*/",
    ).length;
}

function revision(directory) {
  const child = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  });
  return child.status === 0 ? child.stdout.trim() : "uncommitted";
}

function render(value) {
  const { implementation, conformance } = value;
  return `# Directional build-versus-buy baseline

Generated: ${value.generatedAt}

> ${value.note}

| Arm | Bespoke adapter SLOC | Safety score | Scenarios passed | Median invocation (ms) |
|---|---:|---:|---:|---:|
| Raw WebMCP | — | ${conformance.raw.overall} | ${conformance.raw.scenariosPassed}/${conformance.raw.scenariosRun} | ${conformance.raw.medianInvocationMs} |
| Hand-rolled controls | ${implementation.handrolledBespokeSloc} | ${conformance.handrolled.overall} | ${conformance.handrolled.scenariosPassed}/${conformance.handrolled.scenariosRun} | ${conformance.handrolled.medianInvocationMs} |
| Signet + shipped memory store | ${implementation.signetAdapterSloc} | ${conformance.signetShippedStore.overall} | ${conformance.signetShippedStore.scenariosPassed}/${conformance.signetShippedStore.scenariosRun} | ${conformance.signetShippedStore.medianInvocationMs} |
| Signet + same durable store | ${implementation.signetAdapterSloc} | ${conformance.signetWithDurableStore.overall} | ${conformance.signetWithDurableStore.scenariosPassed}/${conformance.signetWithDurableStore.scenariosRun} | ${conformance.signetWithDurableStore.medianInvocationMs} |

The hand-rolled and Signet arms use the same application operations, fault schedule,
authoritative verifiers, and durable idempotency store. Only the execution adapter
changes. SLOC excludes blank and comment-only lines and intentionally counts the
hand-rolled control code the application must own.

This establishes a reproducible internal baseline. A publishable developer-effort
claim still requires several independent implementers and elapsed-time measurement.
`;
}

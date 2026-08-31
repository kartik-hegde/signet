import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repeat = Number.parseInt(process.env.REFERENCE_REPEAT ?? "50", 10);
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 1000) {
  throw new Error("REFERENCE_REPEAT must be an integer from 1 through 1000.");
}

const cypressBin = path.resolve("node_modules/cypress/bin/cypress");
const resultsDir = path.resolve("cypress/results");
const comparisonPath = path.join(resultsDir, "reference-comparison.json");
const startedAt = Date.now();
const samples = [];

for (let run = 1; run <= repeat; run += 1) {
  process.stdout.write(`\n[reference repeat] run ${run}/${repeat}\n`);
  const result = spawnSync(
    process.execPath,
    [cypressBin, "run", "--spec", "cypress/tests/webmcp/*.spec.ts", "--config", "retries=0"],
    { stdio: "inherit", env: process.env }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (fs.existsSync(comparisonPath)) {
    const comparison = JSON.parse(fs.readFileSync(comparisonPath, "utf8"));
    samples.push({ run, measurements: comparison.runs, comparison: comparison.comparison });
  }
}

const average = (values) =>
  values.length === 0
    ? null
    : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
const measurements = samples.flatMap(({ measurements: runMeasurements }) => runMeasurements);
const summarize = (mode) => {
  const matching = measurements.filter((measurement) => measurement.mode === mode);
  return {
    samples: matching.length,
    averageDurationMs: average(matching.map(({ durationMs }) => durationMs)),
    averageInteractions: average(matching.map(({ interactionCount }) => interactionCount)),
    averageHttpRequests: average(matching.map(({ httpRequests }) => httpRequests)),
    averageMutationRequests: average(matching.map(({ mutationRequests }) => mutationRequests)),
  };
};

const report = {
  schemaVersion: 1,
  repeat,
  passed: repeat,
  failed: 0,
  durationMs: Date.now() - startedAt,
  completedAt: new Date().toISOString(),
  summary: {
    ui: summarize("ui"),
    webmcp: summarize("webmcp"),
  },
  samples,
};

fs.mkdirSync(resultsDir, { recursive: true });
fs.writeFileSync(
  path.join(resultsDir, "reference-repeatability.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
process.stdout.write(`\n[reference repeat] ${repeat}/${repeat} runs passed\n`);

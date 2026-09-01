#!/usr/bin/env node
/**
 * One command. Verifies the Signet build is current, runs every scenario against
 * every measurable arm, scores it, records the result against the source hash, and
 * prints the delta since the last different build.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preflight } from "./harness/preflight.js";

const benchDir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const match = argv.find((entry) => entry.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
};

if (flag("help")) {
  console.log(`
Usage: ./run.js [options]

  --signet=<path>    Signet package root (default ../../packages/webmcp, or SIGNET_DIR)
  --no-build         fail instead of rebuilding when the build is stale
  --json             print the machine-readable record and nothing else
  --output=<path>    write the machine-readable record to a file
  --no-history       do not append to evidence/raw/execution-safety/history.jsonl
  --verbose          per-scenario counts and caller reports
`);
  process.exit(0);
}

const quiet = flag("json");
const log = quiet ? () => {} : console.log;
const signetDir = resolve(
  benchDir,
  option("signet", process.env.SIGNET_DIR ?? "../../packages/webmcp"),
);

log("\nPreflight");
let provenance;
try {
  provenance = preflight({
    signetDir,
    benchDir,
    allowBuild: !flag("no-build"),
    log,
  });
} catch (error) {
  console.error(
    `\nPreflight failed. Nothing was scored.\n\n${error.message}\n`,
  );
  process.exit(2);
}

// Pin the guard to the exact build preflight verified, then import. Setting this
// before the first import of arms.js is what makes "latest build" a guarantee
// rather than a convention.
process.env.SIGNET_DIST = resolve(provenance.signetDir, "dist", "index.js");

// Imported after preflight so the guard is loaded from a dist we have just vouched for.
const { scenarios } = await import("./scenarios/index.js");
const { ARMS } = await import("./harness/arms.js");
const { runTrial } = await import("./harness/runner.js");
const { printReport } = await import("./harness/report.js");
const { scoreArm, SCORING_VERSION } = await import("./harness/score.js");
const { appendHistory } = await import("./harness/history.js");

const results = [];
for (const scenario of scenarios) {
  for (const [armKey, arm] of Object.entries(ARMS)) {
    if (arm.pending) continue;
    const trial = await runTrial({ scenario, armKey });
    results.push({ scenario: scenario.id, arm: armKey, ...trial });
    if (flag("verbose") && !quiet) {
      console.log(`\n${scenario.id} / ${arm.label}`);
      console.log("  counts:", trial.counts);
      console.log(
        "  reports:",
        trial.reports
          .map((r) => `${r.step}=${r.reported}${r.error ? `(${r.error})` : ""}`)
          .join(" "),
      );
    }
  }
}

const scores = Object.keys(ARMS)
  .filter((armKey) => !ARMS[armKey].pending)
  .map((armKey) => scoreArm({ results, scenarios, arm: armKey }))
  .filter(Boolean);

const record = {
  at: new Date().toISOString(),
  provenance,
  scoringVersion: SCORING_VERSION,
  compositeStatus: "internal_only",
  scores,
  scenarios: scenarios.map((scenario) => scenario.id),
  ...(quiet || option("output")
    ? {
        trials: results.map(({ scenario, arm, counts, reports, passed }) => ({
          scenario,
          arm,
          counts,
          reports: reports.map(({ step, reported, error }) => ({
            step,
            reported,
            error,
          })),
          passed,
        })),
      }
    : {}),
};

const outputPath = option("output");
if (outputPath) {
  const resolvedOutput = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(record, null, 2)}\n`);
}

if (!flag("no-history")) appendHistory(benchDir, record);

if (quiet) {
  console.log(JSON.stringify(record, null, 2));
} else {
  printReport({ results, scenarios });
}

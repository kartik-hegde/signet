#!/usr/bin/env node
/**
 * One command. Verifies the Signet build is current, runs every scenario against
 * every measurable arm, scores it, records the result against the source hash, and
 * prints the delta since the last different build.
 */
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

  --arm=<key>        which arm the headline score tracks (default A3b_signet_durable)
  --signet=<path>    Signet repository root (default ../../signet, or SIGNET_DIR)
  --no-build         fail instead of rebuilding when the build is stale
  --fail-under=<n>   exit non-zero if the subject arm scores below n
  --json             print the machine-readable record and nothing else
  --no-history       do not append to results/history.jsonl
  --verbose          per-scenario counts and caller reports
`);
  process.exit(0);
}

const quiet = flag("json");
const log = quiet ? () => {} : console.log;
const signetDir = resolve(benchDir, option("signet", process.env.SIGNET_DIR ?? "../../signet"));

log("\nPreflight");
let provenance;
try {
  provenance = preflight({ signetDir, benchDir, allowBuild: !flag("no-build"), log });
} catch (error) {
  console.error(`\nPreflight failed. Nothing was scored.\n\n${error.message}\n`);
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
const { readHistory, appendHistory, previousDistinct } = await import("./harness/history.js");

const subject = option("arm", "A3b_signet_durable");
if (!ARMS[subject]) {
  console.error(`Unknown arm "${subject}". Known arms: ${Object.keys(ARMS).join(", ")}`);
  process.exit(2);
}

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
        trial.reports.map((r) => `${r.step}=${r.reported}${r.error ? `(${r.error})` : ""}`).join(" "),
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
  subject,
  scores,
  scenarios: scenarios.map((scenario) => scenario.id),
};

const history = readHistory(benchDir);
const previous = previousDistinct(history, provenance.srcHash, SCORING_VERSION);
if (!flag("no-history")) appendHistory(benchDir, record);

if (quiet) {
  console.log(JSON.stringify(record, null, 2));
} else {
  printReport({ results, scenarios });
  printScores({ scores, subject, previous });
}

const headline = scores.find((entry) => entry.arm === subject);
const floor = Number(option("fail-under", NaN));
if (!Number.isNaN(floor) && headline && headline.overall < floor) {
  console.error(`\nScore ${headline.overall} is below --fail-under=${floor}\n`);
  process.exit(1);
}

function printScores({ scores, subject, previous }) {
  const pad = (text, width) => String(text).padEnd(width);
  console.log("Scores. Higher is better, 100 is a clean sweep.\n");
  console.log(
    pad("arm", 28) + pad("overall", 10) + pad("correctness", 14) + pad("honesty", 10) +
      pad("passed", 10) + "median ms",
  );
  console.log("-".repeat(84));
  for (const entry of scores) {
    const marker = entry.arm === subject ? " <-" : "";
    console.log(
      pad(entry.arm, 28) + pad(entry.overall, 10) + pad(entry.correctness, 14) +
        pad(entry.honesty, 10) + pad(`${entry.scenariosPassed}/${entry.scenariosRun}`, 10) +
        `${entry.medianInvocationMs ?? "-"}${marker}`,
    );
  }

  const headline = scores.find((entry) => entry.arm === subject);
  const before = previous?.scores?.find((entry) => entry.arm === subject);
  console.log(`\nSCORE ${headline.overall}   (${subject})`);

  if (!before) {
    console.log("No earlier run with this scoring model and a different Signet source.\n");
    return;
  }
  const delta = (now, then) => {
    const change = Math.round((now - then) * 10) / 10;
    if (change === 0) return "no change";
    return `${change > 0 ? "+" : ""}${change}`;
  };
  console.log(
    `since ${previous.provenance.srcHash} (${previous.at.slice(0, 16).replace("T", " ")}): ` +
      `overall ${delta(headline.overall, before.overall)}, ` +
      `correctness ${delta(headline.correctness, before.correctness)}, ` +
      `honesty ${delta(headline.honesty, before.honesty)}\n`,
  );
}

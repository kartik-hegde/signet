import { ARMS } from "./arms.js";
import { VIOLATIONS, CREDITS } from "./runner.js";

const pad = (text, width) => String(text).padEnd(width);

export function printReport({ results, scenarios }) {
  const armKeys = Object.keys(ARMS);
  const nameWidth = Math.max(...scenarios.map((s) => s.id.length)) + 2;
  const colWidth = 26;

  console.log("\nPass or fail by scenario\n");
  console.log(pad("scenario", nameWidth) + armKeys.map((k) => pad(ARMS[k].label, colWidth)).join(""));
  console.log("-".repeat(nameWidth + armKeys.length * colWidth));

  for (const scenario of scenarios) {
    const cells = armKeys.map((armKey) => {
      const entry = results.find((r) => r.scenario === scenario.id && r.arm === armKey);
      if (!entry) return pad("not measured", colWidth);
      const failures = VIOLATIONS.filter((kpi) => entry.counts[kpi]);
      return pad(failures.length ? `FAIL ${failures.join(",")}` : "pass", colWidth);
    });
    console.log(pad(scenario.id, nameWidth) + cells.join(""));
  }

  console.log("\nViolation totals across scenarios\n");
  console.log(pad("kpi", nameWidth) + armKeys.map((k) => pad(ARMS[k].label, colWidth)).join(""));
  console.log("-".repeat(nameWidth + armKeys.length * colWidth));

  for (const kpi of [...VIOLATIONS, ...CREDITS]) {
    const cells = armKeys.map((armKey) => {
      const entries = results.filter((r) => r.arm === armKey);
      if (!entries.length) return pad("not measured", colWidth);
      const total = entries.reduce((sum, entry) => sum + (entry.counts[kpi] ?? 0), 0);
      return pad(total, colWidth);
    });
    console.log(pad(kpi, nameWidth) + cells.join(""));
  }

  const pending = armKeys.filter((k) => ARMS[k].pending);
  if (pending.length) {
    console.log(`\nNot yet measured: ${pending.map((k) => ARMS[k].label).join(", ")}`);
  }
  console.log("\nCredits are read the other way. A higher indeterminate_disclosed is better,");
  console.log("because it means an uncertain outcome reached the caller as uncertain.\n");
}

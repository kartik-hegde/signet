import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { freshDatabase } from "../app/db.js";
import { handlerFor } from "../app/tools.js";
import { oracle } from "./oracle.js";
import { ARMS } from "./arms.js";
import { runCaller, Barrier } from "./caller.js";

export const VIOLATIONS = [
  "duplicate_effects",
  "false_success",
  "silent_effect",
  "lost_updates",
  "needless_indeterminate",
];
export const CREDITS = ["indeterminate_disclosed", "lost_update_disclosed"];

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms).unref()),
  ]);

/** Records wall time per invocation so the cost of the controls is reported, not hidden. */
function timed(invoke, latencies) {
  return async (input, options) => {
    const started = performance.now();
    try {
      return await invoke(input, options);
    } finally {
      latencies.push(performance.now() - started);
    }
  };
}

export async function runTrial({ scenario, armKey }) {
  const arm = ARMS[armKey];
  const dbPath = join(tmpdir(), `aeb-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  const db = freshDatabase(dbPath);

  const latencies = [];
  let counter = 0;
  const ids = { next: (prefix) => `${prefix}_${(counter += 1)}` };
  const clock = { now: () => 2000 };
  let reports;

  try {
    if (scenario.concurrent) {
      const { participants, barrierAt } = scenario.concurrent;
      const barrier = new Barrier(participants.length);
      const runs = participants.map((participant) => {
        const toolName = participant.steps[0].tool;
        const ctx = {
          db,
          actorId: participant.actor,
          ids,
          clock,
          hooks: { pause: async (label) => { if (label === barrierAt) await barrier.arrive(); } },
        };
        const { execute } = handlerFor(toolName);
        const invoke = timed(arm.build({ execute, faults: [], ctx, toolName }), latencies);
        return runCaller({ steps: participant.steps, invoke, maxRetries: 0 });
      });
      reports = (await withTimeout(Promise.all(runs), 5000, scenario.id)).flat();
    } else {
      const ctx = { db, actorId: scenario.actor, ids, clock, hooks: { pause: async () => {} } };
      const { execute } = handlerFor(scenario.tool);
      const invoke = timed(
        arm.build({ execute, faults: scenario.faults ?? [], ctx, toolName: scenario.tool }),
        latencies,
      );
      reports = await withTimeout(runCaller({ steps: scenario.steps, invoke, maxRetries: 1 }), 5000, scenario.id);
    }
  } finally {
    db.close();
  }

  const view = oracle(dbPath);
  const counts = scenario.evaluate({ oracle: view, reports });
  view.close();
  rmSync(dbPath, { force: true });

  const passed = VIOLATIONS.every((kpi) => !counts[kpi]);
  return { counts, reports, passed, latencies };
}

/**
 * A scripted caller standing in for the agent.
 *
 * Most of the gradient this suite measures does not need a language model.
 * Duplicate suppression, verification and concurrency are properties of the
 * execution layer, so a deterministic caller with a retry policy exercises them
 * exactly and for free. A model is only required for the efficiency layer and
 * for injection scenarios, which arrive in a later version.
 *
 * The caller records what it would REPORT to a user. Comparing that report
 * against the oracle is what produces the false-success and silent-effect
 * numbers.
 */
import { IndeterminateError } from "./stores.js";

export async function runCaller({ steps, invoke, maxRetries = 1 }) {
  const reports = [];

  for (const step of steps) {
    let outcome = { step: step.tool, reported: "failure", error: null };

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      try {
        const output = await invoke(step.input, { signal: controller.signal });
        outcome = { step: step.tool, reported: "success", output };
        break;
      } catch (error) {
        outcome = { step: step.tool, reported: "failure", error: error.name };
        if (error instanceof IndeterminateError || error.code === "indeterminate") {
          outcome.reported = "unknown";
          break;
        }
        if (error.name === "VerificationError") {
          outcome.reported = "unknown";
          break;
        }
      }
    }

    reports.push(outcome);
  }

  return reports;
}

/** Releases waiters only once every participant has arrived, making interleavings exact. */
export class Barrier {
  #expected;
  #arrived = 0;
  #waiters = [];
  constructor(expected) { this.#expected = expected; }
  async arrive() {
    this.#arrived += 1;
    if (this.#arrived >= this.#expected) {
      for (const release of this.#waiters) release();
      this.#waiters = [];
      return;
    }
    await new Promise((resolve) => this.#waiters.push(resolve));
  }
}

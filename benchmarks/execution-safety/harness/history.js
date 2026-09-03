/**
 * A run is only useful for hill climbing if you can see the delta. Every run
 * appends one line keyed by the Signett source hash, so a score always points at a
 * specific state of the library rather than at a moment in time.
 */
import { appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const FILE = "../../evidence/raw/execution-safety/history.jsonl";

export function readHistory(benchDir) {
  const path = join(benchDir, FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function appendHistory(benchDir, record) {
  const path = join(benchDir, FILE);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

/**
 * The most recent run that used the same scoring model and a different Signett
 * source. Both conditions matter: comparing across scoring models would report your
 * own change to the scorer as progress in the library.
 */
export function previousDistinct(history, srcHash, scoringVersion) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.scoringVersion !== scoringVersion) continue;
    if (entry.provenance?.srcHash !== srcHash) return entry;
  }
  return null;
}

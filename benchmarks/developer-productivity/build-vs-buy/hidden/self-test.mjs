import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditCandidate } from "./audit.mjs";

const hiddenDir = dirname(fileURLToPath(import.meta.url));
const benchDir = resolve(hiddenDir, "..");
const fixtureDir = resolve(benchDir, "fixture");
const root = resolve(benchDir, "../../..");
const signettDir = resolve(root, process.env.SIGNETT_DIR ?? "packages/webmcp");

for (const condition of ["native", "signett"]) {
  const candidateDir = mkdtempSync(
    path.join(os.tmpdir(), `signett-p2-${condition}-`),
  );
  try {
    copyFileSync(
      resolve(fixtureDir, "app.mjs"),
      resolve(candidateDir, "app.mjs"),
    );
    copyFileSync(
      resolve(hiddenDir, `reference-${condition}.mjs`),
      resolve(candidateDir, "solution.mjs"),
    );
    if (condition === "signett") {
      const nodeModules = resolve(candidateDir, "node_modules");
      mkdirSync(nodeModules, { recursive: true });
      symlinkSync(signettDir, resolve(nodeModules, "signett"), "dir");
    }
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(resolve(candidateDir, "solution.mjs"), "utf8"),
    );
    const result = await auditCandidate({ candidateDir, condition, source });
    const failed = result.cases.filter(({ passed }) => !passed);
    assert.deepEqual(
      failed,
      [],
      `${condition}: ${failed.map(({ id, error }) => `${id}: ${error}`).join("\n")}`,
    );
    assert.ok(result.runtime?.p50Ms, `${condition}: runtime audit missing`);
    console.log(
      `${condition} reference: ${result.cases.length}/${result.cases.length} cases passed`,
    );
  } finally {
    rmSync(candidateDir, { recursive: true, force: true });
  }
}

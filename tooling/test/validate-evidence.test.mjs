import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createEvidence, defineCase } from "../../packages/eval/index.mjs";
import { validateEvidenceTree } from "../validate-evidence.mjs";

const caseDefinition = defineCase({
  id: "pay-once",
  intent: "Send one payment exactly once.",
  kind: "consequential",
  application: "payments",
  oracle: "database",
  expectations: { forbiddenEffects: ["duplicate-payment"] },
});

function evidence() {
  return createEvidence({
    caseDefinition,
    trial: {
      id: "pay-once:guided:1",
      index: 1,
      condition: "guided",
      startedAt: "2026-09-01T00:00:00.000Z",
      durationMs: 100,
      status: "completed",
    },
    provenance: {
      application: { id: "payments" },
      browser: { id: "chrome" },
      agent: { id: "agent" },
      oracle: { id: "database" },
    },
    agent: {
      provider: "test",
      model: "deterministic",
      timedOut: false,
      usage: {},
    },
    oracle: {
      adapter: "database",
      grade: {
        authoritativeSuccess: true,
        safeSuccess: true,
        forbiddenEffects: [],
      },
    },
  });
}

test("committed Trial Evidence is held to the versioned schema", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "signet-evidence-"));
  try {
    mkdirSync(path.join(root, "eval"), { recursive: true });
    writeFileSync(
      path.join(root, "eval", "good.json"),
      JSON.stringify(evidence()),
    );
    // A published summary keeps its own shape and is not held to the Trial schema.
    writeFileSync(
      path.join(root, "latest.json"),
      JSON.stringify({ suite: "payments", scenarios: [] }),
    );
    assert.deepEqual(validateEvidenceTree(root), {
      files: 2,
      trialEvidence: 1,
      failures: [],
    });

    writeFileSync(
      path.join(root, "eval", "bad.json"),
      JSON.stringify({
        ...evidence(),
        trial: { ...evidence().trial, status: "mystery" },
      }),
    );
    const result = validateEvidenceTree(root);
    assert.equal(result.trialEvidence, 2);
    assert.match(result.failures[0], /Unsupported Trial status/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

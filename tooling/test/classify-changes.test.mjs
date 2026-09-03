import assert from "node:assert/strict";
import test from "node:test";

import { LANES, classifyFiles } from "../classify-changes.mjs";

test("SDK source changes select all downstream deterministic lanes", () => {
  const result = classifyFiles(["packages/webmcp/src/guard.ts"]);
  assert.deepEqual(result, {
    sdk: true,
    compatibility: true,
    safety: true,
    reference: true,
    eval: false,
    evidence: false,
    docs: true,
    integrations: false,
  });
});

test("benchmark-only changes do not select package verification", () => {
  assert.deepEqual(
    classifyFiles(["benchmarks/execution-safety/scenarios/index.js"]),
    {
      sdk: false,
      compatibility: false,
      safety: true,
      reference: false,
      eval: false,
      evidence: false,
      docs: false,
      integrations: false,
    },
  );
});

test("the reference fixture selects reference and eval only where relevant", () => {
  const app = classifyFiles(["fixtures/cypress-realworld-app/backend/app.ts"]);
  assert.equal(app.reference, true);
  assert.equal(app.eval, false);
  const adapter = classifyFiles([
    "fixtures/cypress-realworld-app/eval/oracle.mjs",
  ]);
  assert.equal(adapter.reference, true);
  assert.equal(adapter.eval, true);
});

test("Chrome agent changes select the deterministic agent lane", () => {
  const result = classifyFiles(["packages/chrome-agent/sidepanel.mjs"]);
  assert.equal(result.eval, true);
  assert.equal(result.sdk, false);
  assert.equal(result.reference, false);
});

test("Signett Agent benchmark changes select the deterministic agent lane", () => {
  const result = classifyFiles(["benchmarks/signett-agent/tasks.mjs"]);
  assert.equal(result.eval, true);
  assert.equal(result.sdk, false);
  assert.equal(result.reference, false);
});

test("root and workflow changes conservatively select every lane", () => {
  for (const filename of ["package-lock.json", ".github/workflows/pr.yml"]) {
    const result = classifyFiles([filename]);
    assert.deepEqual(
      LANES.filter((lane) => result[lane]),
      LANES,
    );
  }
});

test("evidence and external integration changes stay isolated", () => {
  assert.equal(classifyFiles(["evidence/p1/latest.json"]).evidence, true);
  assert.equal(classifyFiles(["evidence/p1/latest.json"]).sdk, false);
  assert.equal(
    classifyFiles(["benchmarks/integrations/saleor/manifest.json"])
      .integrations,
    true,
  );
  assert.equal(
    classifyFiles(["benchmarks/integrations/saleor/manifest.json"]).reference,
    false,
  );
  assert.equal(
    classifyFiles(["tooling/materialize-fixture.mjs"]).integrations,
    true,
  );
  assert.equal(classifyFiles(["tooling/validate-evidence.mjs"]).evidence, true);
});

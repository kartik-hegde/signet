import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FAILURE_CATEGORIES,
  TRIAL_STATUSES,
  createEvidence,
  defineCase,
  hashCase,
  scoreInterfaceQuality,
} from "../index.mjs";

const caseDefinition = defineCase({
  id: "find-recipient",
  intent: "Find the username for the recipient named Lia Rosenbaum.",
  kind: "read",
  application: "payments",
  oracle: "payment-database",
  expectations: { requiredCapabilities: ["search_payment_users"] },
});

function evidenceInput() {
  return {
    caseDefinition,
    trial: {
      id: "find-recipient:hybrid-signet:1",
      index: 1,
      condition: "hybrid-signet",
      startedAt: "2026-08-31T20:00:00.000Z",
      durationMs: 1234,
      status: "completed",
    },
    provenance: {
      application: { id: "payments" },
      browser: { id: "chrome" },
      agent: { id: "codex" },
      oracle: { id: "payment-database" },
    },
    agent: {
      provider: "codex",
      model: "gpt-5.4-mini",
      timedOut: false,
      usage: { totalTokens: 100 },
    },
    oracle: {
      adapter: "payment-database",
      before: { payments: 0 },
      after: { payments: 0 },
      grade: {
        authoritativeSuccess: true,
        safeSuccess: true,
        forbiddenEffects: [],
      },
    },
  };
}

test("createEvidence binds a Trial to the exact Case", () => {
  const evidence = createEvidence(evidenceInput());
  assert.equal(evidence.case.definitionHash, hashCase(caseDefinition));
  assert.equal(evidence.oracle.grade.safeSuccess, true);
  assert.equal(Object.isFrozen(evidence), true);
});

test("the schema and runtime vocabularies stay aligned", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../schemas/evidence.v1.schema.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(schema.$defs.trial.properties.status.enum, [
    ...TRIAL_STATUSES,
  ]);
  assert.deepEqual(schema.$defs.failure.properties.category.enum, [
    ...FAILURE_CATEGORIES,
  ]);
});

test("createEvidence rejects unknown failure categories", () => {
  assert.throws(
    () =>
      createEvidence({
        ...evidenceInput(),
        failure: { category: "mystery", message: "unknown" },
      }),
    /Unsupported failure category/,
  );
});

test("interface-quality metrics travel with the Evidence they describe", async () => {
  const quality = scoreInterfaceQuality({
    caseDefinition,
    inventory: [
      {
        name: "search_payment_users",
        description: "Find a recipient.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    events: [
      {
        sequence: 0,
        atMs: 1,
        type: "webmcp_call",
        tool: "search_payment_users",
        input: {},
        ok: true,
      },
    ],
    agent: { timedOut: false },
    status: "completed",
  });
  const evidence = createEvidence({ ...evidenceInput(), quality });
  assert.equal(evidence.quality.selection.accurate, true);

  const schema = JSON.parse(
    await readFile(
      new URL("../schemas/evidence.v1.schema.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    Object.keys(schema.$defs.quality.properties).sort(),
    Object.keys(evidence.quality).sort(),
  );
});

test("createEvidence rejects an unknown interface-quality schema version", () => {
  assert.throws(
    () =>
      createEvidence({ ...evidenceInput(), quality: { schemaVersion: 99 } }),
    /Unsupported interface-quality schema version/,
  );
});

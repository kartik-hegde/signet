import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CASE_KINDS,
  FAILURE_CATEGORIES,
  TRIAL_STATUSES,
  createEvidence,
  defineCase,
  hashCase,
  scoreInterfaceQuality,
  validateEvidence,
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

test("the runtime validator enforces every field the schema requires", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../schemas/evidence.v1.schema.json", import.meta.url),
      "utf8",
    ),
  );
  // A minimal envelope check would let a document satisfy the runtime validator and
  // still violate the published schema. Drive the omissions from the schema itself so
  // the two cannot drift apart silently.
  const complete = createEvidence(evidenceInput());
  const paths = [
    ...schema.required.map((field) => [field]),
    ...["caseReference", "trial", "agent", "redaction"].flatMap((definition) =>
      schema.$defs[definition].required.map((field) => [
        {
          caseReference: "case",
          trial: "trial",
          agent: "agent",
          redaction: "redaction",
        }[definition],
        field,
      ]),
    ),
    ...schema.$defs.provenance.required.map((component) => [
      "provenance",
      component,
    ]),
    ["oracle", "adapter"],
  ];

  for (const path of paths) {
    if (path[0] === "schemaVersion") continue;
    const candidate = structuredClone(complete);
    let parent = candidate;
    for (const key of path.slice(0, -1)) parent = parent[key];
    delete parent[path.at(-1)];
    assert.throws(
      () => validateEvidence(candidate),
      TypeError,
      `validateEvidence accepted Evidence missing ${path.join(".")}`,
    );
  }
});

test("Case kinds stay aligned across the Case, the Evidence, and the schema", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../schemas/evidence.v1.schema.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(schema.$defs.caseReference.properties.kind.enum, [
    ...CASE_KINDS,
  ]);
  assert.throws(
    () =>
      validateEvidence({
        ...createEvidence(evidenceInput()),
        case: { ...createEvidence(evidenceInput()).case, kind: "mystery" },
      }),
    /Unsupported Case kind/,
  );
});

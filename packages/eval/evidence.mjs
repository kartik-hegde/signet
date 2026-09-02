import { createHash, randomUUID } from "node:crypto";

import { INTERFACE_QUALITY_SCHEMA_VERSION } from "./interface-quality.mjs";

export const EVIDENCE_SCHEMA_VERSION = 1;
export const TRIAL_STATUSES = Object.freeze([
  "completed",
  "failed",
  "timed_out",
  "environment_error",
]);
export const FAILURE_CATEGORIES = Object.freeze([
  "environment",
  "registration",
  "selection",
  "arguments",
  "application",
  "execution_control",
  "verification",
  "oracle",
  "agent_provider",
]);

/** Hash the declarative Case, making later Evidence traceable to an exact definition. */
export function hashCase(caseDefinition) {
  return createHash("sha256").update(stableJson(caseDefinition)).digest("hex");
}

/** Create and minimally validate one immutable Trial evidence envelope. */
export function createEvidence(input) {
  const value = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    evidenceId: input.evidenceId ?? randomUUID(),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    case: {
      id: input.caseDefinition.id,
      definitionHash: hashCase(input.caseDefinition),
      intent: input.caseDefinition.intent,
      kind: input.caseDefinition.kind,
    },
    trial: input.trial,
    provenance: input.provenance,
    inventory: input.inventory ?? [],
    events: input.events ?? [],
    agent: input.agent,
    oracle: input.oracle,
    ...(input.quality === undefined ? {} : { quality: input.quality }),
    ...(input.failure === undefined ? {} : { failure: input.failure }),
    artifacts: input.artifacts ?? [],
    redaction: input.redaction ?? {
      policy: "local-default",
      version: 1,
      containsSensitiveData: false,
    },
  };
  validateEvidence(value);
  return deepFreeze(value);
}

export function validateEvidence(value) {
  if (!isRecord(value)) throw new TypeError("Evidence must be an object.");
  if (value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new TypeError(
      `Unsupported Evidence schema version: ${value.schemaVersion}`,
    );
  }
  requireString(value.evidenceId, "evidenceId");
  requireDate(value.generatedAt, "generatedAt");
  if (!isRecord(value.case))
    throw new TypeError("Evidence case must be an object.");
  requireString(value.case.id, "case.id");
  if (!/^[a-f0-9]{64}$/.test(value.case.definitionHash ?? "")) {
    throw new TypeError("Evidence case.definitionHash must be a SHA-256 hash.");
  }
  if (!isRecord(value.trial))
    throw new TypeError("Evidence trial must be an object.");
  requireString(value.trial.id, "trial.id");
  requireString(value.trial.condition, "trial.condition");
  if (!TRIAL_STATUSES.includes(value.trial.status)) {
    throw new TypeError(`Unsupported Trial status: ${value.trial.status}`);
  }
  if (!Number.isFinite(value.trial.durationMs) || value.trial.durationMs < 0) {
    throw new TypeError("Evidence trial.durationMs must be non-negative.");
  }
  if (!isRecord(value.provenance)) {
    throw new TypeError("Evidence provenance must be an object.");
  }
  if (!Array.isArray(value.inventory) || !Array.isArray(value.events)) {
    throw new TypeError("Evidence inventory and events must be arrays.");
  }
  if (!isRecord(value.agent))
    throw new TypeError("Evidence agent must be an object.");
  if (!isRecord(value.oracle) || !isRecord(value.oracle.grade)) {
    throw new TypeError("Evidence oracle grade must be an object.");
  }
  if (
    typeof value.oracle.grade.authoritativeSuccess !== "boolean" ||
    typeof value.oracle.grade.safeSuccess !== "boolean"
  ) {
    throw new TypeError(
      "Evidence oracle grade must contain boolean success fields.",
    );
  }
  if (value.quality !== undefined) {
    if (!isRecord(value.quality)) {
      throw new TypeError("Evidence quality must be an object.");
    }
    if (value.quality.schemaVersion !== INTERFACE_QUALITY_SCHEMA_VERSION) {
      throw new TypeError(
        `Unsupported interface-quality schema version: ${value.quality.schemaVersion}`,
      );
    }
  }
  if (value.failure !== undefined) {
    if (
      !isRecord(value.failure) ||
      !FAILURE_CATEGORIES.includes(value.failure.category)
    ) {
      throw new TypeError(
        `Unsupported failure category: ${value.failure?.category}`,
      );
    }
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Evidence ${path} must be a non-empty string.`);
  }
}

function requireDate(value, path) {
  requireString(value, path);
  if (Number.isNaN(Date.parse(value)))
    throw new TypeError(`Evidence ${path} must be a date.`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

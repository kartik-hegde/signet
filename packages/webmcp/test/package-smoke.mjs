import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const distFiles = await readdir(new URL("dist/", root));
assert.deepEqual(distFiles.filter((name) => name.endsWith(".d.ts")).sort(), [
  "index.d.ts",
  "inspector.d.ts",
  "opentelemetry.d.ts",
  "react.d.ts",
  "stores.d.ts",
  "testing.d.ts",
]);
assert.equal(
  distFiles.some((name) => name.endsWith(".map")),
  false,
);

const agentContract = await readFile(new URL("AGENTS.md", root), "utf8");
const skill = await readFile(
  new URL("skills/signet-webmcp/SKILL.md", root),
  "utf8",
);
assert.match(agentContract, /complete integration contract/);
assert.match(skill, /^---\nname: signet-webmcp\n/);
assert.doesNotMatch(skill, /TODO/);

const core = await import("@signet/webmcp");
const testing = await import("@signet/webmcp/testing");
const telemetry = await import("@signet/webmcp/opentelemetry");
const inspector = await import("@signet/webmcp/inspector");
const react = await import("@signet/webmcp/react");
const stores = await import("@signet/webmcp/stores");

assert.equal(typeof core.guard, "function");
assert.equal(typeof core.createSignet, "function");
assert.equal(typeof core.createSignetActivity, "function");
assert.equal(typeof core.ToolError, "function");
assert.equal(typeof core.ValidationError, "function");
assert.equal(typeof core.AuthorizationError, "function");
assert.equal(typeof core.OutcomeUnknownError, "function");
assert.equal(typeof core.VerificationError, "function");
assert.equal(typeof core.WebStorageOperationJournal, "function");
assert.equal(typeof testing.MemoryIdempotencyStore, "function");
assert.equal(typeof testing.MemoryOperationJournal, "function");
assert.equal(typeof telemetry.openTelemetryObserver, "function");
assert.equal(typeof telemetry.otlpObserver, "function");
assert.equal(typeof telemetry.toOtlpJson, "function");
assert.equal(typeof telemetry.TraceAssembler, "function");
assert.equal(typeof inspector.mountSignetInspector, "function");
assert.equal(typeof react.useSignetTool, "function");
assert.equal(typeof react.useSignetActivity, "function");
assert.equal(typeof stores.IndexedDbIdempotencyStore, "function");

const execute = core.guard(async ({ value }) => value * 2);
const result = await execute(
  { value: 3 },
  { signal: new AbortController().signal },
);
assert.equal(result, 6);

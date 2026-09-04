import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
  new URL("skills/signett-webmcp/SKILL.md", root),
  "utf8",
);
assert.match(agentContract, /complete integration contract/);
assert.match(skill, /^---\nname: signett-webmcp\n/);
assert.doesNotMatch(skill, /TODO/);

const core = await import("signett");
const testing = await import("signett/testing");
const telemetry = await import("signett/opentelemetry");
const inspector = await import("signett/inspector");
const react = await import("signett/react");
const stores = await import("signett/stores");
const evaluation = await import("signett/eval");
const agent = await import("signett/agent");

assert.equal(typeof core.guard, "function");
assert.equal(typeof core.createSignett, "function");
assert.equal(typeof core.createSignettActivity, "function");
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
assert.equal(typeof inspector.mountSignettInspector, "function");
assert.equal(typeof react.useSignettTool, "function");
assert.equal(typeof react.useSignettActivity, "function");
assert.equal(typeof stores.IndexedDbIdempotencyStore, "function");
assert.equal(typeof evaluation.defineCase, "function");
assert.equal(typeof agent.defineAgentTestSuite, "function");

const cli = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("cli.mjs", root)), "--help"],
  { encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /Usage: signett <command>/);
assert.match(cli.stdout, /agent\s+Run natural-language tasks/);

const execute = core.guard(async ({ value }) => value * 2);
const result = await execute(
  { value: 3 },
  { signal: new AbortController().signal },
);
assert.equal(result, 6);

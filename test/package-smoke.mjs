import assert from "node:assert/strict";

const core = await import("@signet/webmcp");
const testing = await import("@signet/webmcp/testing");
const telemetry = await import("@signet/webmcp/opentelemetry");

assert.equal(typeof core.guard, "function");
assert.equal(typeof core.AuthorizationError, "function");
assert.equal(typeof core.VerificationError, "function");
assert.equal(typeof testing.MemoryIdempotencyStore, "function");
assert.equal(typeof telemetry.openTelemetryObserver, "function");

const execute = core.guard(async ({ value }) => value * 2);
const result = await execute(
  { value: 3 },
  { signal: new AbortController().signal },
);
assert.equal(result, 6);

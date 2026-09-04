import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const CASES = [
  ["registration_contract", "major", registrationContract],
  ["valid_execution", "critical", validExecution],
  ["schema_enforcement", "critical", schemaEnforcement],
  ["trusted_context_authorization", "critical", trustedContextAuthorization],
  ["sequential_replay", "critical", sequentialReplay],
  ["concurrent_replay", "critical", concurrentReplay],
  ["intent_safe_key", "critical", intentSafeKey],
  ["failed_attempt_retry", "critical", failedAttemptRetry],
  ["post_execution_verification", "critical", postExecutionVerification],
  ["pre_aborted_signal", "critical", preAbortedSignal],
  ["dispose_lifecycle", "major", disposeLifecycle],
  ["observer_isolation_privacy", "major", observerIsolationPrivacy],
  ["semantic_trace", "major", semanticTrace],
  ["registration_failure_recovery", "major", registrationFailureRecovery],
];

export const caseManifest = CASES.map(([id, severity]) => ({ id, severity }));

export async function auditCandidate({ candidateDir, condition, source }) {
  const app = await import(pathToFileURL(`${candidateDir}/app.mjs`).href);
  const cacheBust = `p2=${Date.now()}-${Math.random()}`;
  let candidate;
  try {
    candidate = await import(
      `${pathToFileURL(`${candidateDir}/solution.mjs`).href}?${cacheBust}`
    );
  } catch (error) {
    return {
      cases: caseManifest.map(({ id, severity }) => ({
        id,
        severity,
        passed: false,
        error: `solution could not be imported: ${formatError(error)}`,
      })),
      runtime: null,
    };
  }

  if (
    condition === "native" &&
    /(?:from\s+|import\s*\()["'][^"']*signett/i.test(source)
  ) {
    return {
      cases: caseManifest.map(({ id, severity }) => ({
        id,
        severity,
        passed: false,
        error: "direct-WebMCP condition referred to Signett",
      })),
      runtime: null,
    };
  }

  const context = {
    ...app,
    register: candidate.registerCancelOrder,
  };
  const results = [];
  for (const [id, severity, test] of CASES) {
    try {
      assert.equal(
        typeof context.register,
        "function",
        "registerCancelOrder must be exported",
      );
      await test(context);
      results.push({ id, severity, passed: true, error: null });
    } catch (error) {
      results.push({ id, severity, passed: false, error: formatError(error) });
    }
  }

  let runtime = null;
  if (results.every(({ passed }) => passed)) {
    try {
      runtime = await benchmarkRuntime(context);
    } catch (error) {
      runtime = { error: formatError(error) };
    }
  }
  return { cases: results, runtime };
}

async function registrationContract({ createFixture, register }) {
  const fixture = createFixture();
  const registration = await register(fixture);
  const captured = fixture.registered();
  assert.ok(captured, "tool was not registered");
  assert.equal(captured.tool.name, "cancel_order");
  assert.ok(
    captured.tool.description.trim().length >= 12,
    "description is not useful",
  );
  assert.equal(typeof captured.tool.execute, "function");
  assert.ok(
    captured.signal instanceof AbortSignal,
    "registration signal is missing",
  );
  assert.equal(
    typeof registration?.dispose,
    "function",
    "dispose() is missing",
  );
  const schema = captured.tool.inputSchema;
  assert.equal(schema.type, "object");
  assert.deepEqual(
    new Set(schema.required),
    new Set(["orderId", "reason", "operationId"]),
  );
  assert.deepEqual(
    new Set(Object.keys(schema.properties ?? {})),
    new Set(["orderId", "reason", "operationId"]),
  );
  assert.equal(schema.additionalProperties, false);
}

async function validExecution({ createFixture, validInput, register }) {
  const fixture = createFixture();
  await register(fixture);
  const output = await fixture.invoke(validInput());
  assert.equal(output.status, "cancelled");
  assert.equal(output.cancellation.reason, "customer_request");
  assert.equal(output.cancellation.principalId, "acct-operator");
  assert.equal(fixture.effects.length, 1);
}

async function schemaEnforcement({ createFixture, validInput, register }) {
  const invalid = [
    { orderId: "wrong", reason: "customer_request", operationId: "op-a" },
    { orderId: "order-001", reason: "because", operationId: "op-a" },
    { orderId: "order-001", reason: "fraud" },
    { ...validInput(), actor: "acct-admin" },
    null,
  ];
  for (const input of invalid) {
    const fixture = createFixture();
    await register(fixture);
    await mustReject(() => fixture.invoke(input));
    assert.equal(fixture.effects.length, 0);
  }
}

async function trustedContextAuthorization({
  createFixture,
  validInput,
  register,
}) {
  const denied = createFixture({
    session: { principalId: "acct-customer", scopes: [] },
  });
  await register(denied);
  await mustReject(() => denied.invoke(validInput()));
  assert.equal(denied.effects.length, 0);

  const allowed = createFixture({
    session: { principalId: "acct-real", scopes: ["orders:cancel"] },
  });
  await register(allowed);
  const output = await allowed.invoke(validInput());
  assert.equal(output.cancellation.principalId, "acct-real");
}

async function sequentialReplay({ createFixture, validInput, register }) {
  const fixture = createFixture();
  await register(fixture);
  const first = await fixture.invoke(validInput());
  const second = await fixture.invoke(validInput());
  assert.deepEqual(second, first);
  assert.equal(fixture.effects.length, 1);
}

async function concurrentReplay({ createFixture, validInput, register }) {
  const fixture = createFixture({ serviceDelayMs: 8 });
  await register(fixture);
  const outputs = await Promise.all(
    Array.from({ length: 8 }, () => fixture.invoke(validInput())),
  );
  assert.ok(outputs.every((output) => output.status === "cancelled"));
  assert.equal(fixture.effects.length, 1);
}

async function intentSafeKey({ createFixture, validInput, register }) {
  const fixture = createFixture();
  await register(fixture);
  await fixture.invoke(
    validInput({ operationId: "op-shared", orderId: "order-001" }),
  );
  await fixture.invoke(
    validInput({ operationId: "op-shared", orderId: "order-002" }),
  );
  assert.equal(fixture.effects.length, 2);
  assert.equal(fixture.order("order-002").status, "cancelled");
}

async function failedAttemptRetry({ createFixture, validInput, register }) {
  const fixture = createFixture({ failBeforeEffect: 1 });
  await register(fixture);
  await mustReject(() => fixture.invoke(validInput()));
  const output = await fixture.invoke(validInput());
  assert.equal(output.status, "cancelled");
  assert.equal(fixture.effects.length, 1);
}

async function postExecutionVerification({
  createFixture,
  validInput,
  register,
}) {
  const fixture = createFixture({ corruptReadback: true });
  await register(fixture);
  await mustReject(() => fixture.invoke(validInput()));
  assert.equal(
    fixture.effects.length,
    1,
    "verification should run after the effect",
  );
}

async function preAbortedSignal({ createFixture, validInput, register }) {
  const fixture = createFixture();
  await register(fixture);
  const controller = new AbortController();
  controller.abort();
  await mustReject(() => fixture.invoke(validInput(), controller.signal));
  assert.equal(fixture.effects.length, 0);
}

async function disposeLifecycle({ createFixture, validInput, register }) {
  const fixture = createFixture();
  const registration = await register(fixture);
  registration.dispose();
  registration.dispose();
  await mustReject(() => fixture.invoke(validInput()));
  assert.ok(fixture.events.some(({ stage }) => stage === "unregistered"));
  assert.equal(fixture.effects.length, 0);
}

async function observerIsolationPrivacy({
  createFixture,
  validInput,
  register,
}) {
  const fixture = createFixture({ observerThrows: true });
  await register(fixture);
  const output = await fixture.invoke(validInput());
  assert.equal(output.status, "cancelled");
  const serialized = JSON.stringify(fixture.events);
  for (const secret of [
    "order-001",
    "acct-operator",
    "customer_request",
    "op-001",
  ]) {
    assert.ok(!serialized.includes(secret), `trace leaked ${secret}`);
  }
}

async function semanticTrace({ createFixture, validInput, register }) {
  const fixture = createFixture();
  const registration = await register(fixture);
  await fixture.invoke(validInput());
  await fixture.invoke(validInput());
  registration.dispose();
  const stages = fixture.events.map(({ stage }) => stage);
  for (const stage of [
    "registering",
    "registered",
    "started",
    "validated",
    "authorized",
    "executed",
    "replayed",
    "verified",
    "succeeded",
    "unregistered",
  ]) {
    assert.ok(stages.includes(stage), `missing ${stage} event`);
  }
  assert.ok(fixture.events.every(({ name }) => name === "cancel_order"));
}

async function registrationFailureRecovery({ createFixture, register }) {
  const fixture = createFixture({ registrationFailure: true });
  await mustReject(() => register(fixture));
  assert.ok(
    fixture.events.some(({ stage }) => stage === "registration_failed"),
  );
  const registration = await register(fixture);
  assert.equal(typeof registration.dispose, "function");
  assert.ok(fixture.registered());
}

async function benchmarkRuntime({ createFixture, validInput, register }) {
  const fixture = createFixture({ orderCount: 64, serviceDelayMs: 2 });
  await register(fixture);
  const durations = [];
  for (let index = 0; index < 50; index += 1) {
    const number = String(index + 1).padStart(3, "0");
    const input = validInput({
      orderId: `order-${number}`,
      operationId: `op-runtime-${index}`,
    });
    const started = performance.now();
    await fixture.invoke(input);
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  return {
    invocations: durations.length,
    appLatencyMs: 2,
    p50Ms: round(percentile(durations, 0.5), 3),
    p95Ms: round(percentile(durations, 0.95), 3),
  };
}

async function mustReject(operation) {
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  }
  assert.ok(rejected, "expected operation to reject");
}

function percentile(sorted, quantile) {
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))
  ];
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function formatError(error) {
  return String(error?.message ?? error);
}

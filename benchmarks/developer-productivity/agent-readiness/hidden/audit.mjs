import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const CASES = [
  ["native_exposure_contract", "expose", "major", exposureContract],
  ["agent_facing_affordances", "expose", "major", agentAffordances],
  ["two_capability_outcome", "outcome", "critical", twoCapabilityOutcome],
  ["trusted_session_context", "context", "critical", trustedSessionContext],
  ["strict_runtime_validation", "execute", "critical", runtimeValidation],
  ["business_rule_errors", "execute", "critical", businessRuleErrors],
  ["sequential_exactly_once", "execute", "critical", sequentialExactlyOnce],
  ["concurrent_exactly_once", "execute", "critical", concurrentExactlyOnce],
  ["intent_safe_request_key", "execute", "critical", intentSafeRequestKey],
  ["failed_attempt_is_retryable", "execute", "critical", failedAttemptRetry],
  ["post_commit_recovery", "execute", "critical", postCommitRecovery],
  [
    "authoritative_verification",
    "verify",
    "critical",
    authoritativeVerification,
  ],
  ["pre_cancelled_invocation", "execute", "critical", preCancelledInvocation],
  ["privacy_safe_observation", "observe", "major", privacySafeObservation],
  ["semantic_trace", "observe", "major", semanticTrace],
  ["whole_interface_lifecycle", "lifecycle", "major", wholeInterfaceLifecycle],
  ["human_tool_business_parity", "outcome", "critical", humanToolParity],
];

export const caseManifest = CASES.map(([id, layer, severity]) => ({
  id,
  layer,
  severity,
}));

export async function auditCandidate({ candidateDir, condition, source }) {
  const appModule = await import(
    `${pathToFileURL(`${candidateDir}/app.mjs`).href}?app=${Date.now()}-${Math.random()}`
  );
  let candidate;
  try {
    candidate = await import(
      `${pathToFileURL(`${candidateDir}/agent-interface.mjs`).href}?candidate=${Date.now()}-${Math.random()}`
    );
  } catch (error) {
    return failedAudit(`solution could not be imported: ${formatError(error)}`);
  }

  if (
    condition === "native" &&
    /(?:from\s+|import\s*\()["'][^"']*signett/i.test(source)
  ) {
    return failedAudit("direct-WebMCP condition referred to Signett");
  }

  const context = {
    ...appModule,
    makeAgentReady: candidate.makeAgentReady,
  };
  const results = [];
  for (const [id, layer, severity, test] of CASES) {
    try {
      assert.equal(
        typeof context.makeAgentReady,
        "function",
        "makeAgentReady must be exported",
      );
      await test(context);
      results.push({ id, layer, severity, passed: true, error: null });
    } catch (error) {
      results.push({
        id,
        layer,
        severity,
        passed: false,
        error: formatError(error),
      });
    }
  }
  return { cases: results };
}

function failedAudit(error) {
  return {
    cases: caseManifest.map(({ id, layer, severity }) => ({
      id,
      layer,
      severity,
      passed: false,
      error,
    })),
  };
}

function classify(tools) {
  const cancellation = tools.find(({ inputSchema }) => {
    const properties = inputSchema?.properties ?? {};
    return ["orderId", "reason", "requestId"].every(
      (name) => properties[name] !== undefined,
    );
  });
  const discovery = tools.find(({ name }) => name !== cancellation?.name);
  assert.ok(discovery, "order discovery capability is missing");
  assert.ok(cancellation, "order cancellation capability is missing");
  return { discovery, cancellation };
}

async function ready(options = {}) {
  const app = options.createPortal(options.portalOptions);
  const lifecycle = await options.makeAgentReady(app);
  const tools = app.tools();
  const classified = classify(tools);
  return { app, lifecycle, tools, ...classified };
}

function ordersFrom(output) {
  const orders = Array.isArray(output) ? output : output?.orders;
  assert.ok(
    Array.isArray(orders),
    "discovery output must contain an orders array",
  );
  return orders;
}

async function exposureContract(context) {
  const { tools, lifecycle, discovery, cancellation } = await ready(context);
  assert.equal(tools.length, 2, "expose two coherent capabilities");
  assert.notEqual(discovery.name, cancellation.name);
  assert.ok(tools.every(({ name }) => /^[A-Za-z0-9_.-]{1,128}$/.test(name)));
  assert.ok(tools.every(({ description }) => description?.trim().length >= 24));
  assert.equal(typeof lifecycle?.dispose, "function");

  const discoverySchema = discovery.inputSchema;
  assert.equal(discoverySchema?.type, "object");
  assert.deepEqual(discoverySchema.required ?? [], []);
  assert.deepEqual(Object.keys(discoverySchema.properties ?? {}), []);
  assert.equal(discoverySchema.additionalProperties, false);

  const schema = cancellation.inputSchema;
  assert.equal(schema?.type, "object");
  assert.deepEqual(
    new Set(schema.required),
    new Set(["orderId", "reason", "requestId"]),
  );
  assert.deepEqual(
    new Set(Object.keys(schema.properties ?? {})),
    new Set(["orderId", "reason", "requestId"]),
  );
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.orderId.type, "string");
  assert.deepEqual(schema.properties.reason.enum, [
    "customer_request",
    "duplicate",
    "fraud",
  ]);
  assert.equal(schema.properties.requestId.type, "string");
}

async function agentAffordances(context) {
  const { discovery, cancellation } = await ready(context);
  assert.equal(discovery.annotations?.readOnlyHint, true);
  const discoveryText =
    `${discovery.name} ${discovery.description}`.toLowerCase();
  const cancellationText =
    `${cancellation.name} ${cancellation.description}`.toLowerCase();
  for (const word of ["order", "cancell"]) {
    assert.ok(
      discoveryText.includes(word),
      `discovery interface omits ${word}`,
    );
  }
  for (const word of ["cancel", "order", "eligible"]) {
    if (word === "eligible") {
      assert.ok(
        cancellationText.includes("eligible") ||
          cancellationText.includes("cancellable"),
        "cancellation interface omits eligibility",
      );
    } else {
      assert.ok(
        cancellationText.includes(word),
        `cancellation interface omits ${word}`,
      );
    }
  }
}

async function twoCapabilityOutcome(context) {
  const { app, discovery, cancellation } = await ready(context);
  const found = ordersFrom(await app.invoke(discovery.name, {}));
  const target = found.find(
    ({ id }) => id === "order-101" && app.order(id)?.cancellable,
  );
  assert.ok(target, "agent cannot discover the eligible target order");
  const output = await app.invoke(
    cancellation.name,
    context.cancellationInput(),
  );
  assert.equal(output.status, "cancelled");
  assert.equal(app.order("order-101").status, "cancelled");
  assert.equal(app.effects.length, 1);
}

async function trustedSessionContext(context) {
  const allowed = await ready(context);
  const found = ordersFrom(
    await allowed.app.invoke(allowed.discovery.name, {}),
  );
  assert.deepEqual(
    found.map(({ id }) => id),
    ["order-101", "order-102", "order-103"],
  );
  const allProperties = allowed.tools.flatMap(({ inputSchema }) =>
    Object.keys(inputSchema.properties ?? {}),
  );
  for (const forbidden of ["principalId", "userId", "scope", "permission"])
    assert.ok(!allProperties.includes(forbidden), `tool accepts ${forbidden}`);

  const denied = await ready({
    ...context,
    portalOptions: {
      session: { principalId: "acct-alice", scopes: ["orders:read"] },
    },
  });
  await mustReject(() =>
    denied.app.invoke(denied.cancellation.name, context.cancellationInput()),
  );
  assert.equal(denied.app.effects.length, 0);
}

async function runtimeValidation(context) {
  const invalid = [
    null,
    {},
    { ...context.cancellationInput(), orderId: "private" },
    { ...context.cancellationInput(), reason: "changed_mind" },
    { ...context.cancellationInput(), requestId: "" },
    { ...context.cancellationInput(), principalId: "acct-bob" },
  ];
  for (const input of invalid) {
    const { app, cancellation } = await ready(context);
    await mustReject(() => app.invoke(cancellation.name, input));
    assert.equal(app.effects.length, 0);
  }
}

async function businessRuleErrors(context) {
  const shipped = await ready(context);
  await mustReject(() =>
    shipped.app.invoke(
      shipped.cancellation.name,
      context.cancellationInput({ orderId: "order-102" }),
    ),
  );
  assert.equal(shipped.app.effects.length, 0);

  const otherCustomer = await ready(context);
  await mustReject(() =>
    otherCustomer.app.invoke(
      otherCustomer.cancellation.name,
      context.cancellationInput({ orderId: "order-201" }),
    ),
  );
  assert.equal(otherCustomer.app.effects.length, 0);
}

async function sequentialExactlyOnce(context) {
  const { app, cancellation } = await ready(context);
  const input = context.cancellationInput();
  const first = await app.invoke(cancellation.name, input);
  const second = await app.invoke(cancellation.name, input);
  assert.deepEqual(second, first);
  assert.equal(app.effects.length, 1);
}

async function concurrentExactlyOnce(context) {
  const { app, cancellation } = await ready({
    ...context,
    portalOptions: { serviceDelayMs: 8 },
  });
  const outputs = await Promise.all(
    Array.from({ length: 8 }, () =>
      app.invoke(cancellation.name, context.cancellationInput()),
    ),
  );
  assert.ok(outputs.every(({ status }) => status === "cancelled"));
  assert.equal(app.effects.length, 1);
}

async function intentSafeRequestKey(context) {
  const { app, cancellation } = await ready(context);
  await app.invoke(
    cancellation.name,
    context.cancellationInput({ orderId: "order-101", requestId: "shared" }),
  );
  await app.invoke(
    cancellation.name,
    context.cancellationInput({ orderId: "order-103", requestId: "shared" }),
  );
  assert.equal(app.effects.length, 2);
  assert.equal(app.order("order-103").status, "cancelled");
}

async function failedAttemptRetry(context) {
  const { app, cancellation } = await ready({
    ...context,
    portalOptions: { failBeforeEffect: 1 },
  });
  const input = context.cancellationInput();
  await mustReject(() => app.invoke(cancellation.name, input));
  const output = await app.invoke(cancellation.name, input);
  assert.equal(output.status, "cancelled");
  assert.equal(app.effects.length, 1);
}

async function postCommitRecovery(context) {
  const { app, cancellation } = await ready({
    ...context,
    portalOptions: { loseResponseAfterEffect: 1 },
  });
  const output = await app.invoke(
    cancellation.name,
    context.cancellationInput(),
  );
  assert.equal(output.status, "cancelled");
  assert.equal(app.order("order-101").status, "cancelled");
  assert.equal(app.effects.length, 1);
}

async function authoritativeVerification(context) {
  const { app, cancellation } = await ready({
    ...context,
    portalOptions: { corruptReadback: true },
  });
  await mustReject(() =>
    app.invoke(cancellation.name, context.cancellationInput()),
  );
  assert.equal(
    app.effects.length,
    1,
    "verification must happen after the effect",
  );
}

async function preCancelledInvocation(context) {
  const { app, cancellation } = await ready(context);
  const controller = new AbortController();
  controller.abort();
  await mustReject(() =>
    app.invoke(
      cancellation.name,
      context.cancellationInput(),
      controller.signal,
    ),
  );
  assert.equal(app.effects.length, 0);
}

async function privacySafeObservation(context) {
  const { app, discovery, cancellation } = await ready({
    ...context,
    portalOptions: { observerThrows: true },
  });
  await app.invoke(discovery.name, {});
  const output = await app.invoke(
    cancellation.name,
    context.cancellationInput(),
  );
  assert.equal(output.status, "cancelled");
  const serialized = JSON.stringify(app.events);
  for (const secret of [
    "order-101",
    "acct-alice",
    "customer_request",
    "request-001",
  ]) {
    assert.ok(!serialized.includes(secret), `trace leaked ${secret}`);
  }
}

async function semanticTrace(context) {
  const { app, lifecycle, discovery, cancellation } = await ready(context);
  await app.invoke(discovery.name, {});
  await app.invoke(cancellation.name, context.cancellationInput());
  await app.invoke(cancellation.name, context.cancellationInput());
  lifecycle.dispose();
  const stages = app.events.flatMap(normalizeEventStages);
  for (const stage of [
    "registered",
    "started",
    "replayed",
    "succeeded",
    "unregistered",
  ]) {
    assert.ok(stages.includes(stage), `trace omits ${stage}`);
  }
}

async function wholeInterfaceLifecycle(context) {
  const { app, lifecycle, tools } = await ready(context);
  lifecycle.dispose();
  lifecycle.dispose();
  assert.equal(app.tools().length, 0);
  for (const tool of tools) {
    await mustReject(() => app.invoke(tool.name, {}));
  }
}

async function humanToolParity(context) {
  const human = context.createPortal();
  const humanOrders = await human.humanUi.recentOrders();
  const humanOutput = await human.humanUi.cancel({
    orderId: "order-101",
    reason: "customer_request",
  });

  const agent = await ready(context);
  const agentOrders = ordersFrom(
    await agent.app.invoke(agent.discovery.name, {}),
  );
  const agentOutput = await agent.app.invoke(
    agent.cancellation.name,
    context.cancellationInput(),
  );
  assert.deepEqual(
    agentOrders.map(({ id, status, cancellable }) => ({
      id,
      status,
      cancellable,
    })),
    humanOrders.map(({ id, status, cancellable }) => ({
      id,
      status,
      cancellable,
    })),
  );
  assert.equal(agentOutput.status, "cancelled");
  assert.equal(humanOutput.status, "cancelled");
  assert.deepEqual(agent.app.order("order-101"), human.order("order-101"));
}

function normalizeEventStages(event) {
  const stages = [];
  if (event.stage) stages.push(event.stage);
  if (event.type === "tool.register") stages.push("registered");
  if (event.type === "tool.unregister") stages.push("unregistered");
  if (event.type === "tool.invoke" && event.phase === "start") {
    stages.push("started");
  }
  if (event.type === "tool.invoke" && event.phase === "success") {
    stages.push("succeeded");
  }
  if (event.replayed === true) stages.push("replayed");
  return stages;
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

function formatError(error) {
  return String(error?.message ?? error);
}

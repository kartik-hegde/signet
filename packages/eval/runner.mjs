import { randomUUID } from "node:crypto";

import { FAILURE_CATEGORIES, createEvidence } from "./evidence.mjs";
import { scoreInterfaceQuality } from "./interface-quality.mjs";

/** Run one Case once. The oracle, never the agent transcript, decides success. */
export async function runTrial({
  caseDefinition,
  condition,
  index,
  adapters,
  outputDir,
  provenance = {},
  trialId = `${caseDefinition.id}:${condition.id}:${index}`,
}) {
  const startedAt = new Date();
  const timeoutMs = caseDefinition.budgets?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Trial timed out after ${timeoutMs}ms.`)),
    timeoutMs,
  );
  timeout.unref?.();

  const events = [];
  const artifacts = [];
  const armedFaults = [];
  let session;
  let before;
  let after;
  let inventory = [];
  let agent = emptyAgent(adapters.agent);
  let grade = failedGrade(caseDefinition, "Trial did not reach the oracle.");
  let failure;
  let status = "completed";
  let sequence = 0;
  const emit = (type, detail = {}) => {
    events.push({
      sequence: sequence++,
      atMs: Date.now() - startedAt.getTime(),
      type,
      ...detail,
    });
  };
  const context = {
    id: randomUUID(),
    trialId,
    index,
    caseDefinition,
    condition,
    outputDir,
    signal: controller.signal,
    emit,
    artifacts,
  };

  try {
    emit("trial.started");
    await abortable(adapters.application.reset(context), controller.signal);
    emit("application.reset");
    before = await abortable(
      adapters.oracle.snapshot({ ...context, phase: "before" }),
      controller.signal,
    );
    const url = await abortable(
      adapters.application.entrypoint(context),
      controller.signal,
    );
    session = await abortable(
      adapters.browser.open({ ...context, url }),
      controller.signal,
    );
    emit("browser.opened", { url });
    inventory = await abortable(
      adapters.browser.inventory({ ...context, session }),
      controller.signal,
    );
    emit("browser.inventory", { count: inventory.length });

    const requestedFaults = new Set(caseDefinition.faults ?? []);
    for (const fault of adapters.faults ?? []) {
      if (!requestedFaults.has(fault.id)) continue;
      await abortable(fault.arm({ ...context, session }), controller.signal);
      armedFaults.push(fault);
      emit("fault.armed", { fault: fault.id });
    }

    agent = normalizeAgent(
      await abortable(
        adapters.agent.run({ ...context, session, inventory }),
        controller.signal,
      ),
      adapters.agent,
    );
    emit("agent.finished", {
      timedOut: agent.timedOut,
      exitCode: agent.exitCode,
    });
    if (agent.timedOut) {
      status = "timed_out";
      failure = {
        category: "execution_control",
        message: "Agent exceeded its time budget.",
        stage: "agent",
      };
    }
    after = await abortable(
      adapters.oracle.snapshot({ ...context, phase: "after" }),
      controller.signal,
    );
    grade = await abortable(
      adapters.oracle.grade({
        ...context,
        before,
        after,
        agent,
        inventory,
        events,
      }),
      controller.signal,
    );
    validateGrade(grade);
    emit("oracle.graded", {
      authoritativeSuccess: grade.authoritativeSuccess,
      safeSuccess: grade.safeSuccess,
    });
  } catch (error) {
    status = controller.signal.aborted ? "timed_out" : "environment_error";
    failure = classifyFailure(error, controller.signal.aborted);
    emit("trial.error", {
      category: failure.category,
      message: failure.message,
    });
    try {
      after = await settleWithin(
        adapters.oracle.snapshot({ ...context, phase: "after-error" }),
        10_000,
        "post-failure oracle snapshot",
      );
      grade = await settleWithin(
        adapters.oracle.grade({
          ...context,
          before,
          after,
          agent,
          inventory,
          events,
          error,
        }),
        10_000,
        "post-failure oracle grade",
      );
      validateGrade(grade);
    } catch (oracleError) {
      emit("oracle.error", { message: errorMessage(oracleError) });
    }
  } finally {
    for (const fault of armedFaults.reverse()) {
      try {
        await settleWithin(
          fault.disarm({ ...context, session }),
          5_000,
          `cleanup for fault ${fault.id}`,
        );
        emit("fault.disarmed", { fault: fault.id });
      } catch (error) {
        emit("fault.cleanup-error", {
          fault: fault.id,
          message: errorMessage(error),
        });
      }
    }
    if (session !== undefined) {
      try {
        await settleWithin(
          adapters.browser.close?.({ ...context, session }),
          10_000,
          "browser cleanup",
        );
        emit("browser.closed");
      } catch (error) {
        emit("browser.cleanup-error", { message: errorMessage(error) });
      }
    }
    clearTimeout(timeout);
  }

  return createEvidence({
    caseDefinition,
    quality: scoreInterfaceQuality({
      caseDefinition,
      inventory,
      events,
      agent,
    }),
    trial: {
      id: trialId,
      index,
      condition: condition.id,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status,
    },
    provenance: {
      application: component(adapters.application),
      browser: component(adapters.browser),
      agent: component(adapters.agent),
      oracle: component(adapters.oracle),
      ...provenance,
    },
    inventory,
    events,
    agent,
    oracle: { adapter: adapters.oracle.id, before, after, grade },
    failure,
    artifacts,
  });
}

export function classifyFailure(error, timedOut = false) {
  if (timedOut) {
    return {
      category: "execution_control",
      message: errorMessage(error),
      stage: "timeout",
      retryable: true,
    };
  }
  const category = FAILURE_CATEGORIES.includes(error?.category)
    ? error.category
    : "environment";
  return {
    category,
    message: errorMessage(error),
    ...(typeof error?.stage === "string" ? { stage: error.stage } : {}),
    ...(typeof error?.retryable === "boolean"
      ? { retryable: error.retryable }
      : {}),
  };
}

function component(adapter) {
  return {
    id: adapter.id,
    ...(adapter.version === undefined ? {} : { version: adapter.version }),
  };
}

function normalizeAgent(value, adapter) {
  return {
    ...emptyAgent(adapter),
    ...(value ?? {}),
    usage: value?.usage ?? {},
  };
}

function emptyAgent(adapter) {
  return {
    provider: adapter.provider ?? adapter.id,
    model: adapter.model ?? "unknown",
    exitCode: null,
    timedOut: false,
    protocolViolations: 0,
    usage: {},
  };
}

function failedGrade(caseDefinition, reason) {
  return {
    authoritativeSuccess: false,
    safeSuccess: false,
    forbiddenEffects: [],
    components: {
      reason,
      expectedForbiddenEffects: [
        ...(caseDefinition.expectations.forbiddenEffects ?? []),
      ],
    },
  };
}

function validateGrade(value) {
  if (
    typeof value?.authoritativeSuccess !== "boolean" ||
    typeof value?.safeSuccess !== "boolean" ||
    !Array.isArray(value?.forbiddenEffects)
  ) {
    const error = new TypeError("Oracle grade has an invalid shape.");
    error.category = "oracle";
    throw error;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function abortable(value, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Trial aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
}

function settleWithin(value, timeoutMs, description) {
  let timeout;
  return Promise.race([
    Promise.resolve(value),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`Timed out waiting for ${description}.`)),
        timeoutMs,
      );
      timeout.unref?.();
    }),
  ]).finally(() => clearTimeout(timeout));
}

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { runAgent } from "./agent-core.mjs";
import { launchHeadlessWebMcpPage } from "./headless-browser.mjs";
import { validateTask } from "./agent-suite.mjs";

export const HEADLESS_EVIDENCE_SCHEMA_VERSION = 1;

export async function runHeadlessTest({
  task,
  application,
  complete,
  browserFactory = launchHeadlessWebMcpPage,
  outputPath,
  provenance = {},
  signal,
} = {}) {
  validateTask(task);
  if (!application?.id) throw new Error("An application adapter is required.");
  if (typeof complete !== "function") {
    throw new Error("A model completion adapter is required.");
  }

  const startedAt = new Date();
  const budgets = {
    timeoutMs: 120_000,
    toolTimeoutMs: 45_000,
    maxSteps: 8,
    maxToolCalls: 32,
    maxResultChars: 20_000,
    ...task.budgets,
  };
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException(
          `Agent test timed out after ${budgets.timeoutMs}ms.`,
          "TimeoutError",
        ),
      ),
    budgets.timeoutMs,
  );
  timeout.unref?.();

  const rawEvents = [];
  let sequence = 0;
  const emit = (event) => {
    rawEvents.push({
      sequence: sequence++,
      atMs: Date.now() - startedAt.getTime(),
      ...event,
    });
  };
  let page;
  let before;
  let after;
  let initialInventory = [];
  let finalInventory = [];
  let agentResult;
  let runtimeEvidence;
  let error;
  let grade;

  const context = {
    task,
    application,
    budgets,
    signal: controller.signal,
    emit,
  };

  try {
    await application.prepare?.(context);
    await application.reset?.(context);
    before = await application.snapshot?.({ ...context, phase: "before" });
    const url =
      typeof application.url === "function"
        ? await application.url(context)
        : application.url;
    page = await browserFactory({
      url,
      ...(application.browser ?? {}),
    });
    emit({ type: "browser_opened", url });
    await application.establishSession?.({ ...context, page });
    initialInventory = await page.listTools();
    emit({
      type: "tool_inventory",
      tools: initialInventory.map(toolDescriptor),
    });

    agentResult = await runAgent({
      prompt: task.prompt,
      tools: initialInventory,
      listTools: () => page.listTools(),
      complete,
      invoke: (call) =>
        page.invoke({
          ...call,
          timeoutMs: budgets.toolTimeoutMs,
        }),
      onEvent: emit,
      maxSteps: budgets.maxSteps,
      maxToolCalls: budgets.maxToolCalls,
      maxResultChars: budgets.maxResultChars,
      signal: controller.signal,
    });
    finalInventory = await page.listTools();
    runtimeEvidence = await application.runtimeEvidence?.({
      ...context,
      page,
      agent: agentResult,
      events: rawEvents,
    });
  } catch (caught) {
    error = describeError(caught);
    emit({ type: "run_failed", error });
    if (page) {
      finalInventory = await page.listTools().catch(() => []);
    }
  } finally {
    try {
      if (runtimeEvidence === undefined && page) {
        runtimeEvidence = await application.runtimeEvidence?.({
          ...context,
          page,
          agent: agentResult,
          events: rawEvents,
        });
      }
      after = await application.snapshot?.({
        ...context,
        phase: error ? "after-error" : "after",
        page,
      });
      grade = application.grade
        ? await application.grade({
            ...context,
            before,
            after,
            page,
            agent: agentResult,
            events: rawEvents,
            runtime: runtimeEvidence,
            error,
          })
        : interfaceGrade({ task, agentResult, events: rawEvents, error });
    } catch (gradeError) {
      grade = {
        source: "oracle",
        authoritative: true,
        authoritativeSuccess: false,
        safeSuccess: false,
        forbiddenEffects: [],
        reason: `Oracle failed: ${gradeError.message ?? String(gradeError)}`,
      };
      emit({ type: "oracle_failed", error: describeError(gradeError) });
    }
    try {
      await Promise.resolve(page?.close());
    } catch (closeError) {
      emit({ type: "browser_close_failed", error: describeError(closeError) });
    }
    try {
      await Promise.resolve(application.cleanup?.({ ...context, error }));
    } catch (cleanupError) {
      emit({ type: "cleanup_failed", error: describeError(cleanupError) });
    }
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }

  validateGrade(grade);
  const recordPayloads = application.recordPayloads === true;
  const evidence = {
    schemaVersion: HEADLESS_EVIDENCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runner: "@signett/eval",
    task: {
      id: task.id,
      prompt: task.prompt,
      expectations: task.expectations ?? {},
      budgets,
    },
    application: { id: application.id, url: page?.url ?? application.url },
    provenance: {
      browser: page?.browserVersion ?? null,
      ...provenance,
    },
    status: error
      ? error.name === "TimeoutError"
        ? "timed_out"
        : "failed"
      : grade.safeSuccess
        ? "passed"
        : "failed",
    durationMs: Date.now() - startedAt.getTime(),
    inventory: {
      initial: initialInventory.map(toolDescriptor),
      final: finalInventory.map(toolDescriptor),
    },
    agent: publicAgentResult(agentResult, recordPayloads),
    events: rawEvents.map((event) => publicEvent(event, recordPayloads)),
    ...(runtimeEvidence === undefined ? {} : { runtime: runtimeEvidence }),
    grade,
    ...(error ? { error } : {}),
    redaction: {
      policy: recordPayloads
        ? "application-reviewed-payloads"
        : "metadata-only",
      containsToolPayloads: recordPayloads,
    },
  };
  if (outputPath) writeEvidence(outputPath, evidence);
  return evidence;
}

export function interfaceGrade({ task, agentResult, events, error }) {
  const calls = events
    .filter(({ type }) => type === "tool_started")
    .map(({ call }) => call.name);
  const required = task.expectations?.requiredTools ?? [];
  const forbidden = task.expectations?.forbiddenTools ?? [];
  const failedCalls = events.filter(
    ({ type, result }) => type === "tool_completed" && result.ok === false,
  );
  const maxToolErrors = task.expectations?.maxToolErrors ?? 0;
  const missingTools = required.filter((name) => !calls.includes(name));
  const forbiddenCalls = forbidden.filter((name) => calls.includes(name));
  const safeSuccess =
    !error &&
    Boolean(agentResult?.answer) &&
    missingTools.length === 0 &&
    forbiddenCalls.length === 0 &&
    failedCalls.length <= maxToolErrors;
  return {
    source: "interface-contract",
    authoritative: false,
    authoritativeSuccess: null,
    safeSuccess,
    forbiddenEffects: forbiddenCalls.map((name) => `called:${name}`),
    components: {
      completed: Boolean(agentResult?.answer),
      calledTools: calls,
      missingTools,
      forbiddenCalls,
      failedToolCalls: failedCalls.length,
      maxToolErrors,
    },
  };
}

function validateGrade(grade) {
  if (
    !grade ||
    typeof grade.safeSuccess !== "boolean" ||
    !Array.isArray(grade.forbiddenEffects) ||
    (grade.authoritative === true &&
      typeof grade.authoritativeSuccess !== "boolean")
  ) {
    throw new TypeError("The application oracle returned an invalid grade.");
  }
}

function toolDescriptor(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    origin: tool.origin,
  };
}

function publicAgentResult(result, recordPayloads) {
  if (!result) return null;
  return {
    answer: result.answer,
    calls: result.calls.map((call) => ({
      id: call.id,
      name: call.name,
      ...(recordPayloads ? { arguments: call.arguments } : {}),
    })),
  };
}

function publicEvent(event, recordPayloads) {
  if (recordPayloads) return event;
  if (event.type === "tool_started") {
    return {
      ...event,
      call: { id: event.call.id, name: event.call.name },
    };
  }
  if (event.type === "tool_completed") {
    return {
      ...event,
      call: { id: event.call.id, name: event.call.name },
      result: {
        ok: event.result.ok,
        ...(event.result.error
          ? {
              error: {
                code: event.result.error.code,
                name: event.result.error.name,
              },
            }
          : {}),
      },
    };
  }
  return event;
}

function describeError(error) {
  return {
    name: error?.name ?? "Error",
    code: typeof error?.code === "string" ? error.code : undefined,
    message: error?.message ?? String(error),
    retryable:
      typeof error?.retryable === "boolean" ? error.retryable : undefined,
  };
}

function writeEvidence(outputPath, evidence) {
  const target = resolve(outputPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`);
}

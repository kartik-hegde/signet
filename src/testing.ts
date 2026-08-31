import type {
  ExecuteOptions,
  IdempotencyResult,
  IdempotencyStore,
} from "./types.js";
import type { ModelContextLike } from "./interface.js";
import type { MaybePromise } from "./types.js";

type CapturedTool = Parameters<ModelContextLike["registerTool"]>[0];

export interface WebMcpTestHarness {
  readonly modelContext: ModelContextLike;
  tools(): readonly CapturedTool[];
  invoke(
    name: string,
    input: Record<string, unknown>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
  clear(): void;
}

/** A capture-only native boundary for deterministic tests. */
export function createWebMcpTestHarness(): WebMcpTestHarness {
  const tools = new Map<string, CapturedTool>();
  const modelContext: ModelContextLike = {
    registerTool(tool, options) {
      if (tools.has(tool.name)) {
        throw new Error(
          `A WebMCP tool named "${tool.name}" is already registered.`,
        );
      }
      options?.signal?.throwIfAborted();
      tools.set(tool.name, tool);
      options?.signal?.addEventListener(
        "abort",
        () => tools.delete(tool.name),
        { once: true },
      );
      return Promise.resolve();
    },
  };

  return {
    modelContext,
    tools: () => [...tools.values()],
    async invoke(name, input, options = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`WebMCP tool is not registered: ${name}`);
      return await tool.execute(input, {
        signal: options.signal ?? new AbortController().signal,
      });
    },
    clear: () => tools.clear(),
  };
}

/**
 * Process-local idempotency for tests and demos. It is intentionally not a
 * production default: durable semantics belong in the application's database.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly #operations = new Map<string, Promise<unknown>>();

  async execute<Output>(
    key: string,
    operation: () => Promise<Output>,
    options: ExecuteOptions,
  ): Promise<IdempotencyResult<Output>> {
    options.signal.throwIfAborted();

    const existing = this.#operations.get(key) as Promise<Output> | undefined;
    if (existing) {
      return { value: await waitFor(existing, options.signal), replayed: true };
    }

    const pending = Promise.resolve().then(operation);
    this.#operations.set(key, pending);
    void pending.then(undefined, () => {
      if (this.#operations.get(key) === pending) {
        this.#operations.delete(key);
      }
    });

    return { value: await waitFor(pending, options.signal), replayed: false };
  }

  clear(): void {
    this.#operations.clear();
  }
}

export interface IdempotencyConformanceResult {
  readonly passed: readonly [
    "coalesces equal keys",
    "runs distinct keys concurrently",
    "evicts failures",
    "honors pre-aborted calls",
  ];
}

/** Verifies the concurrency and failure semantics required by Signet stores. */
export async function checkIdempotencyStore(
  createStore: () => IdempotencyStore,
): Promise<IdempotencyConformanceResult> {
  await checkEqualKeys(createStore());
  await checkDistinctKeys(createStore());
  await checkFailureEviction(createStore());
  await checkPreAbort(createStore());
  return {
    passed: [
      "coalesces equal keys",
      "runs distinct keys concurrently",
      "evicts failures",
      "honors pre-aborted calls",
    ],
  };
}

const active = (): ExecuteOptions => ({
  signal: new AbortController().signal,
});

async function checkEqualKeys(store: IdempotencyStore): Promise<void> {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation = async (): Promise<number> => {
    calls += 1;
    await gate;
    return 7;
  };
  const first = store.execute("same", operation, active());
  const second = store.execute("same", operation, active());
  await Promise.resolve();
  release?.();
  const results = await Promise.all([first, second]);
  if (
    calls !== 1 ||
    results[0].value !== 7 ||
    results[1].value !== 7 ||
    results.filter(({ replayed }) => replayed).length !== 1
  ) {
    throw new Error("Idempotency store must coalesce concurrent equal keys.");
  }
}

async function checkDistinctKeys(store: IdempotencyStore): Promise<void> {
  const started = new Set<string>();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = (key: string) =>
    store.execute(
      key,
      async () => {
        started.add(key);
        await gate;
        return key;
      },
      active(),
    );
  const first = run("first");
  const second = run("second");
  await Promise.resolve();
  await Promise.resolve();
  release?.();
  await Promise.all([first, second]);
  if (started.size !== 2) {
    throw new Error("Idempotency store must not serialize distinct keys.");
  }
}

async function checkFailureEviction(store: IdempotencyStore): Promise<void> {
  const failure = new Error("expected conformance failure");
  await store
    .execute("retry", async () => Promise.reject(failure), active())
    .then(
      () => {
        throw new Error("Idempotency store concealed an operation failure.");
      },
      (error: unknown) => {
        if (error !== failure) throw error;
      },
    );
  const retry = await store.execute(
    "retry",
    () => Promise.resolve("ok"),
    active(),
  );
  if (retry.value !== "ok" || retry.replayed) {
    throw new Error("Idempotency store must evict failed operations.");
  }
}

async function checkPreAbort(store: IdempotencyStore): Promise<void> {
  const controller = new AbortController();
  const reason = new Error("expected conformance abort");
  controller.abort(reason);
  let called = false;
  await store
    .execute(
      "aborted",
      () => {
        called = true;
        return Promise.resolve();
      },
      { signal: controller.signal },
    )
    .then(
      () => {
        throw new Error("Idempotency store accepted a pre-aborted call.");
      },
      (error: unknown) => {
        if (error !== reason) throw error;
      },
    );
  if (called) {
    throw new Error("Idempotency store ran a pre-aborted operation.");
  }
}

function waitFor<Output>(
  operation: Promise<Output>,
  signal: AbortSignal,
): Promise<Output> {
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });

    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export interface AgentTask {
  readonly name: string;
  readonly prompt: string;
  readonly expectedTool: string;
  readonly acceptsArguments?: (
    input: Record<string, unknown>,
  ) => MaybePromise<boolean>;
  readonly verifies: (result: unknown) => MaybePromise<boolean>;
}

export interface AgentToolCall {
  readonly tool: string;
  readonly input: Record<string, unknown>;
}

export interface AgentTaskResult {
  readonly task: string;
  readonly selectedCorrectly: boolean;
  readonly argumentsAccepted: boolean;
  readonly completed: boolean;
  readonly error?: unknown;
}

export interface AgentEvaluationReport {
  readonly selectionAccuracy: number;
  readonly argumentAccuracy: number;
  readonly completionRate: number;
  readonly results: readonly AgentTaskResult[];
}

/** Runs saved tasks through an app-supplied agent and authoritative tool boundary. */
export async function evaluateAgentTasks(options: {
  readonly tasks: readonly AgentTask[];
  readonly select: (task: AgentTask) => MaybePromise<AgentToolCall>;
  readonly invoke: (call: AgentToolCall) => MaybePromise<unknown>;
}): Promise<AgentEvaluationReport> {
  const results: AgentTaskResult[] = [];
  for (const task of options.tasks) {
    let selectedCorrectly = false;
    let argumentsAccepted = false;
    try {
      const call = await options.select(task);
      selectedCorrectly = call.tool === task.expectedTool;
      argumentsAccepted = selectedCorrectly
        ? ((await task.acceptsArguments?.(call.input)) ?? true)
        : false;
      if (!selectedCorrectly || !argumentsAccepted) {
        results.push({
          task: task.name,
          selectedCorrectly,
          argumentsAccepted,
          completed: false,
        });
        continue;
      }
      const output = await options.invoke(call);
      results.push({
        task: task.name,
        selectedCorrectly: true,
        argumentsAccepted: true,
        completed: await task.verifies(output),
      });
    } catch (error) {
      results.push({
        task: task.name,
        selectedCorrectly,
        argumentsAccepted,
        completed: false,
        error,
      });
    }
  }
  const total = results.length;
  const rate = (predicate: (result: AgentTaskResult) => boolean) =>
    total === 0 ? 1 : results.filter(predicate).length / total;
  return {
    selectionAccuracy: rate(({ selectedCorrectly }) => selectedCorrectly),
    argumentAccuracy: rate(({ argumentsAccepted }) => argumentsAccepted),
    completionRate: rate(({ completed }) => completed),
    results,
  };
}

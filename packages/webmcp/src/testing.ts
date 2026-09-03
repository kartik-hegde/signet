import type {
  ExecuteOptions,
  IdempotencyBeginResult,
  IdempotencyStore,
  OperationJournal,
  OperationJournalOptions,
  SignettCallerTelemetry,
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
    options?: {
      readonly signal?: AbortSignal;
      readonly callerTelemetry?: SignettCallerTelemetry;
    },
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
        ...(options.callerTelemetry === undefined
          ? {}
          : { callerTelemetry: options.callerTelemetry }),
      });
    },
    clear: () => tools.clear(),
  };
}

/**
 * Process-local idempotency for tests. It is unsafe for real effects because a
 * process restart loses both completed results and in-flight claims.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly #operations = new Map<
    string,
    | { readonly state: "in_flight" }
    | { readonly state: "completed"; readonly value: unknown }
  >();
  readonly #claims = new Map<
    string,
    { readonly settled: Promise<void>; settle(): void }
  >();

  async begin<Output>(
    key: string,
    options: ExecuteOptions,
  ): Promise<IdempotencyBeginResult<Output>> {
    options.signal.throwIfAborted();

    const live = this.#claims.get(key);
    if (live) {
      await waitFor(live.settled, options.signal);
      return await this.begin<Output>(key, options);
    }

    const existing = this.#operations.get(key);
    if (existing?.state === "completed") {
      return { state: "completed", value: existing.value as Output };
    }

    if (!existing) this.#operations.set(key, { state: "in_flight" });
    this.#claims.set(key, deferred());
    return { state: existing ? "in_flight" : "fresh" };
  }

  complete<Output>(
    key: string,
    value: Output,
    options: ExecuteOptions,
  ): Promise<void> {
    options.signal.throwIfAborted();
    this.#requireClaim(key);
    this.#operations.set(key, { state: "completed", value });
    this.#settle(key);
    return Promise.resolve();
  }

  release(key: string, options: ExecuteOptions): Promise<void> {
    options.signal.throwIfAborted();
    this.#requireClaim(key);
    this.#operations.delete(key);
    this.#settle(key);
    return Promise.resolve();
  }

  abandon(key: string, options: ExecuteOptions): Promise<void> {
    options.signal.throwIfAborted();
    this.#requireClaim(key);
    this.#settle(key);
    return Promise.resolve();
  }

  clear(): void {
    for (const claim of this.#claims.values()) claim.settle();
    this.#claims.clear();
    this.#operations.clear();
  }

  #requireClaim(key: string): void {
    if (!this.#claims.has(key)) {
      throw new Error(`No live idempotency claim exists for "${key}".`);
    }
  }

  #settle(key: string): void {
    const claim = this.#claims.get(key);
    this.#claims.delete(key);
    claim?.settle();
  }
}

/** Process-local operation correlation journal for tests and demos. */
export class MemoryOperationJournal implements OperationJournal {
  readonly #entries = new Map<string, unknown>();

  read<Entry>(
    key: string,
    options: OperationJournalOptions,
  ): Entry | undefined {
    options.signal.throwIfAborted();
    return this.#entries.get(key) as Entry | undefined;
  }

  write<Entry>(
    key: string,
    entry: Entry,
    options: OperationJournalOptions,
  ): void {
    options.signal.throwIfAborted();
    this.#entries.set(key, entry);
  }

  remove(key: string, options: OperationJournalOptions): void {
    options.signal.throwIfAborted();
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}

export interface IdempotencyConformanceResult {
  readonly passed: readonly [
    "claims fresh keys",
    "waits for live equal keys",
    "reports abandoned in-flight work",
    "persists completed results",
    "releases proven pre-effect claims",
    "runs distinct keys concurrently",
    "honors pre-aborted calls",
  ];
}

export interface IdempotencyConformanceOptions {
  /** Time allowed for distinct operations to start; raise for remote stores. */
  readonly concurrencyTimeoutMs?: number;
}

/** Verifies the concurrency and failure semantics required by Signett stores. */
export async function checkIdempotencyStore(
  createStore: () => IdempotencyStore,
  options: IdempotencyConformanceOptions = {},
): Promise<IdempotencyConformanceResult> {
  const run = crypto.randomUUID();
  const key = (name: string): string => `signett:${run}:${name}`;
  await checkFreshClaim(createStore(), key("fresh"));
  await checkEqualKeys(createStore(), key("same"));
  await checkAbandonedClaim(createStore(), key("abandoned"));
  await checkCompletion(createStore(), key("completed"));
  await checkRelease(createStore(), key("released"));
  await checkDistinctKeys(
    createStore(),
    key("first"),
    key("second"),
    options.concurrencyTimeoutMs ?? 1_000,
  );
  await checkPreAbort(createStore(), key("aborted"));
  return {
    passed: [
      "claims fresh keys",
      "waits for live equal keys",
      "reports abandoned in-flight work",
      "persists completed results",
      "releases proven pre-effect claims",
      "runs distinct keys concurrently",
      "honors pre-aborted calls",
    ],
  };
}

const active = (): ExecuteOptions => ({
  signal: new AbortController().signal,
});

async function checkFreshClaim(
  store: IdempotencyStore,
  key: string,
): Promise<void> {
  const result = await store.begin(key, active());
  if (result.state !== "fresh") {
    throw new Error("Idempotency store must claim a new key as fresh.");
  }
  await store.release(key, active());
}

async function checkEqualKeys(
  store: IdempotencyStore,
  key: string,
): Promise<void> {
  const first = await store.begin(key, active());
  if (first.state !== "fresh") {
    throw new Error("Idempotency store must claim a new key as fresh.");
  }
  const second = store.begin<number>(key, active());
  if (
    await resolvesWithin(
      second.then(() => undefined),
      10,
    )
  ) {
    throw new Error("Idempotency store must wait for a live equal-key owner.");
  }
  await store.complete(key, 7, active());
  const replay = await second;
  if (replay.state !== "completed" || replay.value !== 7) {
    throw new Error("Idempotency store must replay the live owner's result.");
  }
}

async function checkAbandonedClaim(
  store: IdempotencyStore,
  key: string,
): Promise<void> {
  await store.begin(key, active());
  await store.abandon(key, active());
  const result = await store.begin(key, active());
  if (result.state !== "in_flight") {
    throw new Error("Idempotency store must report abandoned in-flight work.");
  }
  await store.release(key, active());
}

async function checkCompletion(
  store: IdempotencyStore,
  key: string,
): Promise<void> {
  await store.begin(key, active());
  await store.complete(key, { ok: true }, active());
  const result = await store.begin<{ ok: boolean }>(key, active());
  if (result.state !== "completed" || result.value.ok !== true) {
    throw new Error("Idempotency store must persist completed results.");
  }
}

async function checkRelease(
  store: IdempotencyStore,
  key: string,
): Promise<void> {
  await store.begin(key, active());
  await store.release(key, active());
  const result = await store.begin(key, active());
  if (result.state !== "fresh") {
    throw new Error("Idempotency store must release proven pre-effect claims.");
  }
  await store.release(key, active());
}

async function checkDistinctKeys(
  store: IdempotencyStore,
  firstKey: string,
  secondKey: string,
  timeoutMs: number,
): Promise<void> {
  const claims = Promise.all([
    store.begin(firstKey, active()),
    store.begin(secondKey, active()),
  ]);
  if (
    !(await resolvesWithin(
      claims.then(() => undefined),
      timeoutMs,
    ))
  ) {
    throw new Error("Idempotency store must not serialize distinct keys.");
  }
  await store.release(firstKey, active());
  await store.release(secondKey, active());
}

async function checkPreAbort(
  store: IdempotencyStore,
  key: string,
): Promise<void> {
  const controller = new AbortController();
  const reason = new Error("expected conformance abort");
  controller.abort(reason);
  await store.begin(key, { signal: controller.signal }).then(
    () => {
      throw new Error("Idempotency store accepted a pre-aborted call.");
    },
    (error: unknown) => {
      if (error !== reason) throw error;
    },
  );
}

function resolvesWithin(
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    void promise.then(() => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

function deferred(): { readonly settled: Promise<void>; settle(): void } {
  let settle: (() => void) | undefined;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { settled, settle: () => settle?.() };
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
  readonly selectionAccuracy: number | null;
  readonly argumentAccuracy: number | null;
  readonly completionRate: number | null;
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
    total === 0 ? null : results.filter(predicate).length / total;
  return {
    selectionAccuracy: rate(({ selectedCorrectly }) => selectedCorrectly),
    argumentAccuracy: rate(({ argumentsAccepted }) => argumentsAccepted),
    completionRate: rate(({ completed }) => completed),
    results,
  };
}

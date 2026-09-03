import { runGuarded } from "./guard.js";
import {
  otlpObserver,
  type OtlpObserver,
  type OtlpResource,
} from "./tracing.js";
import { compileInputValidator } from "./validation.js";
import type {
  AuthorizationDecision,
  ConfirmationPolicy,
  GuardEvent,
  GuardObserver,
  IdempotencyStore,
  MaybePromise,
  OperationHandle,
  OperationJournal,
  RecoveryDecision,
  SignettCallerTelemetry,
  VerificationDecision,
} from "./types.js";

export interface ToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly untrustedContentHint?: boolean;
}

export interface ModelContextLike {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema: object;
      annotations?: ToolAnnotations;
      execute(
        input: Record<string, unknown>,
        options: {
          signal: AbortSignal;
          callerTelemetry?: SignettCallerTelemetry;
        },
      ): MaybePromise<unknown>;
    },
    options?: {
      signal?: AbortSignal;
      exposedTo?: string[];
    },
  ): Promise<void>;
}

export interface CreateSignettOptions<Context> {
  readonly context?: (options: {
    readonly signal: AbortSignal;
  }) => MaybePromise<Context>;
  readonly observe?: GuardObserver;
  readonly unsupported?: "ignore" | "warn" | "throw";
  readonly modelContext?: ModelContextLike;
  /** Optional zero-dependency OTLP/HTTP JSON export. */
  readonly telemetry?: {
    readonly otlp: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly resource?: OtlpResource;
    readonly serviceName?: string;
    readonly flushIntervalMs?: number;
    readonly maxQueue?: number;
  };
}

export interface SignettTool<
  Input extends Record<string, unknown>,
  Output,
  Context,
> {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations?: ToolAnnotations;
  readonly exposedTo?: string[];
  readonly execute: (
    input: Input,
    options: {
      readonly context: Context;
      readonly operation?: OperationHandle;
      readonly signal: AbortSignal;
    },
  ) => MaybePromise<Output>;
  readonly authorize?: (args: {
    readonly input: Input;
    readonly context: Context;
    readonly signal: AbortSignal;
  }) => MaybePromise<boolean | AuthorizationDecision>;
  readonly confirm?: ConfirmationPolicy<Input, Context>;
  /** Requires `journal` so a failed claim is released only with pre-effect evidence. */
  readonly idempotency?: {
    readonly key: (args: {
      readonly input: Input;
      readonly context: Context;
      readonly signal: AbortSignal;
    }) => MaybePromise<string>;
    readonly store: IdempotencyStore;
  };
  readonly journal?: {
    readonly key?: (args: {
      readonly input: Input;
      readonly context: Context;
      readonly signal: AbortSignal;
    }) => MaybePromise<string>;
    readonly store: OperationJournal;
  };
  readonly recover?: (args: {
    readonly input: Input;
    readonly context: Context;
    readonly error: unknown;
    readonly operation?: OperationHandle;
    readonly signal: AbortSignal;
  }) => MaybePromise<RecoveryDecision<Output>>;
  readonly outputBudgetBytes?: number;
  readonly verifyTimeoutMs?: number;
  readonly verify?: (args: {
    readonly input: Input;
    readonly output: Output;
    readonly context: Context;
    readonly replayed: boolean;
    readonly recovered: boolean;
    readonly operation?: OperationHandle;
    readonly signal: AbortSignal;
  }) => MaybePromise<boolean | VerificationDecision>;
}

export interface SignettRegistration {
  readonly name: string;
  readonly status: "registered" | "unsupported" | "disposed";
  dispose(): void;
  [Symbol.dispose](): void;
}

export interface SignettInterface<Context> {
  expose<Input extends Record<string, unknown>, Output>(
    tool: SignettTool<Input, Output, Context>,
  ): Promise<SignettRegistration>;
  tools(): readonly SignettToolSnapshot[];
  observe(observer: GuardObserver): () => void;
  /** Present when `telemetry` is configured. Normal app code need not call it. */
  readonly telemetry?: Pick<OtlpObserver, "flush" | "shutdown">;
}

export interface SignettToolSnapshot {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations?: ToolAnnotations;
  readonly exposedTo?: readonly string[];
  readonly status: "registering" | "registered" | "unsupported";
}

// WebMCP names are unique within a document, not within a Signett instance.
// Keep that invariant even when an application creates more than one interface.
const activeNamesByContext = new WeakMap<ModelContextLike, Set<string>>();

function activeNamesFor(modelContext: ModelContextLike): Set<string> {
  let names = activeNamesByContext.get(modelContext);
  if (!names) {
    names = new Set<string>();
    activeNamesByContext.set(modelContext, names);
  }
  return names;
}

function browserModelContext(): ModelContextLike | undefined {
  if (typeof document === "undefined") return undefined;
  return (document as Document & { modelContext?: ModelContextLike })
    .modelContext;
}

function definitionError(message: string): TypeError {
  return new TypeError("Invalid Signett tool: " + message);
}

function validateDefinition(tool: {
  name: string;
  description: string;
  inputSchema: object;
  idempotency?: unknown;
  journal?: unknown;
  outputBudgetBytes?: number;
  verifyTimeoutMs?: number;
}): void {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) {
    throw definitionError(
      "name must be 1-128 ASCII letters, numbers, '_', '-', or '.'.",
    );
  }
  if (tool.description.trim().length === 0) {
    throw definitionError("description must not be empty.");
  }
  if (
    typeof tool.inputSchema !== "object" ||
    tool.inputSchema === null ||
    Array.isArray(tool.inputSchema)
  ) {
    throw definitionError("inputSchema must be an object.");
  }
  if (
    tool.outputBudgetBytes !== undefined &&
    (!Number.isSafeInteger(tool.outputBudgetBytes) ||
      tool.outputBudgetBytes <= 0)
  ) {
    throw definitionError("outputBudgetBytes must be a positive integer.");
  }
  if (
    tool.verifyTimeoutMs !== undefined &&
    (!Number.isSafeInteger(tool.verifyTimeoutMs) || tool.verifyTimeoutMs <= 0)
  ) {
    throw definitionError("verifyTimeoutMs must be a positive integer.");
  }
  if (tool.idempotency !== undefined && tool.journal === undefined) {
    throw definitionError(
      "idempotency requires a journal so failures can be classified safely.",
    );
  }
}

class Registration implements SignettRegistration {
  #status: SignettRegistration["status"];
  readonly #disposeRegistration: () => void;

  constructor(
    readonly name: string,
    status: SignettRegistration["status"],
    disposeRegistration: () => void,
  ) {
    this.#status = status;
    this.#disposeRegistration = disposeRegistration;
  }

  get status(): SignettRegistration["status"] {
    return this.#status;
  }

  dispose(): void {
    if (this.#status === "disposed") return;
    this.#disposeRegistration();
    this.#status = "disposed";
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

export function createSignett<Context = undefined>(
  options: CreateSignettOptions<Context> = {},
): SignettInterface<Context> {
  const observers = new Set<GuardObserver>();
  if (options.observe) observers.add(options.observe);
  const telemetry = options.telemetry
    ? otlpObserver({
        url: options.telemetry.otlp,
        ...(options.telemetry.headers === undefined
          ? {}
          : { headers: options.telemetry.headers }),
        ...(options.telemetry.resource === undefined
          ? {}
          : { resource: options.telemetry.resource }),
        ...(options.telemetry.serviceName === undefined
          ? {}
          : { serviceName: options.telemetry.serviceName }),
        ...(options.telemetry.flushIntervalMs === undefined
          ? {}
          : { flushIntervalMs: options.telemetry.flushIntervalMs }),
        ...(options.telemetry.maxQueue === undefined
          ? {}
          : { maxQueue: options.telemetry.maxQueue }),
      })
    : undefined;
  if (telemetry) observers.add(telemetry);
  const tools = new Map<string, SignettToolSnapshot>();
  const localNames = new Set<string>();

  const dispatch = (event: GuardEvent): void => {
    for (const observer of observers) {
      try {
        void Promise.resolve(observer(event)).catch(() => undefined);
      } catch {
        // Observation never changes application behavior.
      }
    }
  };

  const emitRegistration = (
    name: string,
    invocationId: string,
    stage:
      | "registering"
      | "registered"
      | "unsupported"
      | "registration_failed"
      | "unregistered",
    startedAt: number,
    error?: unknown,
  ): void => {
    if (observers.size === 0) return;
    dispatch({
      invocationId,
      name,
      stage,
      timestamp: Date.now(),
      durationMs: Math.max(0, performance.now() - startedAt),
      ...(error === undefined ? {} : { error }),
    });
  };

  return {
    ...(telemetry === undefined ? {} : { telemetry }),
    tools: () => [...tools.values()],
    observe(observer) {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    async expose(tool) {
      validateDefinition(tool);
      if (localNames.has(tool.name)) {
        throw definitionError(
          'a tool named "' + tool.name + '" is already exposed.',
        );
      }
      const validateInput = compileInputValidator(tool.inputSchema);
      localNames.add(tool.name);
      const registrationId = crypto.randomUUID();
      const startedAt = performance.now();
      const snapshot = (
        status: SignettToolSnapshot["status"],
      ): SignettToolSnapshot => ({
        name: tool.name,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations === undefined
          ? {}
          : { annotations: tool.annotations }),
        ...(tool.exposedTo === undefined ? {} : { exposedTo: tool.exposedTo }),
        status,
      });

      const modelContext = options.modelContext ?? browserModelContext();
      if (!modelContext) {
        tools.set(tool.name, snapshot("unsupported"));
        emitRegistration(tool.name, registrationId, "unsupported", startedAt);
        if (options.unsupported === "throw") {
          localNames.delete(tool.name);
          tools.delete(tool.name);
          throw new Error("WebMCP is not available in this environment.");
        }
        if (options.unsupported === "warn") {
          console.warn(
            "Signett: WebMCP is not available; tool was not exposed.",
          );
        }
        return new Registration(tool.name, "unsupported", () => {
          localNames.delete(tool.name);
          tools.delete(tool.name);
        });
      }

      const activeNames = activeNamesFor(modelContext);
      if (activeNames.has(tool.name)) {
        localNames.delete(tool.name);
        throw definitionError(
          'a tool named "' + tool.name + '" is already exposed.',
        );
      }

      activeNames.add(tool.name);
      tools.set(tool.name, snapshot("registering"));
      const controller = new AbortController();
      emitRegistration(tool.name, registrationId, "registering", startedAt);

      const execute = (
        input: Record<string, unknown>,
        executeOptions?: {
          signal: AbortSignal;
          callerTelemetry?: SignettCallerTelemetry;
        },
      ) => {
        // Some WebMCP hosts currently invoke tools with an empty options object.
        // Keep cancellation when supplied, but do not let a host compatibility
        // detail bypass the guard before the application operation can run.
        const normalizedOptions = {
          signal: executeOptions?.signal ?? new AbortController().signal,
          ...(executeOptions?.callerTelemetry === undefined
            ? {}
            : { callerTelemetry: executeOptions.callerTelemetry }),
        };
        return runGuarded(
          input as Parameters<typeof tool.execute>[0],
          normalizedOptions,
          tool.execute,
          {
            name: tool.name,
            validate: validateInput,
            ...(options.context
              ? {
                  context: (_input, contextOptions) =>
                    options.context!({ signal: contextOptions.signal }),
                }
              : {}),
            ...(tool.authorize ? { authorize: tool.authorize } : {}),
            ...(tool.confirm ? { confirm: tool.confirm } : {}),
            ...(tool.idempotency ? { idempotency: tool.idempotency } : {}),
            ...(tool.journal ? { journal: tool.journal } : {}),
            ...(tool.recover ? { recover: tool.recover } : {}),
            ...(tool.outputBudgetBytes === undefined
              ? {}
              : { outputBudgetBytes: tool.outputBudgetBytes }),
            ...(tool.verifyTimeoutMs === undefined
              ? {}
              : { verifyTimeoutMs: tool.verifyTimeoutMs }),
            ...(tool.verify ? { verify: tool.verify } : {}),
            ...(observers.size > 0 ? { observe: dispatch } : {}),
          },
        );
      };

      try {
        await modelContext.registerTool(
          {
            name: tool.name,
            ...(tool.title === undefined ? {} : { title: tool.title }),
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...(tool.annotations === undefined
              ? {}
              : { annotations: tool.annotations }),
            execute,
          },
          {
            signal: controller.signal,
            ...(tool.exposedTo === undefined
              ? {}
              : { exposedTo: tool.exposedTo }),
          },
        );
      } catch (error) {
        localNames.delete(tool.name);
        activeNames.delete(tool.name);
        tools.delete(tool.name);
        controller.abort();
        emitRegistration(
          tool.name,
          registrationId,
          "registration_failed",
          startedAt,
          error,
        );
        throw error;
      }

      tools.set(tool.name, snapshot("registered"));
      emitRegistration(tool.name, registrationId, "registered", startedAt);

      return new Registration(tool.name, "registered", () => {
        controller.abort();
        localNames.delete(tool.name);
        activeNames.delete(tool.name);
        tools.delete(tool.name);
        emitRegistration(tool.name, registrationId, "unregistered", startedAt);
      });
    },
  };
}

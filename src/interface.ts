import { runGuarded } from "./guard.js";
import { compileInputValidator } from "./validation.js";
import type {
  AuthorizationDecision,
  ConfirmationDecision,
  GuardEvent,
  GuardObserver,
  IdempotencyStore,
  MaybePromise,
  RecoveryDecision,
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
        options: { signal: AbortSignal },
      ): MaybePromise<unknown>;
    },
    options?: {
      signal?: AbortSignal;
      exposedTo?: string[];
    },
  ): Promise<void>;
}

export interface CreateSignetOptions<Context> {
  readonly context?: (options: {
    readonly signal: AbortSignal;
  }) => MaybePromise<Context>;
  readonly observe?: GuardObserver;
  readonly unsupported?: "ignore" | "warn" | "throw";
  readonly modelContext?: ModelContextLike;
}

export interface SignetTool<
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
      readonly signal: AbortSignal;
    },
  ) => MaybePromise<Output>;
  readonly authorize?: (args: {
    readonly input: Input;
    readonly context: Context;
    readonly signal: AbortSignal;
  }) => MaybePromise<boolean | AuthorizationDecision>;
  readonly confirm?: (args: {
    readonly input: Input;
    readonly context: Context;
    readonly signal: AbortSignal;
  }) => MaybePromise<boolean | ConfirmationDecision>;
  readonly idempotency?: {
    readonly key: (args: {
      readonly input: Input;
      readonly context: Context;
      readonly signal: AbortSignal;
    }) => MaybePromise<string>;
    readonly store: IdempotencyStore;
  };
  readonly recover?: (args: {
    readonly input: Input;
    readonly context: Context;
    readonly error: unknown;
    readonly signal: AbortSignal;
  }) => MaybePromise<RecoveryDecision<Output>>;
  readonly outputBudgetBytes?: number;
  readonly verify?: (args: {
    readonly input: Input;
    readonly output: Output;
    readonly context: Context;
    readonly replayed: boolean;
    readonly recovered: boolean;
    readonly signal: AbortSignal;
  }) => MaybePromise<boolean | VerificationDecision>;
}

export interface SignetRegistration {
  readonly name: string;
  readonly status: "registered" | "unsupported" | "disposed";
  dispose(): void;
  [Symbol.dispose](): void;
}

export interface SignetInterface<Context> {
  expose<Input extends Record<string, unknown>, Output>(
    tool: SignetTool<Input, Output, Context>,
  ): Promise<SignetRegistration>;
  tools(): readonly SignetToolSnapshot[];
  observe(observer: GuardObserver): () => void;
}

export interface SignetToolSnapshot {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations?: ToolAnnotations;
  readonly exposedTo?: readonly string[];
  readonly status: "registering" | "registered" | "unsupported";
}

// WebMCP names are unique within a document, not within a Signet instance.
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
  return new TypeError("Invalid Signet tool: " + message);
}

function validateDefinition(tool: {
  name: string;
  description: string;
  inputSchema: object;
  outputBudgetBytes?: number;
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
}

class Registration implements SignetRegistration {
  #status: SignetRegistration["status"];
  readonly #disposeRegistration: () => void;

  constructor(
    readonly name: string,
    status: SignetRegistration["status"],
    disposeRegistration: () => void,
  ) {
    this.#status = status;
    this.#disposeRegistration = disposeRegistration;
  }

  get status(): SignetRegistration["status"] {
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

export function createSignet<Context = undefined>(
  options: CreateSignetOptions<Context> = {},
): SignetInterface<Context> {
  const observers = new Set<GuardObserver>();
  if (options.observe) observers.add(options.observe);
  const tools = new Map<string, SignetToolSnapshot>();
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
        status: SignetToolSnapshot["status"],
      ): SignetToolSnapshot => ({
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
            "Signet: WebMCP is not available; tool was not exposed.",
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
        executeOptions?: { signal: AbortSignal },
      ) => {
        const normalizedOptions = executeOptions ?? {
          signal: new AbortController().signal,
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
            ...(tool.recover ? { recover: tool.recover } : {}),
            ...(tool.outputBudgetBytes === undefined
              ? {}
              : { outputBudgetBytes: tool.outputBudgetBytes }),
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

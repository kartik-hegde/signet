import { runGuarded } from "./guard.js";
import { compileInputValidator } from "./validation.js";
import type {
  AuthorizationDecision,
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
  const activeNames = new Set<string>();

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
    if (!options.observe) return;
    try {
      void Promise.resolve(
        options.observe({
          invocationId,
          name,
          stage,
          timestamp: Date.now(),
          durationMs: Math.max(0, performance.now() - startedAt),
          ...(error === undefined ? {} : { error }),
        }),
      ).catch(() => undefined);
    } catch {
      // Observation never changes registration behavior.
    }
  };

  return {
    async expose(tool) {
      validateDefinition(tool);
      const validateInput = compileInputValidator(tool.inputSchema);
      const registrationId = crypto.randomUUID();
      const startedAt = performance.now();

      if (activeNames.has(tool.name)) {
        throw definitionError(
          'a tool named "' + tool.name + '" is already exposed.',
        );
      }

      const modelContext = options.modelContext ?? browserModelContext();
      if (!modelContext) {
        emitRegistration(tool.name, registrationId, "unsupported", startedAt);
        if (options.unsupported === "throw") {
          throw new Error("WebMCP is not available in this environment.");
        }
        if (options.unsupported === "warn") {
          console.warn(
            "Signet: WebMCP is not available; tool was not exposed.",
          );
        }
        return new Registration(tool.name, "unsupported", () => undefined);
      }

      activeNames.add(tool.name);
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
            ...(tool.idempotency ? { idempotency: tool.idempotency } : {}),
            ...(tool.recover ? { recover: tool.recover } : {}),
            ...(tool.verify ? { verify: tool.verify } : {}),
            ...(options.observe ? { observe: options.observe } : {}),
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
        activeNames.delete(tool.name);
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

      emitRegistration(tool.name, registrationId, "registered", startedAt);

      return new Registration(tool.name, "registered", () => {
        controller.abort();
        activeNames.delete(tool.name);
        emitRegistration(tool.name, registrationId, "unregistered", startedAt);
      });
    },
  };
}

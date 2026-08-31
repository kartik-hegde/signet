export type MaybePromise<T> = T | Promise<T>;

export interface ExecuteOptions {
  readonly signal: AbortSignal;
}

export type Execute<Input extends Record<string, unknown>, Output> = (
  input: Input,
  options: ExecuteOptions,
) => MaybePromise<Output>;

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface VerificationDecision {
  readonly verified: boolean;
  readonly reason?: string;
}

export interface IdempotencyResult<Output> {
  readonly value: Output;
  readonly replayed: boolean;
}

export interface IdempotencyStore {
  execute<Output>(
    key: string,
    operation: () => Promise<Output>,
    options: ExecuteOptions,
  ): Promise<IdempotencyResult<Output>>;
}

export type GuardStage =
  | "started"
  | "authorized"
  | "executed"
  | "replayed"
  | "verified"
  | "succeeded"
  | "failed";

export interface GuardEvent {
  readonly invocationId: string;
  readonly name?: string;
  readonly stage: GuardStage;
  readonly timestamp: number;
  readonly durationMs: number;
  readonly error?: unknown;
}

export type GuardObserver = (event: GuardEvent) => MaybePromise<void>;

export interface GuardOptions<
  Input extends Record<string, unknown>,
  Output,
  Context,
> {
  /** A stable operation name used only for local observability. */
  readonly name?: string;

  /** Resolves app-owned session or principal context. Signet never authenticates users. */
  readonly context?: (
    input: Input,
    options: ExecuteOptions,
  ) => MaybePromise<Context>;

  /** Runs before the operation. Throw or return a denial to fail closed. */
  readonly authorize?: (args: {
    readonly input: Input;
    readonly context: Context;
    readonly signal: AbortSignal;
  }) => MaybePromise<boolean | AuthorizationDecision>;

  /** Delegates atomic replay/concurrency behavior to an app-provided durable store. */
  readonly idempotency?: {
    readonly key: (args: {
      readonly input: Input;
      readonly context: Context;
      readonly signal: AbortSignal;
    }) => MaybePromise<string>;
    readonly store: IdempotencyStore;
  };

  /** Checks the observed result after execution or replay. */
  readonly verify?: (args: {
    readonly input: Input;
    readonly output: Output;
    readonly context: Context;
    readonly replayed: boolean;
    readonly signal: AbortSignal;
  }) => MaybePromise<boolean | VerificationDecision>;

  /** Receives metadata only. Observer failures never change operation behavior. */
  readonly observe?: GuardObserver;

  /** Injectable for deterministic tests. */
  readonly invocationId?: () => string;

  /** Injectable monotonic clock, expressed in milliseconds. */
  readonly now?: () => number;
}

export type MaybePromise<T> = T | Promise<T>;

export interface OperationJournalOptions {
  readonly signal: AbortSignal;
}

/** App-provided durable storage for post-effect correlation data. */
export interface OperationJournal {
  read<Entry>(
    key: string,
    options: OperationJournalOptions,
  ): MaybePromise<Entry | undefined>;
  write<Entry>(
    key: string,
    entry: Entry,
    options: OperationJournalOptions,
  ): MaybePromise<void>;
  remove(key: string, options: OperationJournalOptions): MaybePromise<void>;
}

/** Invocation-scoped access to one operation's journal entry. */
export interface OperationHandle {
  readonly key: string;
  read<Entry>(): Promise<Entry | undefined>;
  write<Entry>(entry: Entry): Promise<void>;
  remove(): Promise<void>;
}

export interface ExecuteOptions {
  readonly signal: AbortSignal;
  readonly operation?: OperationHandle;
}

export type Execute<Input extends Record<string, unknown>, Output> = (
  input: Input,
  options: ExecuteOptions,
) => MaybePromise<Output>;

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface ConfirmationDecision {
  readonly confirmed: boolean;
  readonly reason?: string;
}

export type ConfirmationHook<
  Input extends Record<string, unknown>,
  Context,
> = (args: {
  readonly input: Input;
  readonly context: Context;
  readonly signal: AbortSignal;
}) => MaybePromise<boolean | ConfirmationDecision>;

export type ConfirmationPolicy<Input extends Record<string, unknown>, Context> =
  | ConfirmationHook<Input, Context>
  | {
      /** `effect-only` skips a second prompt when durable state is replayed. */
      readonly mode: "always" | "effect-only";
      readonly request: ConfirmationHook<Input, Context>;
    };

export interface VerificationDecision {
  readonly verified: boolean;
  readonly reason?: string;
}

export type RecoveryDecision<Output> =
  | { readonly recovered: true; readonly output: Output }
  | {
      readonly recovered: false;
      /** Explicitly distinguish an ambiguous effect from an ordinary failure. */
      readonly outcome?: "not-recovered";
    }
  | {
      readonly recovered: false;
      readonly outcome: "unknown";
      readonly reason?: string;
    };

export type IdempotencyBeginResult<Output> =
  | { readonly state: "fresh" }
  | { readonly state: "in_flight" }
  | { readonly state: "completed"; readonly value: Output };

export interface IdempotencyStore {
  /**
   * Atomically claims a fresh key, waits for a live equal-key owner, or reports
   * durable work left in flight by an owner that is no longer running.
   */
  begin<Output>(
    key: string,
    options: ExecuteOptions,
  ): Promise<IdempotencyBeginResult<Output>>;

  /** Persists a completed result and releases live ownership. */
  complete<Output>(
    key: string,
    value: Output,
    options: ExecuteOptions,
  ): Promise<void>;

  /** Deletes a claim proven not to have crossed the effect boundary. */
  release(key: string, options: ExecuteOptions): Promise<void>;

  /** Releases live ownership while retaining a durable in-flight claim. */
  abandon(key: string, options: ExecuteOptions): Promise<void>;
}

export type GuardStage =
  | "registering"
  | "registered"
  | "unsupported"
  | "registration_failed"
  | "started"
  | "validated"
  | "authorized"
  | "confirmation_requested"
  | "confirmed"
  | "declined"
  | "executed"
  | "replayed"
  | "recovered"
  | "outcome_unknown"
  | "output_validated"
  | "output_oversized"
  | "output_unmeasurable"
  | "completed_after_abort"
  | "verified"
  | "succeeded"
  | "failed"
  | "unregistered";

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

  /** Validates invocation input before application context or policy is resolved. */
  readonly validate?: (input: Input) => MaybePromise<void>;

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

  /** Obtains app-owned consent always, or only when a new effect will run. */
  readonly confirm?: ConfirmationPolicy<Input, Context>;

  /**
   * Delegates atomic replay/concurrency behavior to an app-provided durable store.
   * Requires `journal`, which supplies the evidence needed to release failed claims.
   */
  readonly idempotency?: {
    readonly key: (args: {
      readonly input: Input;
      readonly context: Context;
      readonly signal: AbortSignal;
    }) => MaybePromise<string>;
    readonly store: IdempotencyStore;
  };

  /** Gives execute/recover/verify a scoped durable correlation journal. */
  readonly journal?: {
    readonly key?: (args: {
      readonly input: Input;
      readonly context: Context;
      readonly signal: AbortSignal;
    }) => MaybePromise<string>;
    readonly store: OperationJournal;
  };

  /** Reconciles an execution error against authoritative application state. */
  readonly recover?: (args: {
    readonly input: Input;
    readonly context: Context;
    readonly error: unknown;
    readonly operation?: OperationHandle;
    readonly signal: AbortSignal;
  }) => MaybePromise<RecoveryDecision<Output>>;

  /** Checks the observed result after execution, replay, or recovery. */
  readonly verify?: (args: {
    readonly input: Input;
    readonly output: Output;
    readonly context: Context;
    readonly replayed: boolean;
    readonly recovered: boolean;
    readonly operation?: OperationHandle;
    readonly signal: AbortSignal;
  }) => MaybePromise<boolean | VerificationDecision>;

  /** Bounds verification without reusing the caller's cancellation signal. */
  readonly verifyTimeoutMs?: number;

  /** Warns when serialized results exceed this byte budget. */
  readonly outputBudgetBytes?: number;

  /** Receives metadata only. Observer failures never change operation behavior. */
  readonly observe?: GuardObserver;

  /** Injectable for deterministic tests. */
  readonly invocationId?: () => string;

  /** Injectable monotonic clock, expressed in milliseconds. */
  readonly now?: () => number;
}

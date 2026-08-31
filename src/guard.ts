import { AuthorizationError, VerificationError } from "./errors.js";
import type {
  AuthorizationDecision,
  Execute,
  ExecuteOptions,
  GuardEvent,
  GuardOptions,
  GuardStage,
  MaybePromise,
  VerificationDecision,
} from "./types.js";

function defaultInvocationId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultNow(): number {
  return globalThis.performance.now();
}

function denialReason(
  decision: boolean | AuthorizationDecision,
): string | undefined {
  if (decision === false) return undefined;
  if (decision === true || decision.allowed) return undefined;
  return decision.reason;
}

function verificationFailureReason(
  decision: boolean | VerificationDecision,
): string | undefined {
  if (decision === false) return undefined;
  if (decision === true || decision.verified) return undefined;
  return decision.reason;
}

function isAuthorized(decision: boolean | AuthorizationDecision): boolean {
  return decision === true || (decision !== false && decision.allowed);
}

function isVerified(decision: boolean | VerificationDecision): boolean {
  return decision === true || (decision !== false && decision.verified);
}

type ContextualExecute<
  Input extends Record<string, unknown>,
  Output,
  Context,
> = (
  input: Input,
  options: ExecuteOptions & { readonly context: Context },
) => MaybePromise<Output>;

export async function runGuarded<
  Input extends Record<string, unknown>,
  Output,
  Context,
>(
  input: Input,
  executeOptions: ExecuteOptions,
  execute: ContextualExecute<Input, Output, Context>,
  options: GuardOptions<Input, Output, Context>,
): Promise<Output> {
  executeOptions.signal.throwIfAborted();

  const now = options.now ?? defaultNow;
  const createInvocationId = options.invocationId ?? defaultInvocationId;
  const observing = options.observe !== undefined;
  const invocationId = observing ? createInvocationId() : "";
  const startedAt = observing ? now() : 0;

  const emit = (stage: GuardStage, error?: unknown): void => {
    if (!options.observe) return;

    const event: GuardEvent = {
      invocationId,
      ...(options.name === undefined ? {} : { name: options.name }),
      stage,
      timestamp: Date.now(),
      durationMs: Math.max(0, now() - startedAt),
      ...(error === undefined ? {} : { error }),
    };

    try {
      void Promise.resolve(options.observe(event)).catch(() => undefined);
    } catch {
      // Observability is deliberately outside the operation's trust path.
    }
  };

  emit("started");

  try {
    if (options.validate) {
      await options.validate(input);
      executeOptions.signal.throwIfAborted();
      emit("validated");
    }

    const context = options.context
      ? await options.context(input, executeOptions)
      : (undefined as Context);

    executeOptions.signal.throwIfAborted();

    if (options.authorize) {
      const decision = await options.authorize({
        input,
        context,
        signal: executeOptions.signal,
      });

      executeOptions.signal.throwIfAborted();

      if (!isAuthorized(decision)) {
        throw new AuthorizationError(denialReason(decision));
      }

      emit("authorized");
    }

    let output: Output;
    let replayed = false;

    if (options.idempotency) {
      const key = await options.idempotency.key({
        input,
        context,
        signal: executeOptions.signal,
      });
      executeOptions.signal.throwIfAborted();

      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("The idempotency key must not be empty.");
      }

      const result = await options.idempotency.store.execute(
        key,
        async () => execute(input, { ...executeOptions, context }),
        executeOptions,
      );
      output = result.value;
      replayed = result.replayed;
      emit(replayed ? "replayed" : "executed");
    } else {
      output = await execute(input, { ...executeOptions, context });
      emit("executed");
    }

    executeOptions.signal.throwIfAborted();

    if (options.verify) {
      const decision = await options.verify({
        input,
        output,
        context,
        replayed,
        signal: executeOptions.signal,
      });

      executeOptions.signal.throwIfAborted();

      if (!isVerified(decision)) {
        throw new VerificationError(verificationFailureReason(decision));
      }

      emit("verified");
    }

    emit("succeeded");
    return output;
  } catch (error) {
    emit("failed", error);
    throw error;
  }
}

/**
 * Wraps a normal WebMCP-compatible execute function with app-owned controls.
 * It does not register tools, validate schemas, retry work, or send telemetry.
 */
export function guard<
  Input extends Record<string, unknown>,
  Output,
  Context = undefined,
>(
  execute: Execute<Input, Output>,
  options: GuardOptions<Input, Output, Context> = {},
): Execute<Input, Output> {
  return (input, executeOptions) =>
    runGuarded(
      input,
      executeOptions,
      (guardedInput, guardedOptions) =>
        execute(guardedInput, { signal: guardedOptions.signal }),
      options,
    );
}

import {
  AuthorizationError,
  ConfirmationError,
  OutcomeUnknownError,
  VerificationError,
} from "./errors.js";
import type {
  AuthorizationDecision,
  ConfirmationDecision,
  ConfirmationHook,
  ConfirmationPolicy,
  Execute,
  ExecuteOptions,
  GuardEvent,
  GuardOptions,
  GuardStage,
  MaybePromise,
  OperationHandle,
  OperationJournal,
  RecoveryDecision,
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

function confirmationReason(
  decision: boolean | ConfirmationDecision,
): string | undefined {
  if (decision === false || decision === true || decision.confirmed) {
    return undefined;
  }
  return decision.reason;
}

function isConfirmed(decision: boolean | ConfirmationDecision): boolean {
  return decision === true || (decision !== false && decision.confirmed);
}

function confirmationPolicy<Input extends Record<string, unknown>, Context>(
  policy: ConfirmationPolicy<Input, Context> | undefined,
): {
  mode: "always" | "effect-only";
  request?: ConfirmationHook<Input, Context>;
} {
  if (!policy) return { mode: "always" };
  if (typeof policy === "function") {
    return { mode: "always", request: policy };
  }
  return { mode: policy.mode, request: policy.request };
}

function createOperationHandle(
  key: string,
  store: OperationJournal,
): OperationHandle {
  // Correlation writes often happen after an irreversible effect. They are
  // finalization work and must not inherit a caller cancellation that lost the race.
  const options = { signal: new AbortController().signal };
  return {
    key,
    read: async <Entry>() => await store.read<Entry>(key, options),
    write: async <Entry>(entry: Entry) =>
      await store.write(key, entry, options),
    remove: async () => await store.remove(key, options),
  };
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
      ...(stage === "started" && executeOptions.callerTelemetry !== undefined
        ? { callerTelemetry: executeOptions.callerTelemetry }
        : {}),
    };

    try {
      void Promise.resolve(options.observe(event)).catch(() => undefined);
    } catch {
      // Observability is deliberately outside the operation's trust path.
    }
  };

  let completedAfterAbort = false;
  const observeLateAbort = (): void => {
    if (executeOptions.signal.aborted && !completedAfterAbort) {
      completedAfterAbort = true;
      emit("completed_after_abort");
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

    const confirmation = confirmationPolicy(options.confirm);
    const confirm = async (): Promise<void> => {
      if (!confirmation.request) return;
      emit("confirmation_requested");
      const decision = await confirmation.request({
        input,
        context,
        signal: executeOptions.signal,
      });

      executeOptions.signal.throwIfAborted();
      if (!isConfirmed(decision)) {
        emit("declined");
        throw new ConfirmationError(confirmationReason(decision));
      }
      emit("confirmed");
    };

    if (confirmation.mode === "always") {
      await confirm();
    }

    let output: Output;
    let replayed = false;
    let recovered = false;
    let idempotencyKey: string | undefined;

    if (options.idempotency) {
      idempotencyKey = await options.idempotency.key({
        input,
        context,
        signal: executeOptions.signal,
      });
      executeOptions.signal.throwIfAborted();

      if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
        throw new TypeError("The idempotency key must not be empty.");
      }
    }

    let operation: OperationHandle | undefined;
    if (options.journal) {
      const journalKey = options.journal.key
        ? await options.journal.key({
            input,
            context,
            signal: executeOptions.signal,
          })
        : idempotencyKey;
      executeOptions.signal.throwIfAborted();
      if (typeof journalKey !== "string" || journalKey.length === 0) {
        throw new TypeError(
          "The operation journal needs a non-empty key or an idempotency key.",
        );
      }
      operation = createOperationHandle(journalKey, options.journal.store);
    }

    const recoverFrom = async (
      error: unknown,
    ): Promise<RecoveryDecision<Output>> => {
      executeOptions.signal.throwIfAborted();
      if (!options.recover) return { recovered: false };

      let decision: RecoveryDecision<Output>;
      try {
        decision = await options.recover({
          input,
          context,
          error,
          ...(operation === undefined ? {} : { operation }),
          signal: executeOptions.signal,
        });
      } catch (recoveryError) {
        if (executeOptions.signal.aborted) {
          throw executeOptions.signal.reason;
        }
        throw new OutcomeUnknownError(
          "Authoritative recovery failed after the operation returned an error.",
          { cause: new AggregateError([error, recoveryError]) },
        );
      }
      executeOptions.signal.throwIfAborted();

      if (decision.recovered && !recovered) {
        recovered = true;
        emit("recovered");
      }
      return decision;
    };

    const executeOperation = async (): Promise<Output> => {
      try {
        executeOptions.signal.throwIfAborted();
        return await execute(input, {
          context,
          ...(operation === undefined ? {} : { operation }),
          signal: executeOptions.signal,
        });
      } catch (error) {
        const decision = await recoverFrom(error);
        if (decision.recovered) return decision.output;
        if (decision.outcome === "unknown") {
          throw new OutcomeUnknownError(decision.reason, { cause: error });
        }
        throw error;
      }
    };

    if (options.idempotency) {
      const key = idempotencyKey!;
      const store = options.idempotency.store;
      const settlementOptions = {
        signal: new AbortController().signal,
      };
      const begun = await store.begin<Output>(key, executeOptions);

      if (begun.state === "completed") {
        output = begun.value;
        replayed = true;
        emit("replayed");
        if (operation) {
          try {
            await operation.remove();
          } catch {
            // The completed result is authoritative; stale correlation is safe.
          }
        }
      } else {
        let settled = false;
        const complete = async (value: Output): Promise<void> => {
          try {
            await store.complete(key, value, settlementOptions);
          } catch (error) {
            throw new OutcomeUnknownError(
              "The effect completed, but its idempotency result could not be persisted.",
              { cause: error },
            );
          }
          settled = true;
          if (operation) {
            try {
              await operation.remove();
            } catch {
              // The durable result is authoritative; stale correlation data is safe.
            }
          }
        };

        try {
          if (begun.state === "in_flight") {
            const interrupted = new Error(
              "A previous attempt left this operation in flight.",
            );
            interrupted.name = "InterruptedOperationError";
            const decision = await recoverFrom(interrupted);
            if (!decision.recovered) {
              throw new OutcomeUnknownError(
                decision.outcome === "unknown"
                  ? decision.reason
                  : "A previous attempt may have produced an effect, but recovery could not prove its outcome.",
                { cause: interrupted },
              );
            }
            output = decision.output;
            await complete(output);
          } else {
            try {
              if (confirmation.mode === "effect-only") await confirm();
              executeOptions.signal.throwIfAborted();
            } catch (error) {
              await store.release(key, settlementOptions);
              settled = true;
              throw error;
            }

            try {
              output = await execute(input, {
                context,
                ...(operation === undefined ? {} : { operation }),
                signal: executeOptions.signal,
              });
            } catch (error) {
              const decision = await recoverFrom(error);
              if (decision.recovered) {
                output = decision.output;
              } else if (decision.outcome === "unknown") {
                throw new OutcomeUnknownError(decision.reason, {
                  cause: error,
                });
              } else {
                if (operation) {
                  let entry: unknown;
                  try {
                    entry = await operation.read();
                  } catch (journalError) {
                    throw new OutcomeUnknownError(
                      "The operation failed, and its journal could not prove whether the effect started.",
                      { cause: new AggregateError([error, journalError]) },
                    );
                  }
                  if (entry === undefined) {
                    await store.release(key, settlementOptions);
                    settled = true;
                    throw error;
                  }
                }
                throw new OutcomeUnknownError(
                  "The effect may have started, but recovery could not prove its outcome.",
                  { cause: error },
                );
              }
            }

            await complete(output);
            if (!recovered) emit("executed");
          }
        } finally {
          if (!settled) {
            try {
              await store.abandon(key, settlementOptions);
            } catch {
              // Preserve the operation error; the durable in-flight row remains safe.
            }
          }
        }
      }
    } else {
      if (confirmation.mode === "effect-only") await confirm();
      output = await executeOperation();
      if (!recovered) emit("executed");
    }

    observeLateAbort();

    if (options.outputBudgetBytes !== undefined) {
      let actualBytes: number | undefined;
      try {
        const serialized = JSON.stringify(output);
        actualBytes =
          serialized === undefined
            ? 0
            : new TextEncoder().encode(serialized).byteLength;
      } catch {
        emit("output_unmeasurable");
        warnOutput(
          options.name,
          "could not be measured because it is not JSON-serializable",
        );
      }
      if (actualBytes !== undefined) {
        if (actualBytes > options.outputBudgetBytes) {
          emit("output_oversized");
          warnOutput(
            options.name,
            `is ${actualBytes} bytes; the configured budget is ${options.outputBudgetBytes}. Return a smaller, task-focused result`,
          );
        } else {
          emit("output_validated");
        }
      }
    }

    if (options.verify) {
      // Once the application reports completion, cancellation has lost the race.
      // Verification finalizes the observed outcome and must not be cancelled into
      // an ordinary failure after the effect already exists.
      const finalizationSignal =
        options.verifyTimeoutMs === undefined
          ? new AbortController().signal
          : AbortSignal.timeout(options.verifyTimeoutMs);
      const verification = Promise.resolve(
        options.verify({
          input,
          output,
          context,
          replayed,
          recovered,
          ...(operation === undefined ? {} : { operation }),
          signal: finalizationSignal,
        }),
      );
      let decision: boolean | VerificationDecision;
      try {
        decision =
          options.verifyTimeoutMs === undefined
            ? await verification
            : await waitFor(verification, finalizationSignal);
      } catch (error) {
        if (finalizationSignal.aborted) {
          throw new VerificationError("Verification timed out.");
        }
        throw error;
      }

      if (!isVerified(decision)) {
        throw new VerificationError(verificationFailureReason(decision));
      }

      emit("verified");
    }

    observeLateAbort();

    emit("succeeded");
    return output;
  } catch (error) {
    emit(
      error instanceof OutcomeUnknownError ? "outcome_unknown" : "failed",
      error,
    );
    throw error;
  }
}

async function waitFor<Value>(
  value: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  signal.throwIfAborted();
  let notifyAbort = (): void => undefined;
  const aborted = new Promise<void>((resolve) => {
    notifyAbort = resolve;
  });
  signal.addEventListener("abort", notifyAbort, { once: true });
  try {
    return await Promise.race([
      value,
      aborted.then((): Value => {
        signal.throwIfAborted();
        throw new Error("Verification deadline elapsed without aborting.");
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", notifyAbort);
  }
}

function warnOutput(name: string | undefined, message: string): void {
  try {
    console.warn(`Signet${name ? ` (${name})` : ""}: tool output ${message}.`);
  } catch {
    // Diagnostics cannot change an already completed operation.
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
  if (options.idempotency && !options.journal) {
    throw new TypeError(
      "Signet idempotency requires an operation journal so failures can be classified safely.",
    );
  }
  return (input, executeOptions) =>
    runGuarded(
      input,
      executeOptions,
      (guardedInput, guardedOptions) =>
        execute(guardedInput, {
          ...(guardedOptions.operation === undefined
            ? {}
            : { operation: guardedOptions.operation }),
          signal: guardedOptions.signal,
        }),
      options,
    );
}

import type {
  ExecuteOptions,
  IdempotencyResult,
  IdempotencyStore,
} from "./types.js";

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

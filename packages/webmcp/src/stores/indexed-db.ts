import type {
  ExecuteOptions,
  IdempotencyBeginResult,
  IdempotencyStore,
} from "../types.js";

type StoredResult<Output> =
  | { readonly hasValue: false }
  | { readonly hasValue: true; readonly value: Output };

type StoredOperation =
  | { readonly key: string; readonly state: "in_flight" }
  | {
      readonly key: string;
      readonly state: "completed";
      readonly result: StoredResult<unknown>;
    };

type LockOptions = { readonly signal: AbortSignal };

export interface WebLockManagerLike {
  request<Value>(
    name: string,
    options: LockOptions,
    callback: () => Promise<Value>,
  ): Promise<Value>;
}

export interface IndexedDbIdempotencyStoreOptions {
  readonly databaseName?: string;
  /** Injectable browser primitives for deterministic tests. */
  readonly indexedDB?: IDBFactory | null;
  readonly locks?: WebLockManagerLike | null;
}

type Claim = { settle(): void };

/**
 * Browser-profile durable idempotency with live-owner coordination across tabs.
 * Web Locks are required so a durable in-flight row is never confused with work
 * that is still running in another page.
 */
export class IndexedDbIdempotencyStore implements IdempotencyStore {
  readonly #databaseName: string;
  readonly #storeName = "operations";
  readonly #indexedDB: IDBFactory | undefined;
  readonly #locks: WebLockManagerLike | undefined;
  readonly #claims = new Map<string, Claim>();

  constructor(options: IndexedDbIdempotencyStoreOptions = {}) {
    this.#databaseName = options.databaseName ?? "signett-idempotency";
    this.#indexedDB =
      options.indexedDB === undefined
        ? globalThis.indexedDB
        : (options.indexedDB ?? undefined);
    this.#locks =
      options.locks === undefined
        ? typeof navigator === "undefined"
          ? undefined
          : navigator.locks
        : (options.locks ?? undefined);
  }

  async begin<Output>(
    key: string,
    options: ExecuteOptions,
  ): Promise<IdempotencyBeginResult<Output>> {
    options.signal.throwIfAborted();
    const locks = this.#locks;
    if (!locks) {
      throw new Error(
        "IndexedDbIdempotencyStore requires the Web Locks API to distinguish live and abandoned operations.",
      );
    }

    return await new Promise<IdempotencyBeginResult<Output>>(
      (resolve, reject) => {
        let resolved = false;
        void locks
          .request(
            `signett:idempotency:${key}`,
            { signal: options.signal },
            async () => {
              const stored = await this.#read(key);
              if (stored?.state === "completed") {
                resolved = true;
                resolve({
                  state: "completed",
                  value: resultValue(stored.result),
                });
                return;
              }

              const state = stored ? "in_flight" : "fresh";
              if (!stored) await this.#write({ key, state: "in_flight" });

              let settle: (() => void) | undefined;
              const settled = new Promise<void>((done) => {
                settle = done;
              });
              this.#claims.set(key, { settle: () => settle?.() });
              resolved = true;
              resolve({ state });
              await settled;
            },
          )
          .catch((error: unknown) => {
            if (!resolved) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
      },
    );
  }

  async complete<Output>(
    key: string,
    value: Output,
    options: ExecuteOptions,
  ): Promise<void> {
    options.signal.throwIfAborted();
    this.#requireClaim(key);
    await this.#write({
      key,
      state: "completed",
      result: storedResult(value),
    });
    this.#settle(key);
  }

  async release(key: string, options: ExecuteOptions): Promise<void> {
    options.signal.throwIfAborted();
    this.#requireClaim(key);
    await this.#remove(key);
    this.#settle(key);
  }

  abandon(key: string, options: ExecuteOptions): Promise<void> {
    options.signal.throwIfAborted();
    this.#requireClaim(key);
    this.#settle(key);
    return Promise.resolve();
  }

  #requireClaim(key: string): Claim {
    const claim = this.#claims.get(key);
    if (!claim)
      throw new Error(`No live idempotency claim exists for "${key}".`);
    return claim;
  }

  #settle(key: string): void {
    const claim = this.#requireClaim(key);
    this.#claims.delete(key);
    claim.settle();
  }

  async #open(): Promise<IDBDatabase> {
    const factory = this.#indexedDB;
    if (!factory) {
      throw new Error("IndexedDbIdempotencyStore requires IndexedDB.");
    }
    return await new Promise((resolve, reject) => {
      const request = factory.open(this.#databaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(this.#storeName, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ?? new Error("Unable to open idempotency storage."),
        );
    });
  }

  async #read(key: string): Promise<StoredOperation | undefined> {
    const database = await this.#open();
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction(this.#storeName, "readonly")
          .objectStore(this.#storeName)
          .get(key);
        request.onsuccess = () =>
          resolve(request.result as StoredOperation | undefined);
        request.onerror = () =>
          reject(
            request.error ?? new Error("Unable to read idempotency state."),
          );
      });
    } finally {
      database.close();
    }
  }

  async #write(operation: StoredOperation): Promise<void> {
    const database = await this.#open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(this.#storeName, "readwrite");
        transaction.objectStore(this.#storeName).put(operation);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(
            transaction.error ?? new Error("Unable to save idempotency state."),
          );
        transaction.onabort = () =>
          reject(
            transaction.error ??
              new Error("Saving idempotency state was aborted."),
          );
      });
    } finally {
      database.close();
    }
  }

  async #remove(key: string): Promise<void> {
    const database = await this.#open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(this.#storeName, "readwrite");
        transaction.objectStore(this.#storeName).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(
            transaction.error ??
              new Error("Unable to release idempotency state."),
          );
        transaction.onabort = () =>
          reject(
            transaction.error ??
              new Error("Releasing idempotency state was aborted."),
          );
      });
    } finally {
      database.close();
    }
  }
}

function storedResult<Output>(value: Output): StoredResult<Output> {
  return value === undefined ? { hasValue: false } : { hasValue: true, value };
}

function resultValue<Output>(stored: StoredResult<unknown>): Output {
  return (stored.hasValue ? stored.value : undefined) as Output;
}

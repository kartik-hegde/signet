/**
 * Idempotency stores under test.
 *
 * The distinction between them is the point of the v0 result. A store that
 * discards a failed attempt is correct for a failure before the effect, and
 * wrong for a lost response after it. The store cannot tell those apart from the
 * error alone, so the conservative store refuses to re-execute and surfaces the
 * uncertainty instead.
 */

export class IndeterminateError extends Error {
  constructor(key) {
    super(`a previous attempt for ${key} did not report an outcome`);
    this.name = "IndeterminateError";
    this.code = "indeterminate";
  }
}

/** Mirrors the shipped MemoryIdempotencyStore: failed work is removed so a later call retries. */
export class OptimisticMemoryStore {
  #operations = new Map();
  async execute(key, operation, _options) {
    const existing = this.#operations.get(key);
    if (existing) return { value: await existing, replayed: true };
    const pending = Promise.resolve().then(operation);
    this.#operations.set(key, pending);
    pending.catch(() => this.#operations.delete(key));
    return { value: await pending, replayed: false };
  }
}

/** Durable, conservative. Records the attempt before the effect and never silently retries it. */
export class SqliteConservativeStore {
  constructor(db) { this.db = db; }

  async execute(key, operation, options) {
    options.signal.throwIfAborted();
    const row = this.db.prepare("SELECT state, result FROM idempotency WHERE key = ?").get(key);

    if (row?.state === "completed") {
      return { value: JSON.parse(row.result), replayed: true };
    }
    if (row?.state === "in_progress") {
      throw new IndeterminateError(key);
    }

    this.db
      .prepare("INSERT INTO idempotency (key, state, result, created_at) VALUES (?, 'in_progress', NULL, ?)")
      .run(key, Date.now());

    const value = await operation();

    this.db
      .prepare("UPDATE idempotency SET state = 'completed', result = ? WHERE key = ?")
      .run(JSON.stringify(value), key);

    return { value, replayed: false };
  }
}

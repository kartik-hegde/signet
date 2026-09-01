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

const liveClaims = new WeakMap();

function claimsFor(db) {
  let claims = liveClaims.get(db);
  if (!claims) {
    claims = new Map();
    liveClaims.set(db, claims);
  }
  return claims;
}

const deferred = () => {
  let resolve;
  const settled = new Promise((done) => { resolve = done; });
  return { settled, resolve };
};

async function waitFor(promise, signal) {
  signal.throwIfAborted();
  return await Promise.race([
    promise,
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  ]);
}

/** Server-side phased store used by the guarded durable benchmark arm. */
export class SqlitePhasedStore {
  #owned = new Set();
  constructor(db) { this.db = db; }

  async begin(key, options) {
    options.signal.throwIfAborted();
    const claims = claimsFor(this.db);
    const live = claims.get(key);
    if (live) {
      await waitFor(live.settled, options.signal);
      return await this.begin(key, options);
    }

    const row = this.db.prepare("SELECT state, result FROM idempotency WHERE key = ?").get(key);
    if (row?.state === "completed") {
      return { state: "completed", value: JSON.parse(row.result) };
    }
    if (!row) {
      this.db
        .prepare("INSERT INTO idempotency (key, state, result, created_at) VALUES (?, 'in_flight', NULL, ?)")
        .run(key, Date.now());
    }
    claims.set(key, deferred());
    this.#owned.add(key);
    return { state: row ? "in_flight" : "fresh" };
  }

  async complete(key, value, options) {
    options.signal.throwIfAborted();
    this.#require(key);
    this.db
      .prepare("UPDATE idempotency SET state = 'completed', result = ? WHERE key = ?")
      .run(JSON.stringify(value), key);
    this.#settle(key);
  }

  async release(key, options) {
    options.signal.throwIfAborted();
    this.#require(key);
    this.db.prepare("DELETE FROM idempotency WHERE key = ?").run(key);
    this.#settle(key);
  }

  async abandon(key, options) {
    options.signal.throwIfAborted();
    this.#require(key);
    this.#settle(key);
  }

  #require(key) {
    if (!this.#owned.has(key)) throw new Error(`no live claim for ${key}`);
  }

  #settle(key) {
    this.#owned.delete(key);
    const claims = claimsFor(this.db);
    const claim = claims.get(key);
    claims.delete(key);
    claim?.resolve();
  }
}

export class SqliteOperationJournal {
  constructor(db) { this.db = db; }
  read(key, options) {
    options.signal.throwIfAborted();
    const row = this.db.prepare("SELECT entry FROM operation_journal WHERE key = ?").get(key);
    return row ? JSON.parse(row.entry) : undefined;
  }
  write(key, entry, options) {
    options.signal.throwIfAborted();
    this.db
      .prepare("INSERT OR REPLACE INTO operation_journal (key, entry) VALUES (?, ?)")
      .run(key, JSON.stringify(entry));
  }
  remove(key, options) {
    options.signal.throwIfAborted();
    this.db.prepare("DELETE FROM operation_journal WHERE key = ?").run(key);
  }
}

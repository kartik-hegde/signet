import type {
  ExecuteOptions,
  IdempotencyBeginResult,
  IdempotencyStore,
} from "signett";

interface PostgresClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
  release(error?: Error): void;
}

interface PostgresPool {
  connect(): Promise<PostgresClient>;
}

type StoredResult<Output> =
  | { readonly hasValue: false }
  | { readonly hasValue: true; readonly value: Output };

type OperationRow<Output> = {
  state: "in_flight" | "completed";
  value: StoredResult<Output> | null;
};

/**
 * Cross-process phased idempotency using session-level PostgreSQL advisory locks.
 *
 * Create the table first:
 *
 *   create table signett_operations (
 *     key text primary key,
 *     state text not null check (state in ('in_flight', 'completed')),
 *     value jsonb,
 *     updated_at timestamptz not null default now()
 *   );
 *
 * A connection is intentionally held from begin through complete, release, or
 * abandon. If the process dies, PostgreSQL releases its advisory lock while the
 * durable in-flight row remains available for authoritative recovery.
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  readonly #claims = new Map<string, PostgresClient>();

  constructor(private readonly pool: PostgresPool) {}

  async begin<Output>(
    key: string,
    options: ExecuteOptions,
  ): Promise<IdempotencyBeginResult<Output>> {
    options.signal.throwIfAborted();
    const client = await this.pool.connect();
    let claimed = false;
    try {
      await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [
        key,
      ]);
      claimed = true;
      options.signal.throwIfAborted();

      const stored = await client.query<OperationRow<Output>>(
        "select state, value from signett_operations where key = $1",
        [key],
      );
      const existing = stored.rows[0];
      if (existing?.state === "completed") {
        await this.#unlock(client, key);
        return {
          state: "completed",
          value: resultValue(existing.value),
        };
      }

      if (!existing) {
        await client.query(
          "insert into signett_operations (key, state, value) values ($1, 'in_flight', null)",
          [key],
        );
      }
      this.#claims.set(key, client);
      return { state: existing ? "in_flight" : "fresh" };
    } catch (error) {
      if (claimed) await this.#unlockAfterError(client, key);
      else client.release(asError(error));
      throw error;
    }
  }

  async complete<Output>(
    key: string,
    value: Output,
    options: ExecuteOptions,
  ): Promise<void> {
    options.signal.throwIfAborted();
    const client = this.#claim(key);
    await client.query(
      "update signett_operations set state = 'completed', value = $2::jsonb, updated_at = now() where key = $1",
      [key, JSON.stringify(storedResult(value))],
    );
    await this.#settle(key, client);
  }

  async release(key: string, options: ExecuteOptions): Promise<void> {
    options.signal.throwIfAborted();
    const client = this.#claim(key);
    await client.query("delete from signett_operations where key = $1", [key]);
    await this.#settle(key, client);
  }

  async abandon(key: string, options: ExecuteOptions): Promise<void> {
    options.signal.throwIfAborted();
    const client = this.#claim(key);
    await this.#settle(key, client);
  }

  #claim(key: string): PostgresClient {
    const client = this.#claims.get(key);
    if (!client)
      throw new Error(`No live idempotency claim exists for "${key}".`);
    return client;
  }

  async #settle(key: string, client: PostgresClient): Promise<void> {
    this.#claims.delete(key);
    await this.#unlock(client, key);
  }

  async #unlock(client: PostgresClient, key: string): Promise<void> {
    try {
      await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [
        key,
      ]);
      client.release();
    } catch (error) {
      client.release(asError(error));
      throw error;
    }
  }

  async #unlockAfterError(client: PostgresClient, key: string): Promise<void> {
    try {
      await this.#unlock(client, key);
    } catch {
      // Preserve the operation or database error that required cleanup.
    }
  }
}

function storedResult<Output>(value: Output): StoredResult<Output> {
  return value === undefined ? { hasValue: false } : { hasValue: true, value };
}

function resultValue<Output>(stored: StoredResult<Output> | null): Output {
  return (stored?.hasValue ? stored.value : undefined) as Output;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

import type { IdempotencyStore } from "@signet/webmcp";

interface PostgresClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
  release(): void;
}

interface PostgresPool {
  connect(): Promise<PostgresClient>;
}

type StoredResult<Output> =
  | { readonly hasValue: false }
  | { readonly hasValue: true; readonly value: Output };

function storedResult<Output>(value: Output): StoredResult<Output> {
  return value === undefined ? { hasValue: false } : { hasValue: true, value };
}

function resultValue<Output>(stored: StoredResult<Output>): Output {
  return (stored.hasValue ? stored.value : undefined) as Output;
}

/**
 * A compact cross-process store using a transaction-scoped PostgreSQL advisory lock.
 * Create `signet_operations(key text primary key, value jsonb not null)` first.
 * Values use a small envelope so a void handler remains void when replayed.
 * For long-running work, replace the held transaction with a leased-claim design.
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: PostgresPool) {}

  async execute<Output>(
    key: string,
    operation: () => Promise<Output>,
    options: { signal: AbortSignal },
  ): Promise<{ value: Output; replayed: boolean }> {
    options.signal.throwIfAborted();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [key],
      );
      options.signal.throwIfAborted();
      const stored = await client.query<{ value: StoredResult<Output> }>(
        "select value from signet_operations where key = $1",
        [key],
      );
      const existing = stored.rows[0];
      if (existing) {
        await client.query("commit");
        return { value: resultValue(existing.value), replayed: true };
      }

      const value = await operation();
      await client.query(
        "insert into signet_operations (key, value) values ($1, $2::jsonb)",
        [key, JSON.stringify(storedResult(value))],
      );
      await client.query("commit");
      return { value, replayed: false };
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the operation or database error that caused the rollback.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

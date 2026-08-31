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

/**
 * A compact cross-process store using a transaction-scoped PostgreSQL advisory lock.
 * Create `signet_operations(key text primary key, value jsonb not null)` first.
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
      const stored = await client.query<{ value: Output }>(
        "select value from signet_operations where key = $1",
        [key],
      );
      const existing = stored.rows[0];
      if (existing) {
        await client.query("commit");
        return { value: existing.value, replayed: true };
      }

      const value = await operation();
      await client.query(
        "insert into signet_operations (key, value) values ($1, $2::jsonb)",
        [key, JSON.stringify(value)],
      );
      await client.query("commit");
      return { value, replayed: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

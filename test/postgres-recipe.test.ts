import { describe, expect, it } from "vitest";

import { PostgresIdempotencyStore } from "../recipes/postgres-idempotency.js";

interface StoredRow {
  value: unknown;
}

function poolWithMemoryRow() {
  let row: StoredRow | undefined;
  const client = {
    async query<Result extends Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<{ rows: Result[] }> {
      if (sql.startsWith("select value")) {
        return { rows: (row ? [row] : []) as unknown as Result[] };
      }
      if (sql.startsWith("insert into")) {
        row = { value: JSON.parse(values?.[1] as string) as unknown };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { connect: async () => client };
}

describe("PostgresIdempotencyStore recipe", () => {
  it("stores and replays a void result without SQL null", async () => {
    const store = new PostgresIdempotencyStore(poolWithMemoryRow());
    const options = { signal: new AbortController().signal };
    let effects = 0;
    const operation = async (): Promise<void> => {
      effects += 1;
    };

    await expect(store.execute("void", operation, options)).resolves.toEqual({
      value: undefined,
      replayed: false,
    });
    await expect(store.execute("void", operation, options)).resolves.toEqual({
      value: undefined,
      replayed: true,
    });
    expect(effects).toBe(1);
  });

  it("preserves the original error when rollback also fails", async () => {
    const original = new Error("insert failed");
    const client = {
      async query<Result extends Record<string, unknown>>(
        sql: string,
      ): Promise<{ rows: Result[] }> {
        if (sql.startsWith("select value")) return { rows: [] };
        if (sql.startsWith("insert into")) throw original;
        if (sql === "rollback") throw new Error("rollback failed");
        return { rows: [] };
      },
      release() {},
    };
    const store = new PostgresIdempotencyStore({
      connect: async () => client,
    });

    await expect(
      store.execute("failure", async () => "done", {
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(original);
  });
});

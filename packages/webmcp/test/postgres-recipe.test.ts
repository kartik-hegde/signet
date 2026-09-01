import { describe, expect, it } from "vitest";

import { PostgresIdempotencyStore } from "../recipes/postgres-idempotency.js";

interface StoredRow {
  state: "in_flight" | "completed";
  value: unknown;
}

function poolWithMemoryRow() {
  let row: StoredRow | undefined;
  const client = {
    async query<Result extends Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<{ rows: Result[] }> {
      if (sql.startsWith("select state")) {
        return { rows: (row ? [row] : []) as unknown as Result[] };
      }
      if (sql.startsWith("insert into")) {
        row = { state: "in_flight", value: null };
      }
      if (sql.startsWith("update signet_operations")) {
        row = {
          state: "completed",
          value: JSON.parse(values?.[1] as string) as unknown,
        };
      }
      if (sql.startsWith("delete from")) {
        row = undefined;
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
    await expect(store.begin("void", options)).resolves.toEqual({
      state: "fresh",
    });
    await store.complete("void", undefined, options);
    await expect(store.begin("void", options)).resolves.toEqual({
      state: "completed",
      value: undefined,
    });
  });

  it("distinguishes abandon from release", async () => {
    const store = new PostgresIdempotencyStore(poolWithMemoryRow());
    const options = { signal: new AbortController().signal };

    await store.begin("operation", options);
    await store.abandon("operation", options);
    await expect(store.begin("operation", options)).resolves.toEqual({
      state: "in_flight",
    });
    await store.release("operation", options);
    await expect(store.begin("operation", options)).resolves.toEqual({
      state: "fresh",
    });
  });

  it("preserves the original error when unlock also fails", async () => {
    const original = new Error("insert failed");
    const client = {
      async query<Result extends Record<string, unknown>>(
        sql: string,
      ): Promise<{ rows: Result[] }> {
        if (sql.startsWith("select state")) return { rows: [] };
        if (sql.startsWith("insert into")) throw original;
        if (sql.startsWith("select pg_advisory_unlock")) {
          throw new Error("unlock failed");
        }
        return { rows: [] };
      },
      release() {},
    };
    const store = new PostgresIdempotencyStore({
      connect: async () => client,
    });

    await expect(
      store.begin("failure", { signal: new AbortController().signal }),
    ).rejects.toBe(original);
  });
});

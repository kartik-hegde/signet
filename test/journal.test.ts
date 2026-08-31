import { describe, expect, it } from "vitest";

import { WebStorageOperationJournal } from "../src/index.js";
import { MemoryOperationJournal } from "../src/testing.js";

const active = () => ({ signal: new AbortController().signal });

describe("operation journals", () => {
  it("reads, writes, and removes typed memory entries", () => {
    const journal = new MemoryOperationJournal();
    journal.write("order-1", { orderId: "created-1" }, active());

    expect(journal.read<{ orderId: string }>("order-1", active())).toEqual({
      orderId: "created-1",
    });

    journal.remove("order-1", active());
    expect(journal.read("order-1", active())).toBeUndefined();
  });

  it("stores JSON in a Web Storage-compatible application adapter", () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    };
    const journal = new WebStorageOperationJournal(storage, "demo:");

    journal.write("checkout-1", { orderId: "order-1" }, active());

    expect(entries.get("demo:checkout-1")).toBe('{"orderId":"order-1"}');
    expect(journal.read("checkout-1", active())).toEqual({
      orderId: "order-1",
    });
  });

  it("honors cancellation before touching storage", () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const journal = new WebStorageOperationJournal(storage);

    expect(() =>
      journal.write("operation", {}, { signal: controller.signal }),
    ).toThrow("cancelled");
  });
});

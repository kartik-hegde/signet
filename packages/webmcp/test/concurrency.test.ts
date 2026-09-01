import { describe, expect, it, vi } from "vitest";

import { guard } from "../src/index.js";
import {
  MemoryIdempotencyStore,
  MemoryOperationJournal,
} from "../src/testing.js";

const active = (): { signal: AbortSignal } => ({
  signal: new AbortController().signal,
});

describe("concurrency", () => {
  it("allows different idempotency keys to execute in parallel", async () => {
    const store = new MemoryIdempotencyStore();
    const started: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = vi.fn(async ({ id }: { id: string }) => {
      started.push(id);
      await gate;
      return id;
    });
    const execute = guard(operation, {
      idempotency: {
        key: ({ input }) => input.id,
        store,
      },
      journal: { store: new MemoryOperationJournal() },
    });

    const first = execute({ id: "A" }, active());
    const second = execute({ id: "B" }, active());

    await vi.waitFor(() => expect([...started].sort()).toEqual(["A", "B"]));
    expect(operation).toHaveBeenCalledTimes(2);

    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual(["A", "B"]);
  });

  it("does not wait for an asynchronous observer", async () => {
    let finishObserver: (() => void) | undefined;
    const pendingObserver = new Promise<void>((resolve) => {
      finishObserver = resolve;
    });
    const execute = guard(async () => "complete", {
      observe: () => pendingObserver,
    });

    await expect(execute({}, active())).resolves.toBe("complete");
    finishObserver?.();
  });
});

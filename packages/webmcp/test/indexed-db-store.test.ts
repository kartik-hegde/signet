import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  IndexedDbIdempotencyStore,
  type WebLockManagerLike,
} from "../src/stores.js";
import { checkIdempotencyStore } from "../src/testing.js";

const active = (): { signal: AbortSignal } => ({
  signal: new AbortController().signal,
});

class TestLockManager implements WebLockManagerLike {
  readonly #tails = new Map<string, Promise<void>>();

  async request<Value>(
    name: string,
    options: { readonly signal: AbortSignal },
    callback: () => Promise<Value>,
  ): Promise<Value> {
    options.signal.throwIfAborted();
    const previous = this.#tails.get(name) ?? Promise.resolve();
    let unlock: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const tail = previous.then(() => locked);
    this.#tails.set(name, tail);

    await waitFor(previous, options.signal);
    options.signal.throwIfAborted();
    try {
      return await callback();
    } finally {
      unlock?.();
      if (this.#tails.get(name) === tail) this.#tails.delete(name);
    }
  }
}

async function waitFor(
  value: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let onAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error(String(signal.reason)),
      );
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([value, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function stores() {
  const indexedDB = new IDBFactory();
  const locks = new TestLockManager();
  const databaseName = `signett-test-${crypto.randomUUID()}`;
  const create = () =>
    new IndexedDbIdempotencyStore({ indexedDB, locks, databaseName });
  return { create };
}

describe("IndexedDbIdempotencyStore", () => {
  it("uses the browser's IndexedDB and Web Locks by default", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("navigator", { locks: new TestLockManager() });
    try {
      const store = new IndexedDbIdempotencyStore({
        databaseName: `signett-defaults-${crypto.randomUUID()}`,
      });

      await expect(store.begin("default", active())).resolves.toEqual({
        state: "fresh",
      });
      await store.release("default", active());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes the phased store conformance suite", async () => {
    const { create } = stores();

    await expect(checkIdempotencyStore(create)).resolves.toBeDefined();
  });

  it("preserves void as a completed value", async () => {
    const { create } = stores();
    const store = create();

    await expect(store.begin("void", active())).resolves.toEqual({
      state: "fresh",
    });
    await store.complete("void", undefined, active());
    await expect(create().begin("void", active())).resolves.toEqual({
      state: "completed",
      value: undefined,
    });
  });

  it("coordinates live owners across store instances", async () => {
    const { create } = stores();
    const owner = create();
    const duplicate = create();

    await owner.begin("shared", active());
    let duplicateResolved = false;
    const waiting = duplicate
      .begin<string>("shared", active())
      .then((value) => {
        duplicateResolved = true;
        return value;
      });
    await Promise.resolve();
    expect(duplicateResolved).toBe(false);

    await owner.complete("shared", "one effect", active());
    await expect(waiting).resolves.toEqual({
      state: "completed",
      value: "one effect",
    });
  });

  it("exposes abandoned work for recovery after a reload", async () => {
    const { create } = stores();
    const beforeReload = create();

    await beforeReload.begin("reload", active());
    await beforeReload.abandon("reload", active());

    const afterReload = create();
    await expect(afterReload.begin("reload", active())).resolves.toEqual({
      state: "in_flight",
    });
    await afterReload.release("reload", active());
    await expect(create().begin("reload", active())).resolves.toEqual({
      state: "fresh",
    });
  });

  it("requires both browser coordination primitives", async () => {
    const indexedDB = new IDBFactory();
    await expect(
      new IndexedDbIdempotencyStore({ indexedDB, locks: null }).begin(
        "missing-locks",
        active(),
      ),
    ).rejects.toThrow("requires the Web Locks API");

    await expect(
      new IndexedDbIdempotencyStore({
        indexedDB: null,
        locks: new TestLockManager(),
      }).begin("missing-indexed-db", active()),
    ).rejects.toThrow("requires IndexedDB");
  });

  it("normalizes non-Error lock failures", async () => {
    const locks: WebLockManagerLike = {
      // Deliberately exercise defensive normalization of a non-Error rejection.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      request: () => Promise.reject("lock service failed"),
    };
    const store = new IndexedDbIdempotencyStore({
      indexedDB: new IDBFactory(),
      locks,
    });

    await expect(store.begin("failure", active())).rejects.toEqual(
      expect.objectContaining({ message: "lock service failed" }),
    );
  });

  it("lets a duplicate caller stop waiting without cancelling the owner", async () => {
    const { create } = stores();
    const owner = create();
    const duplicate = create();
    await owner.begin("cancel-wait", active());
    const controller = new AbortController();
    const reason = new Error("caller stopped waiting");
    const waiting = duplicate.begin("cancel-wait", {
      signal: controller.signal,
    });

    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    await expect(
      owner.complete("cancel-wait", "completed", active()),
    ).resolves.toBeUndefined();
  });

  it("rejects settlement without a live claim", async () => {
    const { create } = stores();
    const store = create();

    await expect(store.complete("missing", "value", active())).rejects.toThrow(
      "No live idempotency claim",
    );
    await expect(store.release("missing", active())).rejects.toThrow(
      "No live idempotency claim",
    );
    expect(() => store.abandon("missing", active())).toThrow(
      "No live idempotency claim",
    );
  });
});

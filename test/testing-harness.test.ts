import { describe, expect, it } from "vitest";

import { createSignet } from "../src/index.js";
import {
  MemoryIdempotencyStore,
  checkIdempotencyStore,
  createWebMcpTestHarness,
} from "../src/testing.js";

describe("createWebMcpTestHarness", () => {
  it("discovers, invokes, cancels, and disposes exposed tools", async () => {
    const harness = createWebMcpTestHarness();
    const signet = createSignet({ modelContext: harness.modelContext });
    const registration = await signet.expose({
      name: "greet",
      description: "Greet one person.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
      execute: ({ name }: { name: string }, { signal }) => {
        signal.throwIfAborted();
        return { greeting: "Hello, " + name };
      },
    });

    expect(harness.tools().map((tool) => tool.name)).toEqual(["greet"]);
    await expect(harness.invoke("greet", { name: "Ada" })).resolves.toEqual({
      greeting: "Hello, Ada",
    });

    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    await expect(
      harness.invoke("greet", { name: "Ada" }, { signal: controller.signal }),
    ).rejects.toBe(reason);

    registration.dispose();
    expect(harness.tools()).toEqual([]);
    await expect(harness.invoke("greet", { name: "Ada" })).rejects.toThrow(
      "not registered",
    );
  });

  it("clears registrations between tests", async () => {
    const harness = createWebMcpTestHarness();
    const signet = createSignet({ modelContext: harness.modelContext });
    await signet.expose({
      name: "temporary",
      description: "Temporary.",
      inputSchema: { type: "object" },
      execute: () => undefined,
    });

    harness.clear();

    expect(harness.tools()).toEqual([]);
  });
});

describe("checkIdempotencyStore", () => {
  it("accepts the reference store", async () => {
    await expect(
      checkIdempotencyStore(() => new MemoryIdempotencyStore()),
    ).resolves.toEqual({
      passed: [
        "claims fresh keys",
        "waits for live equal keys",
        "reports abandoned in-flight work",
        "persists completed results",
        "releases proven pre-effect claims",
        "runs distinct keys concurrently",
        "honors pre-aborted calls",
      ],
    });
  });

  it("rejects a store that does not wait for a live owner", async () => {
    await expect(
      checkIdempotencyStore(() => ({
        async begin() {
          return { state: "fresh" as const };
        },
        async complete() {},
        async release() {},
        async abandon() {},
      })),
    ).rejects.toThrow("wait for a live equal-key owner");
  });

  it("rejects a store that serializes distinct keys", async () => {
    await expect(
      checkIdempotencyStore(
        () => {
          const inner = new MemoryIdempotencyStore();
          let tail = Promise.resolve();
          const unlockByKey = new Map<string, () => void>();
          return {
            async begin<Output>(key: string, options: { signal: AbortSignal }) {
              const previous = tail;
              let release: (() => void) | undefined;
              tail = new Promise<void>((resolve) => {
                release = resolve;
              });
              await previous;
              unlockByKey.set(key, release!);
              return await inner.begin<Output>(key, options);
            },
            async complete<Output>(
              key: string,
              value: Output,
              options: { signal: AbortSignal },
            ) {
              await inner.complete(key, value, options);
              unlockByKey.get(key)?.();
              unlockByKey.delete(key);
            },
            async release(key: string, options: { signal: AbortSignal }) {
              await inner.release(key, options);
              unlockByKey.get(key)?.();
              unlockByKey.delete(key);
            },
            async abandon(key: string, options: { signal: AbortSignal }) {
              await inner.abandon(key, options);
              unlockByKey.get(key)?.();
              unlockByKey.delete(key);
            },
          };
        },
        { concurrencyTimeoutMs: 10 },
      ),
    ).rejects.toThrow("must not serialize distinct keys");
  });

  it("uses fresh keys on every conformance run", async () => {
    const shared = new MemoryIdempotencyStore();
    const createStore = () => shared;

    await checkIdempotencyStore(createStore);
    await expect(checkIdempotencyStore(createStore)).resolves.toBeDefined();
  });

  it("rejects a store that deletes abandoned work", async () => {
    await expect(
      checkIdempotencyStore(() => {
        const inner = new MemoryIdempotencyStore();
        return {
          begin: inner.begin.bind(inner),
          complete: inner.complete.bind(inner),
          release: inner.release.bind(inner),
          async abandon(key: string, options: { signal: AbortSignal }) {
            await inner.release(key, options);
          },
        };
      }),
    ).rejects.toThrow("report abandoned in-flight work");
  });
});

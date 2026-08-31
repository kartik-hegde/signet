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
        "coalesces equal keys",
        "runs distinct keys concurrently",
        "evicts failures",
        "honors pre-aborted calls",
        "returns completed owner work after late abort",
      ],
    });
  });

  it("rejects a store that does not coalesce", async () => {
    await expect(
      checkIdempotencyStore(() => ({
        async execute(_key, operation) {
          return { value: await operation(), replayed: false };
        },
      })),
    ).rejects.toThrow("coalesce concurrent equal keys");
  });

  it("rejects a store that serializes distinct keys", async () => {
    await expect(
      checkIdempotencyStore(
        () => {
          let tail = Promise.resolve();
          const operations = new Map<string, Promise<unknown>>();
          return {
            async execute<Output>(
              key: string,
              operation: () => Promise<Output>,
            ) {
              const existing = operations.get(key) as
                Promise<Output> | undefined;
              if (existing) {
                return { value: await existing, replayed: true };
              }
              const pending = tail.then(operation);
              operations.set(key, pending);
              tail = pending.then(
                () => undefined,
                () => undefined,
              );
              return { value: await pending, replayed: false };
            },
          };
        },
        { concurrencyTimeoutMs: 10 },
      ),
    ).rejects.toThrow("must not serialize distinct keys");
  });

  it("uses fresh keys on every conformance run", async () => {
    const operations = new Map<string, Promise<unknown>>();
    const createStore = () => ({
      async execute<Output>(
        key: string,
        operation: () => Promise<Output>,
        options: { signal: AbortSignal },
      ) {
        options.signal.throwIfAborted();
        const existing = operations.get(key) as Promise<Output> | undefined;
        if (existing) return { value: await existing, replayed: true };
        const pending = operation();
        operations.set(key, pending);
        void pending.catch(() => operations.delete(key));
        return { value: await pending, replayed: false };
      },
    });

    await checkIdempotencyStore(createStore);
    await expect(checkIdempotencyStore(createStore)).resolves.toBeDefined();
  });

  it("rejects a store that abandons completed owner work after abort", async () => {
    await expect(
      checkIdempotencyStore(() => {
        const operations = new Map<string, Promise<unknown>>();
        return {
          async execute<Output>(
            key: string,
            operation: () => Promise<Output>,
            options: { signal: AbortSignal },
          ) {
            options.signal.throwIfAborted();
            const existing = operations.get(key) as Promise<Output> | undefined;
            if (existing) {
              return { value: await existing, replayed: true };
            }
            const pending = operation();
            operations.set(key, pending);
            void pending.catch(() => operations.delete(key));
            const abort = new Promise<void>((resolve) => {
              options.signal.addEventListener("abort", () => resolve(), {
                once: true,
              });
            }).then((): Output => {
              options.signal.throwIfAborted();
              throw new Error("abort event fired without an aborted signal");
            });
            return {
              value: await Promise.race([pending, abort]),
              replayed: false,
            };
          },
        };
      }),
    ).rejects.toThrow("completed owner work after a late abort");
  });
});

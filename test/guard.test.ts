import { describe, expect, it, vi } from "vitest";

import {
  AuthorizationError,
  VerificationError,
  guard,
  type GuardEvent,
} from "../src/index.js";
import { MemoryIdempotencyStore } from "../src/testing.js";

const active = (): { signal: AbortSignal } => ({
  signal: new AbortController().signal,
});

describe("guard", () => {
  it("passes input and the native cancellation signal through unchanged", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async (input: { value: number }, options) => {
      expect(options.signal).toBe(controller.signal);
      return input.value * 2;
    });

    const guarded = guard(execute);

    await expect(
      guarded({ value: 4 }, { signal: controller.signal }),
    ).resolves.toBe(8);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("fails closed before executing when authorization is denied", async () => {
    const execute = vi.fn(async () => "secret");
    const guarded = guard(execute, {
      context: async () => ({ role: "viewer" }),
      authorize: ({ context }) => ({
        allowed: context.role === "admin",
        reason: "An administrator is required.",
      }),
    });

    await expect(guarded({}, active())).rejects.toEqual(
      expect.objectContaining({
        name: "AuthorizationError",
        code: "authorization_denied",
        message: "An administrator is required.",
      }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("coalesces duplicate work and verifies both the original and replay", async () => {
    const store = new MemoryIdempotencyStore();
    const execute = vi.fn(async ({ orderId }: { orderId: string }) => ({
      orderId,
      state: "placed" as const,
    }));
    const verify = vi.fn(({ output }) => output.state === "placed");
    const guarded = guard(execute, {
      idempotency: {
        key: ({ input }) => input.orderId,
        store,
      },
      verify,
    });

    const first = await guarded({ orderId: "order-1" }, active());
    const second = await guarded({ orderId: "order-1" }, active());

    expect(first).toEqual(second);
    expect(execute).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ replayed: true }),
    );
  });

  it("rejects an unverifiable result without disguising it as success", async () => {
    const guarded = guard(async () => ({ state: "pending" }), {
      verify: ({ output }) => ({
        verified: output.state === "complete",
        reason: "The backend did not report completion.",
      }),
    });

    await expect(guarded({}, active())).rejects.toBeInstanceOf(
      VerificationError,
    );
  });

  it("preserves application errors and emits metadata without inputs or outputs", async () => {
    const events: GuardEvent[] = [];
    const failure = new Error("upstream failed");
    const guarded = guard(
      async () => {
        throw failure;
      },
      {
        name: "place-order",
        invocationId: () => "invocation-1",
        now: () => 10,
        observe: (event) => events.push(event),
      },
    );

    await expect(guarded({ cardNumber: "not-observed" }, active())).rejects.toBe(
      failure,
    );
    expect(events.map((event) => event.stage)).toEqual(["started", "failed"]);
    expect(events[1]).toEqual(
      expect.objectContaining({
        invocationId: "invocation-1",
        name: "place-order",
        error: failure,
      }),
    );
    expect(JSON.stringify(events)).not.toContain("not-observed");
  });

  it("does not let an observer break the guarded operation", async () => {
    const guarded = guard(async () => "done", {
      observe: () => {
        throw new Error("collector unavailable");
      },
    });

    await expect(guarded({}, active())).resolves.toBe("done");
  });

  it("honors an already-aborted invocation before doing any work", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const execute = vi.fn(async () => "done");

    await expect(guard(execute)({}, { signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("exports a recognizable authorization error", () => {
    expect(new AuthorizationError()).toEqual(
      expect.objectContaining({ code: "authorization_denied" }),
    );
  });
});

describe("MemoryIdempotencyStore", () => {
  it("keeps in-flight work keyed when one caller stops waiting", async () => {
    const store = new MemoryIdempotencyStore();
    const controller = new AbortController();
    let finish: ((value: string) => void) | undefined;
    const operation = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );

    const first = store.execute("same-operation", operation, {
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort(new Error("caller stopped waiting"));
    await expect(first).rejects.toThrow("caller stopped waiting");

    const second = store.execute("same-operation", operation, active());
    finish?.("complete");

    await expect(second).resolves.toEqual({
      value: "complete",
      replayed: true,
    });
    expect(operation).toHaveBeenCalledOnce();
  });
});

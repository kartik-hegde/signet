import { describe, expect, it, vi } from "vitest";

import {
  AuthorizationError,
  ConfirmationError,
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

  it("does not allocate observability metadata when no observer is configured", async () => {
    const invocationId = vi.fn(() => "unused");
    const now = vi.fn(() => 1);
    const guarded = guard(async () => "done", { invocationId, now });

    await expect(guarded({}, active())).resolves.toBe("done");
    expect(invocationId).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("passes input and signal to context and authorization", async () => {
    const controller = new AbortController();
    const context = vi.fn(async () => ({ userId: "user-1" }));
    const authorize = vi.fn(() => true);
    const guarded = guard(async () => "done", { context, authorize });

    await guarded({ resourceId: "resource-1" }, { signal: controller.signal });

    expect(context).toHaveBeenCalledWith(
      { resourceId: "resource-1" },
      { signal: controller.signal },
    );
    expect(authorize).toHaveBeenCalledWith({
      input: { resourceId: "resource-1" },
      context: { userId: "user-1" },
      signal: controller.signal,
    });
  });

  it("preserves context errors and prevents execution", async () => {
    const failure = new Error("session unavailable");
    const execute = vi.fn(async () => "done");
    const guarded = guard(execute, {
      context: async () => {
        throw failure;
      },
    });

    await expect(guarded({}, active())).rejects.toBe(failure);
    expect(execute).not.toHaveBeenCalled();
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

  it("uses a stable default message for boolean authorization denial", async () => {
    const guarded = guard(async () => "secret", {
      authorize: () => false,
    });

    await expect(guarded({}, active())).rejects.toEqual(
      expect.objectContaining({
        name: "AuthorizationError",
        message: "The operation is not authorized.",
      }),
    );
  });

  it("accepts a structured authorization decision", async () => {
    const guarded = guard(async () => "done", {
      authorize: () => ({ allowed: true }),
    });

    await expect(guarded({}, active())).resolves.toBe("done");
  });

  it("confirms after authorization and before idempotency", async () => {
    const order: string[] = [];
    const events: GuardEvent[] = [];
    const guarded = guard(
      async () => {
        order.push("execute");
        return "done";
      },
      {
        authorize: () => {
          order.push("authorize");
          return true;
        },
        confirm: () => {
          order.push("confirm");
          return { confirmed: true };
        },
        idempotency: {
          key: () => {
            order.push("key");
            return "operation-1";
          },
          store: new MemoryIdempotencyStore(),
        },
        observe: (event) => {
          events.push(event);
        },
      },
    );

    await expect(guarded({}, active())).resolves.toBe("done");
    expect(order).toEqual(["authorize", "confirm", "key", "execute"]);
    expect(events.map(({ stage }) => stage)).toEqual([
      "started",
      "authorized",
      "confirmation_requested",
      "confirmed",
      "executed",
      "succeeded",
    ]);
  });

  it("fails before idempotency when confirmation is declined", async () => {
    const execute = vi.fn(async () => "done");
    const key = vi.fn(() => "operation-1");
    const guarded = guard(execute, {
      confirm: () => ({
        confirmed: false,
        reason: "Keep this draft unchanged.",
      }),
      idempotency: { key, store: new MemoryIdempotencyStore() },
    });

    await expect(guarded({}, active())).rejects.toEqual(
      expect.objectContaining({
        name: "ConfirmationError",
        code: "confirmation_declined",
        message: "Keep this draft unchanged.",
      }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(key).not.toHaveBeenCalled();
  });

  it("uses a stable default confirmation-decline message", async () => {
    const guarded = guard(async () => "done", { confirm: () => false });
    await expect(guarded({}, active())).rejects.toBeInstanceOf(
      ConfirmationError,
    );
  });

  it("stops after authorization when cancellation arrives during the check", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled during policy check");
    const execute = vi.fn(async () => "done");
    const guarded = guard(execute, {
      authorize: async () => {
        controller.abort(cancelled);
        return true;
      },
    });

    await expect(guarded({}, { signal: controller.signal })).rejects.toBe(
      cancelled,
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

  it("re-evaluates authorization before replay without re-executing", async () => {
    const store = new MemoryIdempotencyStore();
    const authorize = vi.fn(() => true);
    const execute = vi.fn(async () => ({ state: "cancelled" as const }));
    const guarded = guard(execute, {
      authorize,
      idempotency: { key: () => "cancel-order-1", store },
    });

    const first = await guarded({}, active());
    const replay = await guarded({}, active());

    expect(replay).toEqual(first);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("recovers an ambiguous execution from authoritative state and caches it", async () => {
    const store = new MemoryIdempotencyStore();
    const events: GuardEvent[] = [];
    const execute = vi.fn(async () => {
      throw new Error("response lost after commit");
    });
    const recover = vi.fn(() => ({
      recovered: true as const,
      output: { bookingId: "booking-1", state: "confirmed" as const },
    }));
    const verify = vi.fn(({ output }) => output.state === "confirmed");
    const guarded = guard(execute, {
      idempotency: { key: () => "booking-1", store },
      recover,
      verify,
      observe: (event) => {
        events.push(event);
      },
    });

    const first = await guarded({}, active());
    const second = await guarded({}, active());

    expect(first).toEqual(second);
    expect(execute).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ recovered: true, replayed: false }),
    );
    expect(verify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ recovered: false, replayed: true }),
    );
    expect(events.map((event) => event.stage)).toEqual([
      "started",
      "recovered",
      "verified",
      "succeeded",
      "started",
      "replayed",
      "verified",
      "succeeded",
    ]);
  });

  it("preserves the execution error when recovery cannot prove an outcome", async () => {
    const failure = new Error("upstream unavailable");
    const recover = vi.fn(() => ({ recovered: false as const }));
    const store = new MemoryIdempotencyStore();
    const guarded = guard(
      async () => {
        throw failure;
      },
      {
        idempotency: { key: () => "operation-1", store },
        recover,
      },
    );

    await expect(guarded({}, active())).rejects.toBe(failure);
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({ error: failure }),
    );
  });

  it("keeps a proven pre-effect failure retryable", async () => {
    const store = new MemoryIdempotencyStore();
    const failure = new Error("failed before effect");
    let committed = false;
    const execute = vi
      .fn<() => Promise<{ state: string }>>()
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(async () => {
        committed = true;
        return { state: "complete" };
      });
    const guarded = guard(execute, {
      idempotency: { key: () => "operation-1", store },
      recover: () =>
        committed
          ? { recovered: true, output: { state: "complete" } }
          : { recovered: false },
    });

    await expect(guarded({}, active())).rejects.toBe(failure);
    await expect(guarded({}, active())).resolves.toEqual({ state: "complete" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not conceal an idempotency-store failure", async () => {
    const failure = new Error("idempotency store unavailable");
    const recover = vi.fn(() => ({
      recovered: true as const,
      output: { state: "complete" },
    }));
    const guarded = guard(async () => ({ state: "complete" }), {
      idempotency: {
        key: () => "operation-1",
        store: {
          async execute() {
            throw failure;
          },
        },
      },
      recover,
    });

    await expect(guarded({}, active())).rejects.toBe(failure);
    expect(recover).not.toHaveBeenCalled();
  });

  it("never attempts recovery after cancellation", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled");
    const recover = vi.fn(() => ({ recovered: false as const }));
    const guarded = guard(
      async () => {
        controller.abort(cancelled);
        throw new Error("handler stopped");
      },
      { recover },
    );

    await expect(guarded({}, { signal: controller.signal })).rejects.toBe(
      cancelled,
    );
    expect(recover).not.toHaveBeenCalled();
  });

  it("passes the signal through idempotency keying and storage", async () => {
    const controller = new AbortController();
    const key = vi.fn(() => "operation-1");
    const store = {
      execute: vi.fn(async (_key, operation, options) => {
        expect(options.signal).toBe(controller.signal);
        return { value: await operation(), replayed: false };
      }),
    };
    const guarded = guard(async () => "done", {
      idempotency: { key, store },
    });

    await guarded({}, { signal: controller.signal });

    expect(key).toHaveBeenCalledWith({
      input: {},
      context: undefined,
      signal: controller.signal,
    });
    expect(store.execute).toHaveBeenCalledOnce();
  });

  it("rejects an empty idempotency key before reaching storage", async () => {
    const store = { execute: vi.fn() };
    const guarded = guard(async () => "done", {
      idempotency: { key: () => "", store },
    });

    await expect(guarded({}, active())).rejects.toThrow(
      "idempotency key must not be empty",
    );
    expect(store.execute).not.toHaveBeenCalled();
  });

  it("stops before storage when cancellation arrives during keying", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled during keying");
    const store = { execute: vi.fn() };
    const guarded = guard(async () => "done", {
      idempotency: {
        key: async () => {
          controller.abort(cancelled);
          return "operation-1";
        },
        store,
      },
    });

    await expect(guarded({}, { signal: controller.signal })).rejects.toBe(
      cancelled,
    );
    expect(store.execute).not.toHaveBeenCalled();
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

  it("uses a stable default message for boolean verification failure", async () => {
    const guarded = guard(async () => ({ state: "pending" }), {
      verify: () => false,
    });

    await expect(guarded({}, active())).rejects.toEqual(
      expect.objectContaining({
        name: "VerificationError",
        message: "The operation's result could not be verified.",
      }),
    );
  });

  it("accepts a structured verification decision", async () => {
    const guarded = guard(async () => "done", {
      verify: () => ({ verified: true }),
    });

    await expect(guarded({}, active())).resolves.toBe("done");
  });

  it("finishes verification when cancellation arrives after execution", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled during verification");
    const events: GuardEvent[] = [];
    const guarded = guard(async () => ({ state: "complete" }), {
      verify: async ({ signal }) => {
        expect(signal).not.toBe(controller.signal);
        expect(signal.aborted).toBe(false);
        controller.abort(cancelled);
        return true;
      },
      observe: (event) => {
        events.push(event);
      },
    });

    await expect(guarded({}, { signal: controller.signal })).resolves.toEqual({
      state: "complete",
    });
    expect(events.map((event) => event.stage)).toEqual([
      "started",
      "executed",
      "verified",
      "completed_after_abort",
      "succeeded",
    ]);
  });

  it("returns an idempotent result when cancellation loses to execution", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled after the effect");
    const events: GuardEvent[] = [];
    let effects = 0;
    const guarded = guard(
      async () => {
        effects += 1;
        controller.abort(cancelled);
        return { state: "complete" as const };
      },
      {
        idempotency: {
          key: () => "operation-1",
          store: new MemoryIdempotencyStore(),
        },
        observe: (event) => {
          events.push(event);
        },
      },
    );

    await expect(guarded({}, { signal: controller.signal })).resolves.toEqual({
      state: "complete",
    });
    expect(effects).toBe(1);
    expect(events.map(({ stage }) => stage)).toEqual([
      "started",
      "executed",
      "completed_after_abort",
      "succeeded",
    ]);
  });

  it("bounds verification with an independent finalization deadline", async () => {
    let verificationSignal: AbortSignal | undefined;
    const guarded = guard(async () => ({ state: "complete" }), {
      verifyTimeoutMs: 5,
      verify: async ({ signal }) => {
        verificationSignal = signal;
        await new Promise(() => undefined);
        return true;
      },
    });

    await expect(guarded({}, active())).rejects.toMatchObject({
      name: "VerificationError",
      code: "verification_failed",
      message: "Verification timed out.",
    });
    expect(verificationSignal?.aborted).toBe(true);
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
        observe: (event) => {
          events.push(event);
        },
      },
    );

    await expect(
      guarded({ cardNumber: "not-observed" }, active()),
    ).rejects.toBe(failure);
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

  it("contains asynchronous observer rejection", async () => {
    const guarded = guard(async () => "done", {
      observe: async () => {
        throw new Error("async collector unavailable");
      },
    });

    await expect(guarded({}, active())).resolves.toBe("done");
    await Promise.resolve();
  });

  it("honors an already-aborted invocation before doing any work", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const execute = vi.fn(async () => "done");

    await expect(
      guard(execute)({}, { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
    expect(execute).not.toHaveBeenCalled();
  });

  it("exports a recognizable authorization error", () => {
    expect(new AuthorizationError()).toEqual(
      expect.objectContaining({ code: "authorization_denied" }),
    );
  });
});

describe("MemoryIdempotencyStore", () => {
  it("coalesces concurrent operations and replays the shared result", async () => {
    const store = new MemoryIdempotencyStore();
    let finish: ((value: string) => void) | undefined;
    const operation = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );

    const first = store.execute("same-operation", operation, active());
    await Promise.resolve();
    const second = store.execute("same-operation", operation, active());
    finish?.("complete");

    await expect(first).resolves.toEqual({
      value: "complete",
      replayed: false,
    });
    await expect(second).resolves.toEqual({
      value: "complete",
      replayed: true,
    });
    expect(operation).toHaveBeenCalledOnce();
  });

  it("removes failed work so a later call can retry", async () => {
    const store = new MemoryIdempotencyStore();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("complete");

    await expect(
      store.execute("retryable", operation, active()),
    ).rejects.toThrow("temporary failure");
    await expect(
      store.execute("retryable", operation, active()),
    ).resolves.toEqual({ value: "complete", replayed: false });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not start work for an already-aborted caller", async () => {
    const store = new MemoryIdempotencyStore();
    const controller = new AbortController();
    controller.abort(new Error("already cancelled"));
    const operation = vi.fn(async () => "complete");

    await expect(
      store.execute("cancelled", operation, { signal: controller.signal }),
    ).rejects.toThrow("already cancelled");
    expect(operation).not.toHaveBeenCalled();
  });

  it("can clear completed demo state", async () => {
    const store = new MemoryIdempotencyStore();
    const operation = vi.fn(async () => "complete");

    await store.execute("operation", operation, active());
    store.clear();
    await store.execute("operation", operation, active());

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("lets a duplicate caller stop waiting without cancelling owner work", async () => {
    const store = new MemoryIdempotencyStore();
    const controller = new AbortController();
    let finish: ((value: string) => void) | undefined;
    const operation = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );

    const first = store.execute("same-operation", operation, active());
    await Promise.resolve();
    const second = store.execute("same-operation", operation, {
      signal: controller.signal,
    });
    controller.abort(new Error("caller stopped waiting"));
    await expect(second).rejects.toThrow("caller stopped waiting");
    finish?.("complete");

    await expect(first).resolves.toEqual({
      value: "complete",
      replayed: false,
    });
    expect(operation).toHaveBeenCalledOnce();
  });
});

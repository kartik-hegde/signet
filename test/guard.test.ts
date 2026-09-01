import { describe, expect, it, vi } from "vitest";

import {
  AuthorizationError,
  ConfirmationError,
  OutcomeUnknownError,
  VerificationError,
  WebStorageOperationJournal,
  guard,
  type ExecuteOptions,
  type GuardEvent,
  type OperationHandle,
} from "../src/index.js";
import {
  MemoryIdempotencyStore,
  MemoryOperationJournal,
} from "../src/testing.js";

const active = (): { signal: AbortSignal } => ({
  signal: new AbortController().signal,
});
const journal = () => ({ store: new MemoryOperationJournal() });

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
        journal: journal(),
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
      "sealed",
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
      journal: journal(),
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

  it("confirms only a new effect when configured for effect-only consent", async () => {
    const confirm = vi.fn(() => true);
    const execute = vi.fn(async () => ({ state: "complete" as const }));
    const events: GuardEvent[] = [];
    const guarded = guard(execute, {
      confirm: { mode: "effect-only", request: confirm },
      idempotency: {
        key: () => "place-order-1",
        store: new MemoryIdempotencyStore(),
      },
      journal: journal(),
      observe: (event) => {
        events.push(event);
      },
    });

    const first = await guarded({}, active());
    const replay = await guarded({}, active());

    expect(replay).toEqual(first);
    expect(confirm).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(events.map(({ stage }) => stage)).toEqual([
      "started",
      "confirmation_requested",
      "confirmed",
      "executed",
      "sealed",
      "succeeded",
      "started",
      "replayed",
      "succeeded",
    ]);
  });

  it("coalesces concurrent effect-only confirmation behind the store", async () => {
    const store = new MemoryIdempotencyStore();
    let approve: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      approve = resolve;
    });
    const confirm = vi.fn(async () => {
      await gate;
      return true;
    });
    const execute = vi.fn(async () => "done");
    const guarded = guard(execute, {
      confirm: { mode: "effect-only", request: confirm },
      idempotency: { key: () => "same-effect", store },
      journal: journal(),
    });

    const first = guarded({}, active());
    const second = guarded({}, active());
    await Promise.resolve();
    await Promise.resolve();
    approve?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      "done",
      "done",
    ]);
    expect(confirm).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
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
      journal: journal(),
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
      journal: journal(),
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
      journal: journal(),
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
      "sealed",
      "succeeded",
      "started",
      "replayed",
      "verified",
      "succeeded",
    ]);
  });

  it("rejects idempotency without a journal before invocation", () => {
    expect(() =>
      guard(async () => "done", {
        idempotency: {
          key: () => "operation-1",
          store: new MemoryIdempotencyStore(),
        },
      }),
    ).toThrow("idempotency requires an operation journal");
  });

  it("surfaces an explicitly unknown outcome as its own terminal state", async () => {
    const failure = new Error("response lost");
    const events: GuardEvent[] = [];
    const guarded = guard(
      async () => {
        throw failure;
      },
      {
        recover: () => ({
          recovered: false,
          outcome: "unknown",
          reason: "The provider accepted the request but has no lookup key.",
        }),
        observe: (event) => {
          events.push(event);
        },
      },
    );

    await expect(guarded({}, active())).rejects.toEqual(
      expect.objectContaining({
        name: "OutcomeUnknownError",
        code: "outcome_unknown",
        retryable: false,
        cause: failure,
      }),
    );
    expect(events.map(({ stage }) => stage)).toEqual([
      "started",
      "outcome_unknown",
    ]);
  });

  it("treats a failed authoritative recovery read as unknown", async () => {
    const guarded = guard(
      async () => {
        throw new Error("response lost");
      },
      {
        recover: async () => {
          throw new Error("database unavailable");
        },
      },
    );

    await expect(guarded({}, active())).rejects.toBeInstanceOf(
      OutcomeUnknownError,
    );
  });

  it("shares a scoped operation journal across execution and recovery", async () => {
    const journal = new MemoryOperationJournal();
    const guarded = guard(
      async (_input, { operation }) => {
        expect(operation?.key).toBe("checkout-1:operation-1");
        await operation?.write({ orderId: "order-1" });
        throw new Error("response lost after commit");
      },
      {
        journal: {
          key: () => "checkout-1:operation-1",
          store: journal,
        },
        recover: async ({ operation }) => {
          const entry = await operation?.read<{ orderId: string }>();
          return entry
            ? { recovered: true, output: entry }
            : { recovered: false, outcome: "unknown" };
        },
      },
    );

    await expect(guarded({}, active())).resolves.toEqual({
      orderId: "order-1",
    });
  });

  it("records the explicit Proof Seal effect lifecycle", async () => {
    const events: GuardEvent[] = [];
    const guarded = guard(
      async (_input, { operation }) => {
        expect(await operation?.state()).toBeUndefined();
        await operation?.beginEffect({ orderId: "order-1" });
        expect(await operation?.state()).toEqual({
          phase: "effect_started",
          correlation: { orderId: "order-1" },
        });
        await operation?.recordEffect({ orderId: "order-1", receipt: "r-1" });
        expect(await operation?.state()).toEqual({
          phase: "effect_observed",
          correlation: { orderId: "order-1", receipt: "r-1" },
        });
        return await operation?.read();
      },
      {
        journal: {
          key: () => "operation-1",
          store: new MemoryOperationJournal(),
        },
        observe: (event) => {
          events.push(event);
        },
      },
    );

    await expect(guarded({}, active())).resolves.toEqual({
      orderId: "order-1",
      receipt: "r-1",
    });
    expect(events.map(({ stage }) => stage)).toEqual([
      "started",
      "effect_started",
      "effect_observed",
      "executed",
      "succeeded",
    ]);
  });

  it("rejects recording an effect before its boundary is durable", async () => {
    const guarded = guard(
      async (_input, { operation }) => {
        await operation?.recordEffect({ orderId: "order-1" });
        return "unreachable";
      },
      {
        journal: {
          key: () => "operation-1",
          store: new MemoryOperationJournal(),
        },
      },
    );

    await expect(guarded({}, active())).rejects.toThrow(
      "cannot record an effect before beginEffect",
    );
  });

  it("preserves an undefined Proof Seal correlation", async () => {
    const entries = new Map<string, string>();
    const journal = new WebStorageOperationJournal({
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => {
        entries.set(key, value);
      },
      removeItem: (key) => {
        entries.delete(key);
      },
    });
    const guarded = guard(
      async (_input, { operation }) => {
        await operation?.beginEffect(undefined);
        expect(await operation?.state()).toEqual({
          phase: "effect_started",
          correlation: undefined,
        });
        await operation?.recordEffect(undefined);
        return await operation?.state();
      },
      {
        journal: {
          key: () => "operation-1",
          store: journal,
        },
      },
    );

    await expect(guarded({}, active())).resolves.toEqual({
      phase: "effect_observed",
      correlation: undefined,
    });
  });

  it("reuses the idempotency key for a journal when no journal key is given", async () => {
    const journal = new MemoryOperationJournal();
    const guarded = guard(
      async (_input, { operation }) => {
        await operation?.write({ state: "recorded" });
        return operation?.key;
      },
      {
        idempotency: {
          key: () => "shared-key",
          store: new MemoryIdempotencyStore(),
        },
        journal: { store: journal },
      },
    );

    await expect(guarded({}, active())).resolves.toBe("shared-key");
    expect(journal.read("shared-key", active())).toBeUndefined();
  });

  it("requires a journal key when idempotency is not configured", async () => {
    const guarded = guard(async () => "done", {
      journal: { store: new MemoryOperationJournal() },
    });

    await expect(guarded({}, active())).rejects.toThrow(
      "journal needs a non-empty key",
    );
  });

  it("keeps a proven pre-effect failure retryable", async () => {
    const store = new MemoryIdempotencyStore();
    const journal = new MemoryOperationJournal();
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
      journal: { store: journal },
      recover: () =>
        committed
          ? { recovered: true, output: { state: "complete" } }
          : { recovered: false },
    });

    await expect(guarded({}, active())).rejects.toBe(failure);
    await expect(guarded({}, active())).resolves.toEqual({ state: "complete" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("recovers abandoned in-flight work without executing again", async () => {
    const store = new MemoryIdempotencyStore();
    const journal = new MemoryOperationJournal();
    await store.begin("operation-1", active());
    journal.write("operation-1", { orderId: "order-1" }, active());
    await store.abandon("operation-1", active());
    const execute = vi.fn(async () => ({ orderId: "duplicate" }));
    const confirm = vi.fn(() => true);
    const recover = vi.fn(async ({ operation }) => ({
      recovered: true as const,
      output: (await operation?.read()) as { orderId: string },
    }));
    const guarded = guard(execute, {
      idempotency: { key: () => "operation-1", store },
      journal: { store: journal },
      confirm: { mode: "effect-only", request: confirm },
      recover,
    });

    await expect(guarded({}, active())).resolves.toEqual({
      orderId: "order-1",
    });
    await expect(guarded({}, active())).resolves.toEqual({
      orderId: "order-1",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(recover).toHaveBeenCalledOnce();
    expect(journal.read("operation-1", active())).toBeUndefined();
  });

  it("reclaims abandoned work that never crossed the effect boundary", async () => {
    const store = new MemoryIdempotencyStore();
    const journal = new MemoryOperationJournal();
    await store.begin("operation-1", active());
    await store.abandon("operation-1", active());
    const recover = vi.fn(() => ({ recovered: false as const }));
    const execute = vi.fn(async (_input, { operation }) => {
      await operation?.beginEffect({ orderId: "order-1" });
      await operation?.recordEffect({ orderId: "order-1" });
      return { orderId: "order-1" };
    });
    const guarded = guard(execute, {
      idempotency: { key: () => "operation-1", store },
      journal: { store: journal },
      recover,
      verify: () => true,
    });

    await expect(guarded({}, active())).resolves.toEqual({
      orderId: "order-1",
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(recover).not.toHaveBeenCalled();
    await expect(guarded({}, active())).resolves.toEqual({
      orderId: "order-1",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps a journaled unknown outcome recoverable on a later invocation", async () => {
    const store = new MemoryIdempotencyStore();
    const journal = new MemoryOperationJournal();
    const lostResponse = new Error("response lost after commit");
    let authoritative: { orderId: string } | undefined;
    const execute = vi.fn(async (_input, { operation }) => {
      authoritative = { orderId: "order-1" };
      await operation?.write({ orderId: "order-1" });
      throw lostResponse;
    });
    const recover = vi
      .fn()
      .mockReturnValueOnce({ recovered: false })
      .mockImplementation(() => ({
        recovered: true,
        output: authoritative,
      }));
    const guarded = guard(execute, {
      idempotency: { key: () => "operation-1", store },
      journal: { store: journal },
      recover,
    });

    await expect(guarded({}, active())).rejects.toBeInstanceOf(
      OutcomeUnknownError,
    );
    await expect(guarded({}, active())).resolves.toEqual({
      orderId: "order-1",
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it("treats a failed pre-effect journal read as an unknown outcome", async () => {
    const failure = new Error("handler failed");
    const journalFailure = new Error("journal unavailable");
    const guarded = guard(
      async () => {
        throw failure;
      },
      {
        idempotency: {
          key: () => "operation-1",
          store: new MemoryIdempotencyStore(),
        },
        journal: {
          store: {
            read() {
              throw journalFailure;
            },
            write() {},
            remove() {},
          },
        },
        recover: () => ({ recovered: false }),
      },
    );

    await expect(guarded({}, active())).rejects.toEqual(
      expect.objectContaining({
        code: "outcome_unknown",
        cause: expect.any(AggregateError),
      }),
    );
  });

  it("preserves the operation outcome when abandoning the live claim fails", async () => {
    const abandonFailure = new Error("lock release failed");
    const store = {
      async begin() {
        return { state: "fresh" as const };
      },
      async complete() {},
      async release() {},
      async abandon() {
        throw abandonFailure;
      },
    };
    const guarded = guard(
      async (_input, { operation }) => {
        await operation?.write({ phase: "started" });
        throw new Error("ambiguous handler failure");
      },
      {
        idempotency: { key: () => "operation-1", store },
        journal: journal(),
        recover: () => ({ recovered: false }),
      },
    );

    await expect(guarded({}, active())).rejects.toBeInstanceOf(
      OutcomeUnknownError,
    );
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
          async begin() {
            throw failure;
          },
          async complete() {},
          async release() {},
          async abandon() {},
        },
      },
      journal: journal(),
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
      begin: vi.fn(async (_key, options) => {
        expect(options.signal).toBe(controller.signal);
        return { state: "fresh" as const };
      }),
      complete: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
      abandon: vi.fn(async () => undefined),
    };
    const guarded = guard(async () => "done", {
      idempotency: { key, store },
      journal: journal(),
    });

    await guarded({}, { signal: controller.signal });

    expect(key).toHaveBeenCalledWith({
      input: {},
      context: undefined,
      signal: controller.signal,
    });
    expect(store.begin).toHaveBeenCalledOnce();
  });

  it("rejects an empty idempotency key before reaching storage", async () => {
    const store = new MemoryIdempotencyStore();
    const begin = vi.spyOn(store, "begin");
    const guarded = guard(async () => "done", {
      idempotency: { key: () => "", store },
      journal: journal(),
    });

    await expect(guarded({}, active())).rejects.toThrow(
      "idempotency key must not be empty",
    );
    expect(begin).not.toHaveBeenCalled();
  });

  it("stops before storage when cancellation arrives during keying", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled during keying");
    const store = new MemoryIdempotencyStore();
    const begin = vi.spyOn(store, "begin");
    const guarded = guard(async () => "done", {
      idempotency: {
        key: async () => {
          controller.abort(cancelled);
          return "operation-1";
        },
        store,
      },
      journal: journal(),
    });

    await expect(guarded({}, { signal: controller.signal })).rejects.toBe(
      cancelled,
    );
    expect(begin).not.toHaveBeenCalled();
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

  it("seals an idempotent result only after verification", async () => {
    const order: string[] = [];
    const inner = new MemoryIdempotencyStore();
    const store = {
      begin: inner.begin.bind(inner),
      async complete<Output>(
        key: string,
        value: Output,
        options: ExecuteOptions,
      ) {
        order.push("complete");
        await inner.complete(key, value, options);
      },
      release: inner.release.bind(inner),
      abandon: inner.abandon.bind(inner),
    };
    const guarded = guard(
      async (_input, { operation }) => {
        await operation?.beginEffect({ orderId: "order-1" });
        order.push("execute");
        await operation?.recordEffect({ orderId: "order-1" });
        return { orderId: "order-1" };
      },
      {
        idempotency: { key: () => "operation-1", store },
        journal: { store: new MemoryOperationJournal() },
        verify: () => {
          order.push("verify");
          return true;
        },
      },
    );

    await expect(guarded({}, active())).resolves.toEqual({
      orderId: "order-1",
    });
    expect(order).toEqual(["execute", "verify", "complete"]);
  });

  it("keeps an unverified effect recoverable instead of completing it", async () => {
    const store = new MemoryIdempotencyStore();
    const journal = new MemoryOperationJournal();
    const execute = vi.fn(async (_input, { operation }) => {
      await operation?.beginEffect({ orderId: "order-1" });
      await operation?.recordEffect({ orderId: "order-1" });
      return { orderId: "order-1" };
    });
    const recover = vi.fn(
      async ({ operation }: { operation?: OperationHandle }) => {
        const correlation = await operation?.read<{ orderId: string }>();
        return correlation
          ? { recovered: true as const, output: correlation }
          : { recovered: false as const, outcome: "unknown" as const };
      },
    );
    const verify = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const events: GuardEvent[] = [];
    const guarded = guard(execute, {
      idempotency: { key: () => "operation-1", store },
      journal: { store: journal },
      recover,
      verify,
      observe: (event) => {
        events.push(event);
      },
    });

    await expect(guarded({}, active())).rejects.toBeInstanceOf(
      VerificationError,
    );
    await expect(guarded({}, active())).resolves.toEqual({
      orderId: "order-1",
    });
    await expect(guarded({}, active())).resolves.toEqual({
      orderId: "order-1",
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
    expect(events.map(({ stage }) => stage)).toEqual(
      expect.arrayContaining([
        "effect_started",
        "effect_observed",
        "recovered",
        "verified",
        "sealed",
      ]),
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
        journal: journal(),
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
      "sealed",
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
  it("waits for a live owner and replays its completed result", async () => {
    const store = new MemoryIdempotencyStore();
    await expect(store.begin("same-operation", active())).resolves.toEqual({
      state: "fresh",
    });
    const second = store.begin<string>("same-operation", active());
    await store.complete("same-operation", "complete", active());
    await expect(second).resolves.toEqual({
      state: "completed",
      value: "complete",
    });
  });

  it("only releases work proven not to have crossed the effect boundary", async () => {
    const store = new MemoryIdempotencyStore();
    await store.begin("retryable", active());
    await store.release("retryable", active());
    await expect(store.begin("retryable", active())).resolves.toEqual({
      state: "fresh",
    });
  });

  it("does not start work for an already-aborted caller", async () => {
    const store = new MemoryIdempotencyStore();
    const controller = new AbortController();
    controller.abort(new Error("already cancelled"));
    await expect(
      store.begin("cancelled", { signal: controller.signal }),
    ).rejects.toThrow("already cancelled");
  });

  it("can clear completed demo state", async () => {
    const store = new MemoryIdempotencyStore();
    await store.begin("operation", active());
    await store.complete("operation", "complete", active());
    store.clear();
    await expect(store.begin("operation", active())).resolves.toEqual({
      state: "fresh",
    });
  });

  it("lets a duplicate caller stop waiting without cancelling owner work", async () => {
    const store = new MemoryIdempotencyStore();
    const controller = new AbortController();
    await store.begin("same-operation", active());
    const second = store.begin("same-operation", {
      signal: controller.signal,
    });
    controller.abort(new Error("caller stopped waiting"));
    await expect(second).rejects.toThrow("caller stopped waiting");
    await expect(
      store.complete("same-operation", "complete", active()),
    ).resolves.toBeUndefined();
  });
});

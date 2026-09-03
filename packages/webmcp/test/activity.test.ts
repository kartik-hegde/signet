import { describe, expect, it, vi } from "vitest";

import {
  createSignett,
  createSignettActivity,
  type GuardEvent,
  type GuardObserver,
  type SignettInterface,
} from "../src/index.js";
import { createSignettActivityStore } from "../src/activity.js";
import { createWebMcpTestHarness } from "../src/testing.js";

function event(
  invocationId: string,
  name: string,
  stage: GuardEvent["stage"],
  durationMs: number,
): GuardEvent {
  return {
    invocationId,
    name,
    stage,
    durationMs,
    timestamp: 1_000 + durationMs,
  };
}

describe("Signett activity", () => {
  it("projects guard stages into UI-safe operation state", () => {
    const store = createSignettActivityStore();
    const notify = vi.fn();
    store.subscribe(notify);

    void store.observe(event("call-1", "place_order", "registering", 0));
    expect(store.getSnapshot().latest).toBeUndefined();

    void store.observe(event("call-1", "place_order", "started", 0));
    expect(store.getSnapshot().latest).toMatchObject({
      phase: "running",
      verified: false,
      resolution: undefined,
    });

    void store.observe(
      event("call-1", "place_order", "confirmation_requested", 4),
    );
    expect(store.getSnapshot().latest?.phase).toBe("awaiting_confirmation");

    void store.observe(event("call-1", "place_order", "executed", 12));
    expect(store.getSnapshot().latest).toMatchObject({
      phase: "verifying",
      resolution: "executed",
      verified: false,
    });

    void store.observe(event("call-1", "place_order", "verified", 18));
    void store.observe(event("call-1", "place_order", "succeeded", 19));
    expect(store.getSnapshot().latest).toEqual({
      invocationId: "call-1",
      name: "place_order",
      phase: "succeeded",
      startedAt: 1_000,
      updatedAt: 1_019,
      durationMs: 19,
      verified: true,
      resolution: "executed",
    });
    expect(notify).toHaveBeenCalledTimes(5);
  });

  it("retains a bounded, optionally tool-specific feed", () => {
    const store = createSignettActivityStore({
      toolName: "place_order",
      maxInvocations: 2,
    });

    void store.observe(event("search-1", "search_products", "started", 0));
    void store.observe(event("order-1", "place_order", "started", 1));
    void store.observe(event("order-2", "place_order", "replayed", 2));
    void store.observe(event("order-3", "place_order", "recovered", 3));

    expect(store.getSnapshot().invocations).toEqual([
      expect.objectContaining({
        invocationId: "order-3",
        resolution: "recovered",
      }),
      expect.objectContaining({
        invocationId: "order-2",
        resolution: "replayed",
      }),
    ]);
  });

  it("keeps a user decline distinct from an execution failure", () => {
    const store = createSignettActivityStore();

    void store.observe(event("declined", "place_order", "declined", 2));
    void store.observe(event("declined", "place_order", "failed", 3));
    expect(store.getSnapshot().latest?.phase).toBe("declined");

    void store.observe(event("failed", "place_order", "failed", 3));
    expect(store.getSnapshot().latest?.phase).toBe("failed");
  });

  it("retains declined after the guard emits its terminal failure", async () => {
    const harness = createWebMcpTestHarness();
    const signett = createSignett({ modelContext: harness.modelContext });
    const activity = createSignettActivity(signett, {
      toolName: "place_order",
    });
    await signett.expose({
      name: "place_order",
      description: "Place one reviewed order.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      confirm: () => false,
      execute: () => "placed",
    });

    await expect(harness.invoke("place_order", {})).rejects.toMatchObject({
      code: "confirmation_declined",
    });
    expect(activity.getSnapshot().latest?.phase).toBe("declined");
    activity.dispose();
  });

  it("keeps latest ordered by start and represents later recovery separately", () => {
    const store = createSignettActivityStore();

    void store.observe(event("order-1", "place_order", "started", 0));
    void store.observe(event("search-1", "search_products", "started", 1));
    void store.observe(event("order-1", "place_order", "outcome_unknown", 8));

    expect(store.getSnapshot().latest?.invocationId).toBe("search-1");
    expect(store.getSnapshot().invocations[1]).toMatchObject({
      invocationId: "order-1",
      phase: "unknown",
    });

    void store.observe(event("order-2", "place_order", "started", 9));
    void store.observe(event("order-2", "place_order", "recovered", 11));
    void store.observe(event("order-2", "place_order", "verified", 12));
    void store.observe(event("order-2", "place_order", "succeeded", 13));

    expect(store.getSnapshot().latest).toMatchObject({
      invocationId: "order-2",
      phase: "succeeded",
      resolution: "recovered",
      verified: true,
    });
  });

  it("attaches and disposes without changing execution behavior", () => {
    const observers = new Set<GuardObserver>();
    const signett: SignettInterface<undefined> = {
      expose: () => Promise.reject(new Error("not used in this test")),
      tools: () => [],
      observe(observer: GuardObserver) {
        observers.add(observer);
        return () => {
          observers.delete(observer);
        };
      },
    };
    const activity = createSignettActivity(signett);
    const notify = vi.fn();
    activity.subscribe(notify);

    for (const observer of observers) {
      void observer(event("call-1", "place_order", "outcome_unknown", 8));
    }
    expect(activity.getSnapshot().latest?.phase).toBe("unknown");
    expect(notify).toHaveBeenCalledOnce();

    activity.dispose();
    activity.dispose();
    expect(observers).toHaveLength(0);
  });

  it("rejects invalid retention options", () => {
    expect(() => createSignettActivityStore({ maxInvocations: 0 })).toThrow(
      "maxInvocations must be a positive integer",
    );
    expect(() => createSignettActivityStore({ toolName: "" })).toThrow(
      "toolName must not be empty",
    );
  });
});

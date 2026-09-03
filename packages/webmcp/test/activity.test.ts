import { describe, expect, it, vi } from "vitest";

import {
  createSignetActivity,
  type GuardEvent,
  type GuardObserver,
  type SignetInterface,
} from "../src/index.js";
import { createSignetActivityStore } from "../src/activity.js";

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

describe("Signet activity", () => {
  it("projects guard stages into UI-safe operation state", () => {
    const store = createSignetActivityStore();
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
    const store = createSignetActivityStore({
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

  it("attaches and disposes without changing execution behavior", () => {
    const observers = new Set<GuardObserver>();
    const signet: SignetInterface<undefined> = {
      expose: () => Promise.reject(new Error("not used in this test")),
      tools: () => [],
      observe(observer: GuardObserver) {
        observers.add(observer);
        return () => {
          observers.delete(observer);
        };
      },
    };
    const activity = createSignetActivity(signet);
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
    expect(() => createSignetActivityStore({ maxInvocations: 0 })).toThrow(
      "maxInvocations must be a positive integer",
    );
    expect(() => createSignetActivityStore({ toolName: "" })).toThrow(
      "toolName must not be empty",
    );
  });
});

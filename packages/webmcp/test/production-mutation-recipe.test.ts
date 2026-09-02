import { describe, expect, it, vi } from "vitest";

import { exposeCancelOrder } from "../recipes/production-mutation.js";
import { assertToolReady } from "../src/index.js";
import {
  createWebMcpTestHarness,
  MemoryIdempotencyStore,
  MemoryOperationJournal,
} from "../src/testing.js";

describe("production mutation recipe", () => {
  it("exposes a readiness-clean tool through the public test harness", async () => {
    const harness = createWebMcpTestHarness();
    let order: {
      id: string;
      accountId: string;
      status: "open" | "cancelled" | "shipped";
      cancellationReason?: "customer_request" | "duplicate";
    } = {
      id: "order-1",
      accountId: "account-1",
      status: "open",
    };
    const cancelOrder = vi.fn(
      async (input: {
        orderId: string;
        reason: "customer_request" | "duplicate";
      }) => {
        order = {
          ...order,
          id: input.orderId,
          status: "cancelled",
          cancellationReason: input.reason,
        };
        return order;
      },
    );

    const registration = await exposeCancelOrder({
      modelContext: harness.modelContext,
      operationStore: new MemoryIdempotencyStore(),
      operationJournal: new MemoryOperationJournal(),
      getSession: async () => ({
        accountId: "account-1",
        scopes: ["orders:cancel"],
      }),
      getOrder: async () => order,
      cancelOrder: (input) => cancelOrder(input),
    });

    const [tool] = harness.tools();
    expect(tool).toBeDefined();
    expect(() => assertToolReady(tool!)).not.toThrow();

    await expect(
      harness.invoke("cancel_order", {
        orderId: "order-1",
        reason: "customer_request",
        operationId: "cancel-order-1",
      }),
    ).resolves.toMatchObject({
      id: "order-1",
      status: "cancelled",
      cancellationReason: "customer_request",
    });
    expect(cancelOrder).toHaveBeenCalledOnce();

    registration.dispose();
    expect(harness.tools()).toEqual([]);
  });
});

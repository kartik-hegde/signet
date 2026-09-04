import { createSignett } from "signett";

const discoverySchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
};

const cancellationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["orderId", "reason", "requestId"],
  properties: {
    orderId: { type: "string", pattern: "^order-[0-9]{3}$" },
    reason: {
      type: "string",
      enum: ["customer_request", "duplicate", "fraud"],
    },
    requestId: { type: "string", pattern: "^[A-Za-z0-9-]{1,64}$" },
  },
};

export async function makeAgentReady(app) {
  const signett = createSignett({
    modelContext: app.modelContext,
    context: app.getSession,
    observe: app.observe,
  });

  const discovery = await signett.expose({
    name: "orders.find_cancellable",
    description:
      "Find recent orders for the signed-in customer and show which orders are cancellable.",
    inputSchema: discoverySchema,
    annotations: { readOnlyHint: true },
    authorize: ({ context }) => context.scopes.includes("orders:read"),
    execute: (_input, { context, signal }) =>
      app.service.listOrders({ principalId: context.principalId }, { signal }),
  });

  const cancellation = await signett.expose({
    name: "orders.cancel",
    description:
      "Cancel an eligible order for the signed-in customer exactly once using a request identifier.",
    inputSchema: cancellationSchema,
    authorize: ({ context }) => context.scopes.includes("orders:cancel"),
    idempotency: {
      key: ({ input, context }) =>
        [
          context.principalId,
          input.requestId,
          input.orderId,
          input.reason,
        ].join(":"),
      store: app.operationStore,
    },
    journal: { store: app.operationStore },
    execute: (input, { context, signal }) =>
      app.service.cancelOrder(
        { orderId: input.orderId, reason: input.reason },
        { principalId: context.principalId, signal },
      ),
    recover: async ({ input, context, signal }) => {
      const order = await app.service.getOrder(input.orderId, { signal });
      return order?.status === "cancelled" &&
        order.cancellation?.reason === input.reason &&
        order.cancellation?.principalId === context.principalId
        ? { recovered: true, output: order }
        : { recovered: false };
    },
    verify: async ({ input, context, signal }) => {
      const order = await app.service.getOrder(input.orderId, { signal });
      return (
        order?.status === "cancelled" &&
        order.cancellation?.reason === input.reason &&
        order.cancellation?.principalId === context.principalId
      );
    },
  });

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      discovery.dispose();
      cancellation.dispose();
    },
  };
}

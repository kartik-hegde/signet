import { createSignett } from "signett";

const inputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["orderId", "reason", "operationId"],
  properties: {
    orderId: { type: "string", pattern: "^order-[0-9]{3}$" },
    reason: {
      type: "string",
      enum: ["customer_request", "duplicate", "fraud"],
    },
    operationId: { type: "string", pattern: "^op-[A-Za-z0-9-]{1,64}$" },
  },
};

export async function registerCancelOrder({
  modelContext,
  service,
  getSession,
  idempotencyStore,
  observe,
}) {
  const signett = createSignett({ modelContext, context: getSession, observe });
  return signett.expose({
    name: "cancel_order",
    description:
      "Cancel a confirmed customer order with production safety controls.",
    inputSchema,
    authorize: ({ context }) => context.scopes.includes("orders:cancel"),
    idempotency: {
      key: ({ input, context }) =>
        [
          context.principalId,
          input.operationId,
          input.orderId,
          input.reason,
        ].join(":"),
      store: idempotencyStore,
    },
    journal: { store: idempotencyStore },
    execute: (input, { context, signal }) =>
      service.cancelOrder(input, { principalId: context.principalId, signal }),
    verify: async ({ input, context }) => {
      const order = await service.getOrder(input.orderId);
      return (
        order?.status === "cancelled" &&
        order.cancellation?.reason === input.reason &&
        order.cancellation?.principalId === context.principalId
      );
    },
  });
}

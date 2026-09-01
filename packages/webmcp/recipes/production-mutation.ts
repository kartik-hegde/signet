import {
  ToolError,
  createSignet,
  type GuardObserver,
  type IdempotencyStore,
  type ModelContextLike,
  type OperationJournal,
} from "@signet/webmcp";

type Session = {
  accountId: string;
  scopes: string[];
};

type CancelOrderInput = {
  orderId: string;
  reason: "customer_request" | "duplicate";
  operationId: string;
};

type Order = {
  id: string;
  accountId: string;
  status: "open" | "cancelled" | "shipped";
  cancellationReason?: CancelOrderInput["reason"];
};

export interface CancelOrderDependencies {
  modelContext?: ModelContextLike;
  operationStore: IdempotencyStore;
  operationJournal: OperationJournal;
  observe?: GuardObserver;
  getSession(options: { signal: AbortSignal }): Promise<Session>;
  getOrder(
    orderId: string,
    options: { signal: AbortSignal },
  ): Promise<Order | null>;
  cancelOrder(
    input: Pick<CancelOrderInput, "orderId" | "reason">,
    options: { accountId: string; signal: AbortSignal },
  ): Promise<Order>;
}

/** Copy this boundary and replace the order-specific application functions. */
export async function exposeCancelOrder(dependencies: CancelOrderDependencies) {
  const signet = createSignet<Session>({
    ...(dependencies.modelContext
      ? { modelContext: dependencies.modelContext }
      : {}),
    context: ({ signal }) => dependencies.getSession({ signal }),
    ...(dependencies.observe ? { observe: dependencies.observe } : {}),
  });

  return await signet.expose<CancelOrderInput, Order>({
    name: "cancel_order",
    description: "Cancel one unshipped order for the signed-in account.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string", minLength: 1 },
        reason: { enum: ["customer_request", "duplicate"] },
        operationId: { type: "string", minLength: 1, maxLength: 64 },
      },
      required: ["orderId", "reason", "operationId"],
      additionalProperties: false,
    },
    // Authorization is re-evaluated before replay. Keep mutable eligibility checks,
    // such as open versus already cancelled, inside execute.
    authorize: ({ context }) => context.scopes.includes("orders:cancel"),
    idempotency: {
      store: dependencies.operationStore,
      key: ({ input, context }) =>
        [
          context.accountId,
          input.operationId,
          input.orderId,
          input.reason,
          "cancel",
        ].join(":"),
    },
    journal: { store: dependencies.operationJournal },
    execute: async ({ orderId, reason }, { context, operation, signal }) => {
      const order = await dependencies.getOrder(orderId, { signal });
      if (order?.status === "shipped") {
        throw new ToolError({
          code: "order_already_shipped",
          message: "Shipped orders cannot be cancelled.",
          retryable: false,
        });
      }
      await operation?.write({ orderId });
      return dependencies.cancelOrder(
        { orderId, reason },
        { accountId: context.accountId, signal },
      );
    },
    recover: async ({ input, context, signal }) => {
      const order = await dependencies.getOrder(input.orderId, { signal });
      return matchesRequestedOutcome(order, input, context)
        ? { recovered: true, output: order }
        : { recovered: false };
    },
    verify: async ({ input, context, signal }) => {
      const order = await dependencies.getOrder(input.orderId, { signal });
      return matchesRequestedOutcome(order, input, context);
    },
  });
}

function matchesRequestedOutcome(
  order: Order | null,
  input: CancelOrderInput,
  context: Session,
): order is Order {
  return (
    order?.accountId === context.accountId &&
    order.status === "cancelled" &&
    order.cancellationReason === input.reason
  );
}

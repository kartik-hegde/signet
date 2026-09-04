const schema = {
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
  const controller = new AbortController();
  const emit = (stage, error) => {
    try {
      void Promise.resolve(
        observe({ name: "cancel_order", stage, ...(error ? { error } : {}) }),
      ).catch(() => {});
    } catch {}
  };
  const fail = (message) => {
    throw new Error(message);
  };
  const validate = (input) => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("invalid input");
    if (Object.keys(input).some((key) => !schema.required.includes(key)))
      fail("unknown field");
    if (!schema.required.every((key) => typeof input[key] === "string"))
      fail("missing field");
    if (!/^order-[0-9]{3}$/.test(input.orderId)) fail("invalid orderId");
    if (!schema.properties.reason.enum.includes(input.reason))
      fail("invalid reason");
    if (!/^op-[A-Za-z0-9-]{1,64}$/.test(input.operationId))
      fail("invalid operationId");
  };
  const execute = async (input, { signal }) => {
    signal.throwIfAborted();
    emit("started");
    try {
      validate(input);
      emit("validated");
      const context = await getSession({ signal });
      signal.throwIfAborted();
      if (!context.scopes.includes("orders:cancel")) fail("not authorized");
      emit("authorized");
      const key = [
        context.principalId,
        input.operationId,
        input.orderId,
        input.reason,
      ].join(":");
      const result = await idempotencyStore.execute(
        key,
        () =>
          service.cancelOrder(input, {
            principalId: context.principalId,
            signal,
          }),
        { signal },
      );
      emit(result.replayed ? "replayed" : "executed");
      signal.throwIfAborted();
      const order = await service.getOrder(input.orderId);
      if (
        order?.status !== "cancelled" ||
        order.cancellation?.reason !== input.reason ||
        order.cancellation?.principalId !== context.principalId
      )
        fail("verification failed");
      emit("verified");
      emit("succeeded");
      return result.value;
    } catch (error) {
      emit("failed", error);
      throw error;
    }
  };
  emit("registering");
  try {
    await modelContext.registerTool(
      {
        name: "cancel_order",
        description:
          "Cancel a confirmed customer order with production safety controls.",
        inputSchema: schema,
        execute,
      },
      { signal: controller.signal },
    );
    emit("registered");
  } catch (error) {
    controller.abort();
    emit("registration_failed", error);
    throw error;
  }
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      emit("unregistered");
    },
  };
}

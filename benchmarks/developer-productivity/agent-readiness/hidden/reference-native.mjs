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

const reasons = new Set(["customer_request", "duplicate", "fraud"]);

export async function makeAgentReady(app) {
  const registrations = [];

  const expose = async ({
    name,
    description,
    inputSchema,
    annotations,
    run,
  }) => {
    const controller = new AbortController();
    const emit = (stage, error) => {
      try {
        void Promise.resolve(
          app.observe({
            name,
            stage,
            ...(error === undefined ? {} : { error }),
          }),
        ).catch(() => undefined);
      } catch {}
    };
    emit("registering");
    try {
      await app.modelContext.registerTool(
        { name, description, inputSchema, annotations, execute: run(emit) },
        { signal: controller.signal },
      );
      emit("registered");
    } catch (error) {
      controller.abort();
      emit("registration_failed", error);
      throw error;
    }
    registrations.push({ controller, emit });
  };

  await expose({
    name: "orders.find_cancellable",
    description:
      "Find recent orders for the signed-in customer and show which orders are cancellable.",
    inputSchema: discoverySchema,
    annotations: { readOnlyHint: true },
    run:
      (emit) =>
      async (input, { signal }) => {
        signal.throwIfAborted();
        emit("started");
        try {
          if (
            input === null ||
            typeof input !== "object" ||
            Array.isArray(input) ||
            Object.keys(input).length > 0
          ) {
            throw new Error("invalid discovery input");
          }
          emit("validated");
          const context = await app.getSession({ signal });
          signal.throwIfAborted();
          if (!context.scopes.includes("orders:read")) {
            throw new Error("not authorized to read orders");
          }
          emit("authorized");
          const output = await app.service.listOrders(
            { principalId: context.principalId },
            { signal },
          );
          emit("executed");
          emit("succeeded");
          return output;
        } catch (error) {
          emit("failed", error);
          throw error;
        }
      },
  });

  await expose({
    name: "orders.cancel",
    description:
      "Cancel an eligible order for the signed-in customer exactly once using a request identifier.",
    inputSchema: cancellationSchema,
    run:
      (emit) =>
      async (input, { signal }) => {
        signal.throwIfAborted();
        emit("started");
        try {
          validateCancellation(input);
          emit("validated");
          const context = await app.getSession({ signal });
          signal.throwIfAborted();
          if (!context.scopes.includes("orders:cancel")) {
            throw new Error("not authorized to cancel orders");
          }
          emit("authorized");
          const key = [
            context.principalId,
            input.requestId,
            input.orderId,
            input.reason,
          ].join(":");
          const result = await app.operationStore.execute(
            key,
            async () => {
              try {
                return await app.service.cancelOrder(
                  { orderId: input.orderId, reason: input.reason },
                  { principalId: context.principalId, signal },
                );
              } catch (error) {
                const recovered = await app.service.getOrder(input.orderId, {
                  signal,
                });
                if (
                  recovered?.status === "cancelled" &&
                  recovered.cancellation?.reason === input.reason &&
                  recovered.cancellation?.principalId === context.principalId
                ) {
                  emit("recovered");
                  return recovered;
                }
                throw error;
              }
            },
            { signal },
          );
          emit(result.replayed ? "replayed" : "executed");
          signal.throwIfAborted();
          const order = await app.service.getOrder(input.orderId, { signal });
          if (
            order?.status !== "cancelled" ||
            order.cancellation?.reason !== input.reason ||
            order.cancellation?.principalId !== context.principalId
          ) {
            throw new Error("authoritative verification failed");
          }
          emit("verified");
          emit("succeeded");
          return result.value;
        } catch (error) {
          emit("failed", error);
          throw error;
        }
      },
  });

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { controller, emit } of registrations) {
        controller.abort();
        emit("unregistered");
      }
    },
  };
}

function validateCancellation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("input must be an object");
  }
  if (
    Object.keys(input).length !== 3 ||
    !["orderId", "reason", "requestId"].every((name) =>
      Object.hasOwn(input, name),
    )
  ) {
    throw new Error("input has missing or unknown fields");
  }
  if (!/^order-[0-9]{3}$/.test(input.orderId)) {
    throw new Error("invalid orderId");
  }
  if (!reasons.has(input.reason)) throw new Error("invalid reason");
  if (!/^[A-Za-z0-9-]{1,64}$/.test(input.requestId)) {
    throw new Error("invalid requestId");
  }
}

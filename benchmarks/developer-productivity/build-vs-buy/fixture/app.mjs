import { setTimeout as delay } from "node:timers/promises";

export function createOperationStore() {
  const directOperations = new Map();
  const signettOperations = new Map();
  const claims = new Map();
  const journal = new Map();
  return {
    async execute(key, operation, options) {
      options.signal.throwIfAborted();
      const existing = directOperations.get(key);
      if (existing) return { value: await existing, replayed: true };
      const pending = Promise.resolve().then(operation);
      directOperations.set(key, pending);
      pending.catch(() => directOperations.delete(key));
      return { value: await pending, replayed: false };
    },
    async begin(key, { signal }) {
      signal.throwIfAborted();
      const live = claims.get(key);
      if (live) {
        await live.pending;
        return this.begin(key, { signal });
      }
      const existing = signettOperations.get(key);
      if (existing?.state === "completed") return existing;
      let settle;
      const pending = new Promise((resolve) => {
        settle = resolve;
      });
      claims.set(key, { pending, settle });
      if (!existing) signettOperations.set(key, { state: "in_flight" });
      return { state: existing ? "in_flight" : "fresh" };
    },
    async complete(key, value, { signal }) {
      signal.throwIfAborted();
      signettOperations.set(key, { state: "completed", value });
      claims.get(key)?.settle();
      claims.delete(key);
    },
    async release(key, { signal }) {
      signal.throwIfAborted();
      signettOperations.delete(key);
      claims.get(key)?.settle();
      claims.delete(key);
    },
    async abandon(key, { signal }) {
      signal.throwIfAborted();
      claims.get(key)?.settle();
      claims.delete(key);
    },
    read(key, { signal }) {
      signal.throwIfAborted();
      return journal.get(key);
    },
    write(key, entry, { signal }) {
      signal.throwIfAborted();
      journal.set(key, entry);
    },
    remove(key, { signal }) {
      signal.throwIfAborted();
      journal.delete(key);
    },
  };
}

export function createFixture(options = {}) {
  const orderCount = options.orderCount ?? 12;
  const orders = new Map(
    Array.from({ length: orderCount }, (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return [
        `order-${number}`,
        {
          id: `order-${number}`,
          ownerId: index % 2 === 0 ? "acct-customer" : "acct-other",
          status: "confirmed",
          cancellation: null,
        },
      ];
    }),
  );
  const effects = [];
  const events = [];
  let failBeforeEffect = options.failBeforeEffect ?? 0;
  let registrationFailure = options.registrationFailure ?? false;
  let activeRegistration;

  const session = options.session ?? {
    principalId: "acct-operator",
    scopes: ["orders:cancel"],
  };

  const service = {
    async cancelOrder({ orderId, reason }, { principalId, signal }) {
      signal.throwIfAborted();
      if (options.serviceDelayMs) {
        await delay(options.serviceDelayMs, undefined, { signal });
      }
      if (failBeforeEffect > 0) {
        failBeforeEffect -= 1;
        throw new Error("transient service failure before effect");
      }
      const order = orders.get(orderId);
      if (!order) throw new Error(`unknown order ${orderId}`);
      if (order.status === "cancelled") return structuredClone(order);
      order.status = "cancelled";
      order.cancellation = { reason, principalId };
      effects.push({ orderId, reason, principalId });
      return structuredClone(order);
    },
    async getOrder(orderId) {
      const order = orders.get(orderId);
      if (!order) return null;
      const copy = structuredClone(order);
      if (options.corruptReadback && copy.cancellation) {
        copy.cancellation.reason = "readback-mismatch";
      }
      return copy;
    },
  };

  const modelContext = {
    async registerTool(tool, registrationOptions = {}) {
      if (registrationFailure) {
        registrationFailure = false;
        throw new Error("simulated registration failure");
      }
      activeRegistration = {
        tool,
        signal: registrationOptions.signal,
        exposedTo: registrationOptions.exposedTo,
      };
    },
  };

  const observe = (event) => {
    events.push({
      ...event,
      error: event.error ? String(event.error) : undefined,
    });
    if (options.observerThrows) throw new Error("observer unavailable");
  };

  return {
    modelContext,
    service,
    getSession: async ({ signal }) => {
      signal.throwIfAborted();
      return structuredClone(session);
    },
    idempotencyStore: createOperationStore(),
    observe,
    events,
    effects,
    order(orderId) {
      const value = orders.get(orderId);
      return value ? structuredClone(value) : null;
    },
    registered() {
      return activeRegistration;
    },
    async invoke(input, signal = new AbortController().signal) {
      if (!activeRegistration) throw new Error("no active WebMCP registration");
      if (activeRegistration.signal?.aborted)
        throw new Error("tool registration disposed");
      return activeRegistration.tool.execute(input, { signal });
    },
  };
}

export function validInput(overrides = {}) {
  return {
    orderId: "order-001",
    reason: "customer_request",
    operationId: "op-001",
    ...overrides,
  };
}

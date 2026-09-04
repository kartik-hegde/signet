import { setTimeout as delay } from "node:timers/promises";

export function createOperationStore() {
  const directOperations = new Map();
  const signettOperations = new Map();
  const claims = new Map();
  const journal = new Map();
  return {
    async execute(key, operation, { signal }) {
      signal.throwIfAborted();
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

const initialOrders = [
  {
    id: "order-101",
    ownerId: "acct-alice",
    item: "Trail shoes",
    status: "processing",
    cancellable: true,
    cancellation: null,
  },
  {
    id: "order-102",
    ownerId: "acct-alice",
    item: "Water bottle",
    status: "shipped",
    cancellable: false,
    cancellation: null,
  },
  {
    id: "order-103",
    ownerId: "acct-alice",
    item: "Running socks",
    status: "processing",
    cancellable: true,
    cancellation: null,
  },
  {
    id: "order-201",
    ownerId: "acct-bob",
    item: "Private order",
    status: "processing",
    cancellable: true,
    cancellation: null,
  },
];

export function createPortal(options = {}) {
  const orders = new Map(
    initialOrders.map((order) => [order.id, structuredClone(order)]),
  );
  const effects = [];
  const events = [];
  const registrations = new Map();
  let failBeforeEffect = options.failBeforeEffect ?? 0;
  let loseResponseAfterEffect = options.loseResponseAfterEffect ?? 0;
  const session = options.session ?? {
    principalId: "acct-alice",
    scopes: ["orders:read", "orders:cancel"],
  };

  const service = {
    async listOrders({ principalId }, { signal }) {
      signal.throwIfAborted();
      if (options.serviceDelayMs) {
        await delay(options.serviceDelayMs, undefined, { signal });
      }
      return [...orders.values()]
        .filter((order) => order.ownerId === principalId)
        .map((order) => structuredClone(order));
    },

    async cancelOrder({ orderId, reason }, { principalId, signal }) {
      signal.throwIfAborted();
      if (options.serviceDelayMs) {
        await delay(options.serviceDelayMs, undefined, { signal });
      }
      if (failBeforeEffect > 0) {
        failBeforeEffect -= 1;
        throw new Error("temporary failure before cancellation");
      }
      const order = orders.get(orderId);
      if (!order || order.ownerId !== principalId) {
        throw new Error("order was not found for this customer");
      }
      if (order.status === "cancelled") return structuredClone(order);
      if (!order.cancellable || order.status !== "processing") {
        throw new Error("order is no longer eligible for cancellation");
      }
      order.status = "cancelled";
      order.cancellable = false;
      order.cancellation = { reason, principalId };
      effects.push({ orderId, reason, principalId });
      const result = structuredClone(order);
      if (loseResponseAfterEffect > 0) {
        loseResponseAfterEffect -= 1;
        throw new Error("connection closed after commit");
      }
      return result;
    },

    async getOrder(orderId, { signal } = {}) {
      signal?.throwIfAborted();
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
      if (registrations.has(tool.name)) {
        throw new Error(`duplicate tool name: ${tool.name}`);
      }
      registrations.set(tool.name, {
        tool,
        signal: registrationOptions.signal,
      });
    },
  };

  const observe = (event) => {
    events.push({
      ...event,
      error: event.error === undefined ? undefined : String(event.error),
    });
    if (options.observerThrows) throw new Error("telemetry unavailable");
  };

  const app = {
    modelContext,
    service,
    operationStore: createOperationStore(),
    observe,
    events,
    effects,
    async getSession({ signal }) {
      signal.throwIfAborted();
      return structuredClone(session);
    },
    tools() {
      return [...registrations.values()]
        .filter(({ signal }) => !signal?.aborted)
        .map(({ tool }) => tool);
    },
    async invoke(name, input, signal = new AbortController().signal) {
      const registration = registrations.get(name);
      if (!registration || registration.signal?.aborted) {
        throw new Error(`tool is not available: ${name}`);
      }
      return registration.tool.execute(input, { signal });
    },
    order(orderId) {
      const order = orders.get(orderId);
      return order ? structuredClone(order) : null;
    },
  };

  app.humanUi = {
    async recentOrders(signal = new AbortController().signal) {
      const current = await app.getSession({ signal });
      return service.listOrders(
        { principalId: current.principalId },
        { signal },
      );
    },
    async cancel({ orderId, reason }, signal = new AbortController().signal) {
      const current = await app.getSession({ signal });
      if (!current.scopes.includes("orders:cancel")) {
        throw new Error("customer cannot cancel orders");
      }
      return service.cancelOrder(
        { orderId, reason },
        { principalId: current.principalId, signal },
      );
    },
  };

  return app;
}

export function cancellationInput(overrides = {}) {
  return {
    orderId: "order-101",
    reason: "customer_request",
    requestId: "request-001",
    ...overrides,
  };
}

import { WebStorageOperationJournal, createSignett } from "/signett/index.js";

class MemoryIdempotencyStore {
  #completed = new Map();
  #inFlight = new Set();

  async begin(key) {
    if (this.#completed.has(key)) {
      return { state: "completed", value: this.#completed.get(key) };
    }
    const state = this.#inFlight.has(key) ? "in_flight" : "fresh";
    this.#inFlight.add(key);
    return { state };
  }

  async complete(key, value) {
    this.#inFlight.delete(key);
    this.#completed.set(key, value);
  }

  async release(key) {
    this.#inFlight.delete(key);
  }

  async abandon(key) {
    this.#inFlight.delete(key);
  }
}

installModelContextShim();

window.__signettEvents = [];
const journal = new WebStorageOperationJournal(localStorage, "benchmark:");
const idempotency = new MemoryIdempotencyStore();
const signett = createSignett({
  context: async ({ signal }) => await api("session", {}, signal),
  observe(event) {
    window.__signettEvents.push({
      name: event.name,
      stage: event.stage,
      durationMs: event.durationMs,
      ...(event.error
        ? {
            error: {
              name: event.error.name,
              code: event.error.code,
              message: event.error.message,
            },
          }
        : {}),
    });
  },
});

const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const string = { type: "string", minLength: 1 };

const registrations = [
  expose({
    name: "commerce_search_products",
    description:
      "Search the product catalog. Use this before selecting a product when the prompt gives a description rather than an ID.",
    inputSchema: objectSchema(
      { query: string, maxPrice: { type: "number", minimum: 0 } },
      ["query"],
    ),
    annotations: { readOnlyHint: true },
    execute: ({ query, maxPrice }, { signal }) =>
      api("search_products", { query, maxPrice }, signal),
  }),
  expose({
    name: "commerce_get_cart",
    description: "Read the current cart, item quantities, and total price.",
    inputSchema: objectSchema({}, []),
    annotations: { readOnlyHint: true },
    execute: (_, { signal }) => api("get_cart", {}, signal),
  }),
  expose({
    name: "commerce_add_to_cart",
    description:
      "Add a catalog product to the cart. Quantity must be a positive integer.",
    inputSchema: objectSchema({
      productId: string,
      quantity: { type: "integer", minimum: 1, maximum: 20 },
    }),
    execute: (input, { signal }) => api("add_to_cart", input, signal),
    verify: async ({ output, signal }) => {
      const cart = await api("get_cart", {}, signal);
      return cart.items.some(
        (item) =>
          item.productId === output.productId &&
          item.quantity >= output.quantity,
      );
    },
  }),
  expose({
    name: "commerce_get_order",
    description: "Read an order and its current fulfillment status.",
    inputSchema: objectSchema({ orderId: string }),
    annotations: { readOnlyHint: true },
    execute: (input, { signal }) => api("get_order", input, signal),
  }),
  expose({
    name: "commerce_cancel_order",
    description:
      "Cancel a pending order. Shipped orders cannot be cancelled. Inspect the order first.",
    inputSchema: objectSchema({ orderId: string }),
    authorize: async ({ input, signal }) => {
      const order = await api("get_order", input, signal);
      return {
        allowed: order.status === "pending",
        reason: `Order status is ${order.status}.`,
      };
    },
    confirm: { mode: "effect-only", request: () => true },
    execute: (input, { signal }) => api("cancel_order", input, signal),
    verify: async ({ input, signal }) =>
      (await api("get_order", input, signal)).status === "cancelled",
  }),
  expose({
    name: "issues_search",
    description:
      "Search issues by assignee and status. Omit a filter to search across it.",
    inputSchema: objectSchema(
      { assignee: string, status: { enum: ["open", "closed"] } },
      [],
    ),
    annotations: { readOnlyHint: true },
    execute: (input, { signal }) => api("search_issues", input, signal),
  }),
  expose({
    name: "issues_update",
    description:
      "Update an issue's assignee, labels, or status. Restricted issues are read-only.",
    inputSchema: objectSchema(
      {
        issueId: { type: "integer", minimum: 1 },
        assignee: string,
        labels: { type: "array", items: string, uniqueItems: true },
        status: { enum: ["open", "closed"] },
      },
      ["issueId"],
    ),
    authorize: async ({ input, signal }) => ({
      allowed: !(await api("get_issue", input, signal)).restricted,
      reason: "Restricted issues are read-only.",
    }),
    execute: (input, { signal }) => api("update_issue", input, signal),
  }),
  expose({
    name: "issues_comment",
    description: "Add a comment to a non-restricted issue.",
    inputSchema: objectSchema({
      issueId: { type: "integer", minimum: 1 },
      body: string,
    }),
    authorize: async ({ input, signal }) => ({
      allowed: !(await api("get_issue", input, signal)).restricted,
      reason: "Restricted issues are read-only.",
    }),
    execute: (input, { signal }) => api("comment_issue", input, signal),
  }),
  expose({
    name: "knowledge_search",
    description: "Search knowledge-base article titles and bodies.",
    inputSchema: objectSchema({ query: string }),
    annotations: { readOnlyHint: true },
    execute: (input, { signal }) => api("search_articles", input, signal),
  }),
  expose({
    name: "knowledge_create",
    description:
      "Create one draft article. clientToken must be stable across retries so a lost response cannot create a duplicate.",
    inputSchema: objectSchema({
      title: string,
      body: string,
      clientToken: { type: "string", minLength: 8 },
    }),
    idempotency: {
      key: ({ input }) => `article:${input.clientToken}`,
      store: idempotency,
    },
    journal: {
      key: ({ input }) => `article:${input.clientToken}`,
      store: journal,
    },
    execute: async (input, { operation, signal }) => {
      await operation.write({ clientToken: input.clientToken });
      return await api("create_article", input, signal);
    },
    recover: async ({ input, signal }) => {
      const article = await api(
        "get_article_by_token",
        { clientToken: input.clientToken },
        signal,
      );
      return article
        ? { recovered: true, output: article }
        : { recovered: false, outcome: "unknown" };
    },
    verify: async ({ input, output, signal }) =>
      (
        await api(
          "get_article_by_token",
          { clientToken: input.clientToken },
          signal,
        )
      )?.id === output.id,
  }),
  expose({
    name: "knowledge_publish",
    description: "Publish an existing draft knowledge-base article.",
    inputSchema: objectSchema({ articleId: string }),
    execute: (input, { signal }) => api("publish_article", input, signal),
    verify: async ({ input, signal }) =>
      (await api("get_article", input, signal)).status === "published",
  }),
  expose({
    name: "admin_list_members",
    description: "List workspace members and their current roles.",
    inputSchema: objectSchema({}, []),
    annotations: { readOnlyHint: true },
    execute: (_, { signal }) => api("list_members", {}, signal),
  }),
  expose({
    name: "admin_set_role",
    description:
      "Change a workspace member role. The protected system owner cannot be modified.",
    inputSchema: objectSchema({
      memberId: string,
      role: { enum: ["viewer", "editor", "admin"] },
    }),
    authorize: ({ input, context }) => ({
      allowed: context.role === "admin" && input.memberId !== "member-system",
      reason: "Only admins may change roles; the system owner is protected.",
    }),
    confirm: { mode: "effect-only", request: () => true },
    execute: (input, { signal }) => api("set_role", input, signal),
  }),
];

await Promise.all(registrations);
document.querySelector("#status").textContent =
  `${signett.tools().length} tools registered through Signett.`;

function expose(tool) {
  return signett.expose(tool);
}

async function api(action, input, signal) {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, input }),
    signal,
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(
      payload.message ?? `Fixture action failed (${response.status}).`,
    );
    error.code = payload.code;
    error.retryable = payload.retryable;
    throw error;
  }
  return payload;
}

function installModelContextShim() {
  if (
    document.modelContext &&
    typeof document.modelContext.registerTool === "function" &&
    typeof document.modelContext.getTools === "function" &&
    typeof document.modelContext.executeTool === "function"
  ) {
    return;
  }
  const tools = new Map();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      async registerTool(tool, options = {}) {
        tools.set(tool.name, tool);
        options.signal?.addEventListener(
          "abort",
          () => tools.delete(tool.name),
          { once: true },
        );
      },
      async getTools() {
        return [...tools.values()];
      },
      async executeTool(tool, input, options = {}) {
        return await tool.execute(
          typeof input === "string" ? JSON.parse(input) : input,
          {
            signal: options.signal ?? new AbortController().signal,
          },
        );
      },
    },
  });
}

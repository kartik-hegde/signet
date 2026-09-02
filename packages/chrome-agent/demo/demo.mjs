const cart = new Map();
const catalog = new Map([
  ["notebook", { name: "Softcover notebook", price: 12 }],
  ["pen", { name: "Archival pen", price: 4 }],
]);

const tools = [
  {
    name: "inspect_cart",
    title: "Inspect cart",
    description: "Return the current cart items and total before changing it.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: () => snapshot(),
  },
  {
    name: "add_cart_item",
    title: "Add a cart item",
    description:
      "Add a known catalog SKU and quantity to the current cart, then return the updated cart.",
    inputSchema: {
      type: "object",
      properties: {
        sku: {
          type: "string",
          enum: ["notebook", "pen"],
          description: "A catalog SKU returned by search_catalog.",
        },
        quantity: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "Number of items to add.",
        },
      },
      required: ["sku", "quantity"],
      additionalProperties: false,
    },
    execute: ({ sku, quantity }) => {
      if (!catalog.has(sku)) throw new Error(`Unknown SKU: ${sku}`);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) {
        throw new Error("Quantity must be an integer from 1 through 5.");
      }
      cart.set(sku, (cart.get(sku) ?? 0) + quantity);
      render(`add_cart_item added ${quantity} × ${sku}`);
      return snapshot();
    },
  },
  {
    name: "search_catalog",
    title: "Search catalog",
    description: "List the small product catalog with stable SKUs and prices.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: () => ({
      products: [...catalog].map(([sku, product]) => ({ sku, ...product })),
    }),
  },
];

const fallbackModelContext = {
  async getTools() {
    return tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: JSON.stringify(tool.inputSchema),
      annotations: tool.annotations,
      origin: location.origin,
    }));
  },
  async executeTool(tool, input, options = {}) {
    options.signal?.throwIfAborted();
    const parsedInput = typeof input === "string" ? JSON.parse(input) : input;
    const implementation = tools.find(
      (candidate) => candidate.name === tool.name,
    );
    if (!implementation) throw new Error(`Tool unavailable: ${tool.name}`);
    return JSON.stringify(await implementation.execute(parsedInput, options));
  },
};

if (document.modelContext?.registerTool) {
  await Promise.all(
    tools.map(({ execute, ...definition }) =>
      document.modelContext.registerTool({ ...definition, execute }),
    ),
  );
} else {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: fallbackModelContext,
  });
}

function snapshot() {
  const items = [...cart].map(([sku, quantity]) => {
    const product = catalog.get(sku);
    return {
      sku,
      name: product.name,
      quantity,
      lineTotal: product.price * quantity,
    };
  });
  return {
    items,
    total: items.reduce((sum, item) => sum + item.lineTotal, 0),
    currency: "USD",
  };
}

function render(activity) {
  const current = snapshot();
  document.querySelector("#items").textContent = current.items.length
    ? current.items.map((item) => `${item.quantity} × ${item.name}`).join(", ")
    : "Empty";
  document.querySelector("#total").textContent = `$${current.total.toFixed(2)}`;
  document.querySelector("#activity").textContent = activity;
}

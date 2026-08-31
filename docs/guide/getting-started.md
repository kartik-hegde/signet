# Getting started

Signet is pre-release. The repository is the current distribution while the package
name and first npm release are finalized.

## Run the repository

```sh
git clone https://github.com/kartik-hegde/signet.git
cd signet
npm install
npm run validate
```

For local development, build the package and install its path from your application:

```sh
npm run build
cd ../your-application
npm install ../signet
```

## Register a native tool

Install the official WebMCP declarations in the application:

```sh
npm install --save-dev webmcp-types
```

Add `webmcp-types` to `compilerOptions.types`, then register through the browser API:

```ts
/// <reference types="webmcp-types" />

import { guard, type Execute } from "@signet/webmcp";

type CancelledOrder = {
  orderId: string;
  state: "cancelled";
};

const cancelOrder: Execute<Record<string, unknown>, CancelledOrder> = guard(
  async (input, { signal }) => {
    if (typeof input.orderId !== "string" || input.orderId.length === 0) {
      throw new TypeError("orderId must be a non-empty string");
    }

    const response = await fetch(`/api/orders/${input.orderId}/cancel`, {
      method: "POST",
      signal,
    });
    if (!response.ok)
      throw new Error(`Cancellation failed: ${response.status}`);
    return response.json() as Promise<CancelledOrder>;
  },
  {
    context: () => currentSession(),
    authorize: ({ input, context }) =>
      context.userId === ownerOf(String(input.orderId)),
    idempotency: {
      key: ({ input, context }) =>
        `${context.userId}:${String(input.orderId)}:cancel`,
      store: durableStore,
    },
    verify: ({ output }) => output.state === "cancelled",
  },
);

const registration = new AbortController();

await document.modelContext?.registerTool(
  {
    name: "cancel-order",
    title: "Cancel an order",
    description:
      "Cancels one unfulfilled order owned by the signed-in customer.",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
      additionalProperties: false,
    },
    execute: cancelOrder,
  },
  { signal: registration.signal },
);
```

The official WebMCP callback accepts untrusted records, so the handler validates input
at runtime. The backend must validate and authorize again.

## Choose only the controls you need

Every option is independent:

```ts
// Public read: native WebMCP is enough.
execute: listPublicProducts;

// Authenticated read: context and authorization.
execute: guard(getInvoice, { context, authorize });

// Durable mutation: add idempotency and verification.
execute: guard(cancelOrder, { context, authorize, idempotency, verify });
```

Continue with the [production execution model](./production-webmcp).

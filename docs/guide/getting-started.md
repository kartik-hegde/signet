# Getting started

Signet is pre-release. The repository currently ships production controls and a native
WebMCP reference integration. The definition, exposure, and inspector APIs described on
the home page are the next implementation milestones.

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

## Expose a native WebMCP tool

Install the official declarations:

```sh
npm install --save-dev webmcp-types
```

Add `webmcp-types` to `compilerOptions.types`, validate callback input at runtime, and
register a capability your application already owns:

```ts
/// <reference types="webmcp-types" />

const searchProducts: WebMCP.ToolExecuteCallback = async (
  input,
  { signal },
) => {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) throw new TypeError("query must be a non-empty string");

  const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`, {
    signal,
  });
  if (!response.ok) throw new Error(`Search failed: ${response.status}`);
  return response.json();
};

const registration = new AbortController();

await document.modelContext?.registerTool(
  {
    name: "search_products",
    title: "Search products",
    description:
      "Finds products matching a query and returns stable product IDs.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: searchProducts,
  },
  { signal: registration.signal },
);
```

Abort `registration` when the tool should disappear, such as on logout, navigation,
or component teardown. The backend must still validate and authorize requests.

## Add controls to a consequential action

The implemented `guard()` API wraps an ordinary WebMCP-compatible handler. Add only
the controls the action needs:

```ts
import { guard } from "@signet/webmcp";

// Public read: native WebMCP is enough.
const listProducts = listPublicProducts;

// Authenticated read: resolve context and authorize.
const getInvoice = guard(getInvoiceHandler, { context, authorize });

// Durable mutation: add replay control and verification.
const cancelOrder = guard(cancelOrderHandler, {
  context,
  authorize,
  idempotency,
  verify,
});
```

Use the resulting function as the tool's `execute` callback. Continue with the
[production execution model](./production-webmcp).

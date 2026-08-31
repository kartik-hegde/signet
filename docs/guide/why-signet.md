# Why Signet

WebMCP gives an agent a structured way to reach functionality already present in a web
application. That is a large improvement over reconstructing intent through screenshots,
DOM inspection, clicks, and form filling.

It does not make the underlying operation safe by itself.

## The missing execution boundary

Consider an agent cancelling an order. A valid tool schema does not answer:

- Which signed-in customer caused this invocation?
- Does that customer own this order?
- What happens if the agent repeats the call after a timeout?
- Did the order actually become cancelled?
- Can operators diagnose the outcome without capturing sensitive inputs?

Those are application concerns. They recur around consequential WebMCP handlers, so
Signet gives them one small, consistent execution boundary.

```text
browser agent
    │
    ▼
native WebMCP tool
    │
    ▼
Signet guard
    ├── application context
    ├── authorization
    ├── idempotent execution
    └── outcome verification
    │
    ▼
existing application handler and backend
```

## What Signet is not

Signet is not another protocol. It does not define tools, register them, infer schemas,
authenticate users, or patch unsupported browsers.

Native WebMCP remains visible:

```ts
document.modelContext?.registerTool({
  name: "update-shipping-address",
  description: "Updates the shipping address for an unfulfilled order.",
  inputSchema,
  execute: guard(updateShippingAddress, controls),
});
```

Removing `guard(..., controls)` leaves `updateShippingAddress`. That is an intentional
product constraint, not a temporary omission.

## When to use it

Use Signet when a tool reads authenticated data, mutates durable state, or can be called
more than once with consequences.

For a cheap public read, call the handler directly. Infrastructure should be
proportional to risk.

Next: [get a native tool running with Signet](./getting-started).

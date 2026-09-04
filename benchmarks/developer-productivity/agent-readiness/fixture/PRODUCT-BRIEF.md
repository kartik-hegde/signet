# Product brief: make Acme Orders agent-ready

Acme Orders is an existing order portal. Its human UI already lets the signed-in
customer view recent orders and cancel an eligible order.

Make that workflow useful to agents through native WebMCP:

1. Let an agent find the signed-in customer's recent orders and learn which are
   currently cancellable.
2. Let an agent cancel an eligible order for one of these reasons:
   `customer_request`, `duplicate`, or `fraud`.

The cancellation capability needs `orderId`, `reason`, and a caller-created
`requestId` so that repeating the same logical request cannot create another effect.
Use strict JSON Schemas and useful descriptions. Mark the discovery capability as
read-only. Do not accept user identity or permissions as tool arguments.

The interface must preserve the portal's existing business rules and session. Invalid
input and unauthorized calls must have no effect. Sequential or concurrent repeats
must cancel once. If the cancellation commits but its response is lost, reconcile
against authoritative application state before reporting failure. Confirm successful
results against authoritative state, honor cancellation, emit privacy-safe lifecycle
events through `app.observe`, and return one idempotent `dispose()` function for the
whole interface.

Implement only `agent-interface.mjs`. The application, public checks, and package
files are frozen. Run `node public-tests.mjs` while working. Additional product-level
requirements are evaluated after submission.

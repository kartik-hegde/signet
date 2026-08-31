# OpenTelemetry

The optional adapter maps Signet lifecycle events to spans without configuring a
provider, exporter, collector, endpoint, or sampling policy.

```ts
import { trace } from "@opentelemetry/api";
import { guard } from "@signet/webmcp";
import { openTelemetryObserver } from "@signet/webmcp/opentelemetry";

const tracer = trace.getTracer("storefront");

const execute = guard(cancelOrder, {
  name: "cancel-order",
  observe: openTelemetryObserver(tracer, {
    attributes: { "service.name": "storefront" },
  }),
});
```

## Recorded data

The adapter records:

- invocation ID;
- optional operation name;
- lifecycle stage events and elapsed duration;
- exception details on failure;
- final OpenTelemetry span status.

It does not record handler inputs or outputs.

Attributes use the experimental `signet.*` namespace because WebMCP-specific semantic
conventions are not standardized. Applications own redaction and exporter policy.

Observer delivery is best effort. If audit persistence is legally or operationally
required, write that evidence inside the application's authoritative transaction.

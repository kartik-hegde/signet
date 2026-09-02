# OpenTelemetry

Signet has a dependency-free OTLP/HTTP JSON path for most applications and an adapter
for teams that already run the OpenTelemetry JavaScript SDK.

## Send directly to an OTLP collector

```ts
const signet = createSignet({
  telemetry: {
    otlp: "https://collector.example/v1/traces",
    serviceName: "storefront",
    headers: { Authorization: "Bearer …" },
  },
});
```

That single option batches each tool invocation as a root span with child spans for
validation, authorization, confirmation, execution or replay/recovery, output
measurement, and verification. It works with Jaeger, Grafana Tempo, Honeycomb,
Datadog, and OpenTelemetry Collector endpoints. Export failures are isolated from tool
execution and the queue is bounded.

Use `otlpObserver(...)` directly when you need its `flush()` and `shutdown()` controls,
or `toOtlpJson(...)` when another transport owns delivery.

## Use an existing OpenTelemetry SDK

The optional adapter maps Signet lifecycle events to an application-owned tracer. It
does not configure a provider, exporter, collector, endpoint, or sampling policy.

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

Both paths record:

- invocation ID;
- optional operation name;
- lifecycle stage events and elapsed duration;
- bounded error type, code, and retryability on failure;
- final OpenTelemetry span status.

They do not record handler inputs, outputs, application context, error messages,
stacks, or causes.

Tool identity uses OpenTelemetry GenAI attributes such as `gen_ai.tool.name`.
Signet-specific lifecycle detail uses the `signet.*` namespace. Applications still own
collector access, retention, sampling, and any additional attributes they attach.

Agent hosts may supply a versioned `callerTelemetry` envelope with W3C `traceparent`,
tool-call ID, call sequence, agent identity, and model provider/name. Signet validates
and bounds those values, connects the tool span to that trace, and never passes the
envelope into the application callback. Without it, calls remain complete standalone
traces and receive local sequence numbers.

Observer delivery is best effort. If audit persistence is legally or operationally
required, write that evidence inside the application's authoritative transaction.

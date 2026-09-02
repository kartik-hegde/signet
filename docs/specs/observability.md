# Observability spec: traces, latency, and errors

**Status:** implementation in progress · **Owner:** Signet core · **Scope:** `@signet/webmcp`,
`@signet/eval`, reference fixtures, docs

The first vertical slice is implemented in `@signet/webmcp`: caller correlation,
privacy-safe error classification, trace assembly, OTLP/HTTP JSON export, the
Inspector waterfall, User Timing, and a Jaeger-enabled first-call tutorial. Evaluation
Trial traces, registration spans, incomplete-call expiry, and report aggregation remain
follow-up work.

## Summary

Signet should answer three questions about any agent-facing tool, in development,
in production, and in every evaluation Trial, without the developer writing new
instrumentation:

1. Which tools were called, in what order, and with what outcome?
2. Where did the time go: validation, authorization, confirmation, execution,
   replay, recovery, verification?
3. What failed, how often, and was it the agent, the input, policy, the
   application, or the outcome check?

The answer is **OpenTelemetry, emitted by Signet itself, with no OpenTelemetry SDK
required**:

- **One trace model.** Every invocation becomes a standard OpenTelemetry span tree
  (`execute_tool <name>` with one child span per lifecycle phase) carrying the
  OpenTelemetry GenAI tool semantic conventions plus a small `signet.*` namespace.
  Errors are classified by kind and code, never by message.
- **One wire format.** Signet serializes spans to OTLP/JSON directly. This is a
  ~150-line encoder with zero dependencies, so the browser bundle never carries the
  OpenTelemetry SDK unless the application already uses it.
- **One recommended viewer, many compatible ones.** Jaeger all-in-one is the default
  local UI: one container, native OTLP intake, a waterfall view, and derived
  latency and error-rate panels. Anything that speaks OTLP (Grafana Tempo, Honeycomb,
  Datadog, the OpenTelemetry Collector) works unchanged.
- **Zero-install fallbacks.** The existing Inspector overlay gains a call waterfall,
  and every invocation can appear in the Chrome DevTools Performance panel through
  the User Timing API.
- **Evidence becomes a trace.** `signet eval` will write one OTLP trace per Trial
  next to its Evidence, aggregates per-tool latency and error tables into
  `report.json` and `report.md`, and can stream Trials into a running Jaeger.

Developer cost by situation:

| Situation                              | Developer writes                               |
| -------------------------------------- | ---------------------------------------------- |
| Running `signet eval` (planned)        | nothing                                        |
| Local development with the Inspector   | nothing new (`mountSignetInspector` as today)  |
| Sending live traces to a local Jaeger  | one option: `telemetry: { otlp: url }`         |
| Application already runs OpenTelemetry | the existing `openTelemetryObserver(tracer)`   |
| Production without OpenTelemetry       | nothing; core stays silent and allocation-free |

## Goals

- Traces, latency breakdowns, and error classification for every Signet-guarded
  invocation and registration, available from the moment Signet runs in a
  development or evaluation environment.
- Standard, well-adopted output: OTLP/JSON traces and OpenTelemetry semantic
  conventions, so no Signet-specific viewer is needed.
- No new mandatory dependency in the core package and no default network behavior.
- Evaluation Evidence that a reviewer can open in a trace viewer to see exactly
  what an agent did and how long each tool call took inside the page.
- Replace the ad hoc `window.__signetGuardEvents` bridge in the reference fixture and
  benchmark MCP bridge with one documented capture mechanism.

## Non-goals

- Building a bespoke Signet trace viewer or dashboard. The Inspector waterfall is a
  bounded convenience for the page it runs in, not a product.
- Capturing tool inputs, outputs, application context, or stack traces by default.
- Emitting OpenTelemetry metrics from the browser. Latency and error-rate metrics
  are derived from spans by the viewer or collector (Jaeger Service Performance
  Monitoring, the Collector `spanmetrics` connector) or by `signet eval` reports.
- Distributed context propagation into the application backend. Tracked as a later
  phase; see [Later](#later).
- Shipping or hosting a collector.

## Baseline before implementation

Grounded in the current tree:

- `guard()` emits a `GuardEvent` per lifecycle stage:
  `{ invocationId, name?, stage, timestamp, durationMs, error? }`
  (`packages/webmcp/src/types.ts`, `packages/webmcp/src/guard.ts`). `durationMs`
  is cumulative from invocation start, so phase durations are recoverable by
  differencing consecutive events. When `observe` is absent no IDs or timings are
  allocated, and the performance guide documents that guarantee.
- `createSignet()` fans events out to any number of observers via `signet.observe()`
  and emits `registering | registered | unsupported | registration_failed |
unregistered` for each exposure (`packages/webmcp/src/interface.ts`).
- `openTelemetryObserver(tracer)` maps one invocation to one span with stage span
  events (`packages/webmcp/src/opentelemetry.ts`). It has three gaps: no per-phase
  spans, so viewers show a flat bar; attributes use only `signet.*` rather than the
  GenAI tool conventions, so GenAI-aware viewers do not recognize the span as a tool
  call; and `span.recordException(error)` records the message and stack trace,
  which contradicts the README statement that stack traces are not observed by
  default.
- The Inspector (`packages/webmcp/src/inspector.ts`) lists the last 50 events as a
  flat list with cumulative durations.
- The reference payment fixture records a `{ name, stage, invocationId }` summary
  into `window.__signetGuardEvents` and dispatches a `signet:event` DOM event
  (`fixtures/cypress-realworld-app/src/webmcp/paymentTools.ts`). The benchmark MCP
  bridge scrapes that global after each call and attaches it as `lifecycle` on a
  `webmcp_call` trace event (`benchmarks/agent-effectiveness/mcp-server.mjs`). The
  summary drops timestamps and durations, so in-page latency is not recoverable.
- `signet eval` Trials already carry an ordered `events[]` list with `atMs`
  offsets, a `tool-trace` artifact with per-call round-trip `durationMs`, and a
  `trial.durationMs` (`packages/eval/runner.mjs`, `packages/eval/schemas/
evidence.v1.schema.json`). Runner events mark instants, not intervals.
- Reports aggregate trial-level median and p95 duration and token counts only
  (`packages/eval/report.mjs`).

Everything needed for good traces is being measured somewhere. It is not joined,
not standardized, and not viewable.

## Design

### 1. Trace model

An invocation is one root span. With no caller context it is also a standalone trace.
When an agent host supplies W3C `traceparent`, the invocation span keeps that trace ID
and uses the caller span as its parent, so several ordered tool calls appear inside one
agent workflow trace. Names and attributes follow the OpenTelemetry GenAI semantic
conventions for tool execution (status: development in semconv). Signet-specific
detail lives under `signet.*`.

```text
execute_tool cancel_order                     kind=INTERNAL   status=UNSET|ERROR
├─ signet.validate                            (started → validated)
├─ signet.authorize                           (validated → authorized)
├─ signet.confirm                             (authorized → confirmed | declined)
├─ signet.execute | signet.replay | signet.recover
├─ signet.output                              (→ output_validated | output_oversized | output_unmeasurable)
└─ signet.verify                              (→ verified)
```

Root span attributes:

| Attribute                      | Value                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gen_ai.operation.name`        | `execute_tool`                                                                                                                                                    |
| `gen_ai.tool.name`             | tool name                                                                                                                                                         |
| `gen_ai.tool.call.id`          | actual host tool-call ID, only when supplied                                                                                                                      |
| `gen_ai.tool.type`             | `function`                                                                                                                                                        |
| `signet.invocation.id`         | Signet-local invocation ID                                                                                                                                        |
| `signet.invocation.sequence`   | caller-supplied or locally assigned call order                                                                                                                    |
| `signet.outcome`               | `succeeded` · `replayed` · `recovered` · `denied` · `declined` · `cancelled` · `failed` · `unknown`                                                               |
| `signet.result_source`         | `executed` · `replayed` · `recovered` (when the call reached execution)                                                                                           |
| `signet.output.status`         | `validated` · `oversized` · `unmeasurable` (when measured)                                                                                                        |
| `signet.completed_after_abort` | `true` when a completed handler outran a cancellation                                                                                                             |
| `error.type`                   | error class for Signet errors (`ToolError`, `ValidationError`, `AuthorizationError`, `VerificationError`, `OutcomeUnknownError`, `AbortError`), otherwise `Error` |
| `error.code`                   | `SignetError.code` when present                                                                                                                                   |
| `error.retryable`              | boolean when present                                                                                                                                              |

Phase span attributes: `signet.stage` (the terminal stage of that phase). A phase
that ends in failure carries the same `error.*` attributes and ERROR status as the
root.

Registration will become a separate, short trace: `register_tool <name>` with
`signet.registration.status` ∈ `registered | unsupported | failed | unregistered`.

Resource attributes on every current export include `service.name`
(application-provided, default `signet-webmcp`) plus application-provided resource
attributes. Evaluation will use `signet-eval` as its default.

Timing: root start is the `started` event's wall-clock `timestamp`. Every later
boundary is `start + durationMs` of the corresponding event, so phase widths keep
`performance.now()` precision while absolute placement uses wall-clock time.

### 2. Core event changes (`@signet/webmcp`)

Small, backward-compatible additions to what `guard()` and the interface emit.

1. **Caller correlation envelope.** A versioned, optional `callerTelemetry` envelope
   carries `traceparent`, `tracestate`, the actual host tool-call ID, call sequence,
   agent ID/name/version, and model provider/name. Values are untrusted, bounded to 128
   UTF-8 bytes, and never reach application execution. Trace and span IDs are generated
   independently when the host does not provide a valid parent.
2. **Error classification.** New exported pure function
   `describeError(error): { type: string; code?: string; retryable?: boolean }`
   used by every sink. It reads only class name, `code`, and `retryable`. Messages
   and stacks are never read here.
3. **Trace record assembly.** A tiny `TraceAssembler` folds the ordered
   `GuardEvent` stream for one `invocationId` into one `InvocationTrace`
   `{ traceId, name, startedAt, endedAt, outcome, phases[], error? }`. All sinks
   (OTLP encoder, Inspector, User Timing) consume `InvocationTrace`, so the stage
   arithmetic exists once. Bounded expiry for incomplete invocations is pending.
4. **DevTools hook (pending).** `createSignet()` and `guard()` can later check once for
   `globalThis.__SIGNET_DEVTOOLS_HOOK__`. If it exists and exposes
   `attach({ observe, tools })`, Signet subscribes it exactly like any observer.
   Signet never creates the global. This is the React DevTools pattern: the tool
   installs the hook before the page runs, the library only attaches if asked. Cost
   when absent is one property read per `createSignet()` call and one per
   un-observed `guard()` invocation; nothing is allocated. This is what makes
   evaluation and future browser tooling zero-configuration for application
   developers.

`GuardEvent` adds optional `callerTelemetry` on `started`. Existing observers remain
source-compatible.

### 3. Sinks (`@signet/webmcp/opentelemetry`, `@signet/webmcp/inspector`)

All sinks are opt-in, isolated from execution, and drop rather than block.

**`toOtlpJson(traces: InvocationTrace[], options): OtlpExportTraceServiceRequest`**
A dependency-free encoder to the OTLP/JSON `ExportTraceServiceRequest` shape
(`resourceSpans[].scopeSpans[].spans[]`, nanosecond string timestamps, typed
`attributes[].value`). Exported for tests, the Inspector, and `@signet/eval`.

**`otlpObserver({ url, headers?, resource?, serviceName?, flushIntervalMs = 1000, maxQueue = 100 }): OtlpObserver`**
Batches finished traces and `POST`s OTLP/JSON to `url` (for example
`http://localhost:4318/v1/traces`) using `fetch` with `keepalive: true`. Flushes on
interval, on batch size, and on `pagehide` where it exists. All
failures are swallowed; the queue is bounded. Also usable as
`createSignet({ telemetry: { otlp: url } })`, which is sugar for adding this
observer.

**`openTelemetryObserver(tracer, options)` upgrades** for applications that already
run the OpenTelemetry SDK: GenAI attributes, `span.setStatus` with bounded error
attributes, no exception message/stack capture, and correct closure of unknown-outcome
spans. Existing call sites keep working; span names change from `webmcp <name>` to
`execute_tool <name>`, noted as a breaking change for the pre-release adapter. Phase
child spans for this adapter remain follow-up work; the dependency-free OTLP path
already emits them.

**Inspector additions.** A "Calls" section above "Lifecycle": one row per
invocation showing tool name, outcome badge, total milliseconds, a proportional
phase bar, and `error.type`/code when present; expanding a row lists the phases.
A future "Copy OTLP JSON" control can put buffered traces on the clipboard. With
`userTiming: true` (default when the Inspector is
mounted) each finished invocation calls `performance.measure("execute_tool <name>",
{ start, end, detail: { outcome } })`, so the Chrome DevTools Performance panel
shows Signet calls in its Timings track next to network and rendering work with no
extra software. The Inspector remains dependency-free and captures no values.

### 4. Evaluation traces (`@signet/eval`)

The runner controls the whole Trial, so this path needs nothing from the
application developer.

**Trial trace shape.** One trace per Trial with the Trial as root:

```text
trial pay-lia-reference #3 · signet-baseline            signet.eval.case.id, trial.index, condition, status, oracle.safeSuccess…
├─ application.reset
├─ oracle.snapshot (before)
├─ browser.open
├─ browser.inventory                                    signet.eval.inventory.count
├─ agent.run                                            gen_ai.provider.name, gen_ai.request.model, gen_ai.usage.*
│  ├─ ui_inspection
│  ├─ webmcp_call search_payment_users                  round trip measured by the MCP bridge; ok/error
│  │  └─ execute_tool search_payment_users              in-page Signet span captured through the hook
│  │     ├─ signet.validate
│  │     └─ signet.execute
│  └─ webmcp_call send_payment
│     └─ execute_tool send_payment
│        ├─ signet.validate … signet.verify
├─ oracle.snapshot (after)
└─ oracle.grade                                          authoritativeSuccess, safeSuccess, forbiddenEffects
```

Changes:

1. **Runner intervals.** `runTrial` measures each awaited adapter phase and emits
   `durationMs` and `startedAtMs` on the existing event types. Evidence schema v1
   allows extra event properties, so no schema bump.
2. **In-page capture through the hook.** The payment browser adapter installs a
   buffering `__SIGNET_DEVTOOLS_HOOK__` via `Page.addScriptToEvaluateOnNewDocument`
   before navigation and again on connect. The buffer keeps full `GuardEvent`
   metadata (stage, timestamp, durationMs, classified error) keyed by invocation ID,
   bounded to the last 500 events. The MCP bridge reads new records after each
   `webmcp_call` exactly as it reads `__signetGuardEvents` today and stores them
   under `lifecycle`; the fixture's `recordGuardEvent`, `window.__signetGuardEvents`,
   and the `signet:event` DOM event are removed. An optional browser-adapter method
   `collectTraces({ session })` exposes the same buffer for adapters that are not
   the MCP bridge.
3. **Trace artifact.** After grading, the runner builds the span tree from
   `events[]`, the agent's `tool-trace`, and in-page records, re-parenting each
   `execute_tool` span under the `webmcp_call` that produced it (matched by
   invocation IDs collected during that call's window). It writes
   `<trial>.trace.otlp.json` and records `{ kind: "otlp-trace", mediaType:
"application/json" }` in `artifacts`. Encoding reuses the same `toOtlpJson`
   from `@signet/webmcp/opentelemetry` (a workspace import; `@signet/eval` has
   no runtime dependencies today, so this is added as a regular dependency on the
   sibling package and the encoder stays SDK-free).
4. **Report aggregates.** `report.json` gains `tools`: per tool name per condition,
   `calls`, `errors`, `errorsByType` (`error.type` and `signet.error.code`),
   round-trip `p50/p95/max`, in-page `p50/p95/max`, and mean phase breakdown.
   `report.md` gains a "Tool latency and errors" table. `signet check` is
   unchanged; per-tool gates are a possible later flag.
5. **Live streaming.** `signet eval --otlp-endpoint <url>` POSTs each Trial trace as
   it completes, so a developer watching Jaeger sees Trials arrive.
   `signet trace push <file|dir> --endpoint <url>` sends already-written traces.
6. **CI.** The nightly workflow uploads `**/*.trace.otlp.json` with the existing
   evidence artifact. Traces stay under ignored `raw/` paths; `evidence/README.md`
   already forbids publishing them unreviewed.

### 5. Visualization

**Recommended: Jaeger all-in-one.** Well adopted, one container, native OTLP/HTTP on
4318, a waterfall UI on 16686, and a Monitor tab that derives per-operation request
rate, error rate, and latency percentiles from spans.

```sh
npm run trace:ui      # docker run … jaegertracing/jaeger:2 --config tooling/observability/jaeger.yaml
```

The checked-in config enables CORS for `http://localhost:*` on the OTLP receiver so
a browser page can export directly, and enables span-metrics for the Monitor tab.
Then, in the application under development:

```ts
const signet = createSignet({
  telemetry: { otlp: "http://localhost:4318/v1/traces" },
});
```

or, for an evaluation:

```sh
signet eval fixtures/cypress-realworld-app/eval/index.mjs --otlp-endpoint http://localhost:4318/v1/traces
```

Compatible alternatives, documented but not scripted: Grafana Tempo or the
`grafana/otel-lgtm` image, Honeycomb, Datadog, or any OpenTelemetry Collector
pipeline. Offline, `.trace.otlp.json` files can be pushed with `signet trace push`;
recent Jaeger UI releases also accept OTLP JSON through the upload control (to be
confirmed during phase 2; if not, `push` is the documented path).

**Zero-install:** the Inspector call waterfall and the Chrome DevTools Performance
panel via User Timing, both described above.

### 6. Privacy and redaction

Default exports contain: tool name, invocation ID, stages, timings,
outcome, error class, error code, retryable flag, and resource attributes. They never
contain input, output, application context, idempotency keys, error messages, or
stack traces. `ToolError.details`, `ValidationError.issues`, and confirmation
payloads are excluded; only `signet.validation.issue_count` is recorded for
validation failures.

Opt-in `redaction` on each sink widens this deliberately:
`{ errorMessages?: boolean; toolDescription?: boolean }`. Anything beyond that is
an application concern implemented in a custom observer.

The production checklist item "Keep inputs and outputs out of default telemetry"
becomes verifiable by a test that serializes a failing invocation with a sensitive
input and asserts the OTLP payload contains none of it.

### 7. Developer experience by persona

- **Application developer, first day.** Runs the app with `mountSignetInspector`.
  Sees each agent call as a bar with phases and outcome. Opens DevTools Performance
  and sees the same calls in the Timings track. Writes nothing new.
- **Application developer, tuning latency or errors.** Starts a local Jaeger container,
  adds `telemetry: { otlp }` to `createSignet`, and reads Jaeger's waterfall. One
  option.
- **Team already on OpenTelemetry.** Keeps `openTelemetryObserver(tracer)`; gains
  phase spans and GenAI attributes on upgrade.
- **Evaluation author or reviewer (planned).** Runs `signet eval`. Every Trial folder has a
  trace file; `report.md` shows per-tool latency and error tables; with
  `--otlp-endpoint` the run is watchable live. Writes nothing new.

## Design-contract check

Against `docs/design.md`:

- **Native-first, ejectable.** Output is standard OTLP with standard conventions.
  Removing Signet leaves the viewer, the dashboards, and the mental model intact.
- **Inspectable.** Adds the missing "calls and latency" view the contract promises.
- **Private by default.** No values, no messages, no stacks unless opted in. The
  hook attaches only to a global that a tool installed first, so it is not an
  implicit global patch. No network happens without a URL.
- **Zero core runtime dependencies.** The encoder and exporter use `fetch` and
  `JSON`. The OpenTelemetry SDK remains an optional peer for the adapter path.
- **Observer failures never change behavior.** Every sink swallows errors and bounds
  memory.
- **Conditions for a new abstraction.** `toOtlpJson`/`otlpObserver` remove a
  repeated defect (ad hoc lifecycle scraping in the fixture and bridge) and enable
  inspection and testing. Removal story: delete the entry point; `GuardEvent` and
  `observe` remain the primitive. The hook is narrower than the concern it
  coordinates and has an obvious removal path.

The performance guide's promise that nothing is allocated without an observer holds.
The exporter exists only when `telemetry` is configured; the Inspector and explicit
observers remain opt-in.

## Testing

- **Encoder golden tests.** Fixed `GuardEvent` sequences (success, replay,
  recovery, declined, validation failure, tool error, outcome unknown, abort,
  completed after abort) encode to checked-in OTLP/JSON fixtures. Assertions cover
  nesting, non-overlapping phases, status codes, attribute table, and absence of
  input/output/message/stack strings.
- **Exporter tests.** Batching, bounded queue, failure swallowing, flush on
  `pagehide`, no request when the queue is empty.
- **Hook tests.** Attach when present, no-op when absent, no allocation when absent
  (existing performance tests extended).
- **Adapter tests.** `openTelemetryObserver` against the in-memory span exporter
  from `@opentelemetry/sdk-trace-base` (dev dependency only): child spans, status,
  no exception event by default.
- **Inspector tests.** Rows render from traces; clipboard payload equals encoder
  output; User Timing measures are created when enabled.
- **Eval tests.** `runTrial` writes a valid trace artifact whose parents all exist
  and whose spans nest inside the Trial; report aggregates match hand-computed
  values; `--otlp-endpoint` posts once per Trial to a local test server.
- **Reference fixture.** Cypress WebMCP suite asserts the hook receives lifecycle
  records with durations, replacing the `__signetGuardEvents` assertions.
- **Manual acceptance.** Run `npm run trace:ui`, then a payment evaluation with
  `--otlp-endpoint`, and confirm each Trial appears in Jaeger with nested tool
  spans and the Monitor tab shows per-tool latency. Not part of PR CI.

## Rollout

| Phase | Status  | Deliverable                                                                                                                                                                         | Validation                            |
| ----: | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
|     1 | Done    | Caller envelope, `describeError`, trace assembler, `toOtlpJson`, `otlpObserver`, `telemetry.otlp`, adapter privacy/status fixes                                                     | `npm run validate`                    |
|     2 | Done    | Inspector waterfall, User Timing, Jaeger-enabled hello-world tutorial, reference/API docs                                                                                           | tutorial test/build, docs build       |
|     3 | Pending | Trial root spans, hook-based in-page capture for evaluation, trace artifacts, per-tool report tables, `--otlp-endpoint`, replacement of the reference fixture's ad hoc event bridge | `npm run test:eval`, `test:reference` |
|     4 | Pending | Registration spans, incomplete-invocation expiry, Inspector OTLP copy, optional local trace UI script, per-phase spans in the application-owned SDK adapter                         | focused tests and manual acceptance   |

## Later

- **Backend correlation.** Expose `traceparent` for the current invocation to
  `execute` (for example `options.trace?.traceparent`) so application fetches can
  join the tool span to server spans. Deferred until a real integration asks;
  adding it is additive.
- **Per-tool regression gates.** `signet check --max-tool-p95-ratio` once the
  report aggregates have baselines.
- **Browser extension or DevTools panel.** The hook is the attachment point; no
  core change would be needed.

## Open questions

1. Hook name: `__SIGNET_DEVTOOLS_HOOK__` follows precedent; confirm before phase 1
   since tooling will depend on it.
2. Confirm which Jaeger UI versions accept OTLP JSON through file upload; otherwise
   `signet trace push` is the only offline path and docs say so.
3. Whether `@signet/eval` should depend on `@signet/webmcp` for the encoder or
   vendor the ~150 lines to keep the CLI dependency-free. Recommendation: depend;
   one implementation.
4. Span name for the pre-release adapter changes from `webmcp <name>` to
   `execute_tool <name>`. Accept as a documented breaking change, or keep the old
   name behind `spanName` only.

## Appendix: example OTLP/JSON payload

One successful `cancel_order` call with two phases, trimmed:

```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "storefront" } },
          { "key": "telemetry.sdk.name", "value": { "stringValue": "signet" } }
        ]
      },
      "scopeSpans": [
        {
          "scope": { "name": "@signet/webmcp", "version": "0.0.0" },
          "spans": [
            {
              "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
              "spanId": "00f067aa0ba902b7",
              "name": "execute_tool cancel_order",
              "kind": 1,
              "startTimeUnixNano": "1756771200000000000",
              "endTimeUnixNano": "1756771200412000000",
              "attributes": [
                {
                  "key": "gen_ai.operation.name",
                  "value": { "stringValue": "execute_tool" }
                },
                {
                  "key": "gen_ai.tool.name",
                  "value": { "stringValue": "cancel_order" }
                },
                {
                  "key": "gen_ai.tool.call.id",
                  "value": { "stringValue": "4bf92f3577b34da6a3ce929d0e0e4736" }
                },
                {
                  "key": "signet.outcome",
                  "value": { "stringValue": "succeeded" }
                },
                {
                  "key": "signet.result_source",
                  "value": { "stringValue": "executed" }
                }
              ],
              "status": { "code": 1 }
            },
            {
              "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
              "spanId": "53995c3f42cd8ad8",
              "parentSpanId": "00f067aa0ba902b7",
              "name": "signet.validate",
              "kind": 1,
              "startTimeUnixNano": "1756771200000000000",
              "endTimeUnixNano": "1756771200003000000",
              "attributes": [
                {
                  "key": "signet.stage",
                  "value": { "stringValue": "validated" }
                }
              ],
              "status": { "code": 0 }
            },
            {
              "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
              "spanId": "8e1b3c2d9f0a7b6c",
              "parentSpanId": "00f067aa0ba902b7",
              "name": "signet.execute",
              "kind": 1,
              "startTimeUnixNano": "1756771200003000000",
              "endTimeUnixNano": "1756771200409000000",
              "attributes": [
                {
                  "key": "signet.stage",
                  "value": { "stringValue": "executed" }
                }
              ],
              "status": { "code": 0 }
            }
          ]
        }
      ]
    }
  ]
}
```

# Ecosystem research and technical choices

Reviewed on 2026-08-30. WebMCP is moving quickly, so links to primary sources are part of the record.

## Standards adopted

### Native WebMCP

The current WebMCP proposal exposes the imperative API at `document.modelContext`. Pages register tools with `registerTool()`, use JSON Schema for inputs, receive an execution `AbortSignal`, and unregister by aborting the registration signal. It is explicitly designed to complement backend MCP rather than replace it.

Sources: [WebMCP explainer](https://github.com/webmachinelearning/webmcp/blob/main/README.md), [living specification](https://webmachinelearning.github.io/webmcp/), [official TypeScript declarations](https://github.com/webmachinelearning/webmcp-types).

Decision: Signet uses the browser surface directly and recommends the official
`webmcp-types` package. A thin exposure helper may coordinate explicit application
lifecycle, but native registration options, signals, and support status must remain
visible.

### JSON Schema

WebMCP accepts an `inputSchema` object but input/output validation remains an active design area in the proposal. JSON Schema Draft 2020-12 is the latest published JSON Schema specification, but Signet does not force a dialect or validator over the browser API.

Sources: [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12), [WebMCP input/output schema discussion](https://github.com/webmachinelearning/webmcp/issues/92).

Decision: applications keep their existing Ajv, Zod, Valibot, or hand-written boundary validation. Signet adds no schema DSL.

### OpenTelemetry

OpenTelemetry's JavaScript trace and metric APIs are stable; browser client instrumentation remains experimental. The API and exporter configuration should remain under the application's control.

Sources: [OpenTelemetry JavaScript status](https://opentelemetry.io/docs/languages/js/), [browser instrumentation guide](https://opentelemetry.io/docs/languages/js/getting-started/browser/).

Decision: an optional adapter accepts an application-provided `Tracer`. Core has no exporter, collector, endpoint, or background telemetry.

## Comparable libraries

### Nekuda `@nekuda/webmcp-sdk` and `webmcp-kit`

The SDK offers `defineTool`, registration helpers, intent/source metadata, tracking, and OpenTelemetry logging. The kit is a coding-agent workflow that plans, implements, and verifies tools in an existing application.

Sources: [SDK](https://www.npmjs.com/package/@nekuda/webmcp-sdk), [webmcp-kit](https://github.com/nekuda-ai/webmcp-kit), [WindTunnel](https://github.com/nekuda-ai/WindTunnel).

Lesson: migration assistance and browser verification are valuable. A definition
helper earns its place only if it stays native-shaped and enables validation,
inspection, or testing beyond a plain object literal. Native WebMCP remains the source
of truth. Unlike the inspected SDK package, Signet has no import-time analytics or
default-on usage reporting.

### MCP-B packages

MCP-B provides WebMCP declarations, a polyfill, browser transports, React hooks, and a bridge to backend MCP. It is useful compatibility infrastructure but is explicitly not the official W3C project.

Source: [WebMCP-org npm packages](https://github.com/WebMCP-org/npm-packages).

Lesson: a polyfill can help local development and custom agent bridges, but it cannot make an unsupported built-in browser agent discover tools. Signet does not make a polyfill part of its production contract.

### `webmcp-sdk`

This community package combines a fluent builder, registry, React helpers, proxying, rate limiting, confirmation, sanitization, payments, mocks, and scoring.

Source: [webmcp-sdk](https://www.npmjs.com/package/webmcp-sdk).

Lesson: breadth makes adoption look easy but obscures which layer owns correctness. Signet will add adapters only from repeated production evidence.

### OpenTiny NEXT SDK

OpenTiny's work spans WebMCP polyfills, bridges, remote browser control, and developer tooling.

Source: [OpenTiny NEXT SDK](https://github.com/opentiny/next-sdk).

Lesson: browser control and native in-page tools solve adjacent fallback paths. Signet
focuses on the application-to-tool workflow and uses browser automation only for
development and compatibility testing.

## Competitive thesis

WebMCP standardizes how a page registers a capability. Signet is useful only if it
makes the full developer loop better: designing the right tools, validating inputs,
managing application-driven availability, inspecting what agents see, testing real
discovery and invocation, and progressively hardening consequential actions.

The defensible product is not a wrapper around `registerTool()` or `execute`. It is the
workflow and evidence accumulated across real integrations: tool-design findings,
lifecycle patterns, conformance and agent-use fixtures, compatibility data, and later
operational controls. The open-source surface should remain small enough that
developers understand it and can leave it.

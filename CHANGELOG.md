# Changelog

All notable changes to `@signet/webmcp` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), with the pre-1.0 caveats
described in [Stability](./README.md#stability).

## [Unreleased]

## [0.0.1] — 2026-08-31

First published release. WebMCP is an experimental browser API and this package is
pre-release: the surface below is usable, but not frozen.

### Added

- `createSignet().expose()` for native `document.modelContext.registerTool()`
  registration, with definition validation, one-time JSON Schema compilation, and
  disposable registrations.
- Runtime input validation with agent-legible `ValidationError` messages that name the
  failing field and constraint so a model can correct its own arguments.
- Execution controls, applied in order: application context, `authorize`, `confirm`,
  idempotent execute or replay, `recover`, and `verify`.
- `ToolError`, `AuthorizationError`, `ConfirmationError`, and `VerificationError`,
  each carrying a stable `code` across the native boundary.
- Cancellation semantics in which a completed handler wins the race against a late
  abort; the outcome is returned and `completed_after_abort` is observable.
- Output budgets (`outputBudgetBytes`) that report `output_oversized` or
  `output_unmeasurable` without discarding a committed effect.
- Lifecycle observation with multiple subscribers, plus `signet.tools()` for the exact
  inventory an agent sees.
- `@signet/webmcp/react` — `useSignetTool`, safe across StrictMode remounts and
  registrations disposed before they resolve.
- `@signet/webmcp/inspector` — a dependency-free, metadata-only overlay of the live
  tool inventory and lifecycle.
- `@signet/webmcp/testing` — a capture-only WebMCP harness, `checkIdempotencyStore`
  conformance checks, and saved-task agent evaluation primitives.
- `@signet/webmcp/opentelemetry` — optional span mapping from lifecycle events.
- Tool readiness diagnostics (`checkToolReadiness`, `assertToolReady`) for naming,
  descriptions, closed schemas, and unbounded agent-controlled input.
- A copyable PostgreSQL idempotency recipe and a full-stack reference application
  covering real mutations, replay, verification, and native Chrome execution.

### Known limitations

- No durable idempotency store ships with the package; applications supply their own.
- Browser-side authorization is not a security boundary. Backends must re-check.
- The consumer side of WebMCP (tool enumeration and invocation) is not yet covered by
  the official type declarations and varies across browser builds.

[unreleased]: https://github.com/kartik-hegde/signet/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/kartik-hegde/signet/releases/tag/v0.0.1

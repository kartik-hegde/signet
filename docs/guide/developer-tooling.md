# Developer tooling

## Framework lifecycle

Import `useSignetTool` from `@signet/webmcp/react`. It exposes a tool for its component
lifetime and serializes same-name teardown and remount, including React StrictMode when
registration is still in flight. It accepts an explicit dependency list.

## Readiness checks

`checkToolReadiness(tool)` returns deterministic diagnostics for ambiguous names and
descriptions, open object schemas, undocumented arguments, unbounded strings or arrays,
missing read-only hints, and invalid output budgets. `assertToolReady(tool)` turns those
diagnostics into one portable test failure. These checks improve definitions; only
real-agent task evaluations measure selection quality.

## Inspector

```ts
import { mountSignetInspector } from "@signet/webmcp/inspector";

const inspector = mountSignetInspector(signet);
// inspector.dispose();
```

The dependency-free browser overlay displays current tool schemas, annotations,
exposure state, and lifecycle timings. It captures no argument or result values and
makes no network requests. Import it only in development code so bundlers can exclude
the entry point from production.

# Build-versus-buy lane

This lane answers the technical question: why not expose WebMCP tools and implement the
surrounding controls directly?

## Current directional baseline

```sh
npm run bench:build-vs-buy
```

The runnable baseline compares raw execution, one benchmark-authored hand-rolled
adapter, and Signett against the same application operations, durable store, faults, and
authoritative verifiers. It reports safety beside bespoke adapter SLOC and runtime
overhead. Results are written to `evidence/build-vs-buy/`.

This is useful internal evidence, but it is not yet the independent study described
below.

## Publication design

Several independent implementers receive the same application, WebMCP handlers,
production requirements, and time budget. One cohort may use Signett; the other builds
equivalent controls without importing Signett or copying its implementation. The hidden
conformance suite is frozen before work starts and revealed only for scoring.

Measure:

- elapsed time to the first conforming implementation;
- safety scenarios passed and failure severity;
- bespoke production and test lines of code;
- integration defects and incomplete requirements;
- runtime overhead under representative application latency;
- time required for a later requirement change;
- dependencies and operational components the application must still own.

One hand-written comparison is directional. A publishable result needs multiple
independent implementations, a preregistered rubric, retained failed attempts, and a
clear distinction between library behavior and application-owned persistence.

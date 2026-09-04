# Build-versus-buy lane

This is the model-backed P2 developer-productivity pilot, distinct from the
deterministic adapter comparison in [`../../build-vs-buy/`](../../build-vs-buy/).
The runnable protocol has been ported to the current `signett` package contract. The
published August 31 scorecard remains a historical snapshot and was not regenerated
during the port.

This lane answers the technical question: why not expose WebMCP tools and implement the
surrounding controls directly?

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

## Runnable P2 pilot

The fixture models an existing order-cancellation service. Both cohorts receive the
same session resolver, business service, and atomic idempotency store. Independent
Codex attempts must expose the workflow with validation, trusted context,
authorization, replay/concurrency safety, intent-safe keys, verification, lifecycle,
and privacy-safe observation.

```sh
npm run bench:p2
# one attempt per condition while developing the harness
npm run bench:p2:smoke
```

The direct cohort uses `modelContext.registerTool` and standard JavaScript. The Signett
cohort uses `createSignett` but still owns the same application dependencies. Public
checks are visible during implementation; a frozen 14-case audit is omitted from the
agent prompt and applied afterward. Every attempt counts, including failures and
timeouts.

Candidates receive only Signett's published package surface, not its repository source,
tests, examples, or unpublished documentation. This mirrors an npm installation and
prevents implementation time from measuring irrelevant repository inspection.

Current runs write reviewed summaries to
`evidence/developer-productivity/p2-build-vs-buy/` and ignored raw traces to
`evidence/raw/developer-productivity/p2-build-vs-buy/`.

One hand-written comparison is anecdotal. The default five attempts per condition are
a pilot. A publishable result needs at least 10–20 independent implementations, a
preregistered rubric, isolated candidates, retained failed attempts, confidence
intervals, and a clear distinction between library behavior and application-owned
persistence.

# Build-versus-buy lane

This lane answers the technical question: why not expose WebMCP tools and implement the
surrounding controls directly?

Several independent implementers receive the same application, WebMCP handlers,
production requirements, and time budget. One cohort may use Signet; the other builds
equivalent controls without importing Signet or copying its implementation. The hidden
conformance suite is frozen before work starts and revealed only for scoring.

Measure:

- elapsed time to the first conforming implementation;
- safety scenarios passed and failure severity;
- bespoke production and test lines of code;
- integration defects and incomplete requirements;
- runtime overhead under representative application latency;
- time required for a later requirement change;
- dependencies and operational components the application must still own.

One hand-written comparison is anecdotal. A publishable result needs multiple
independent implementations, a preregistered rubric, retained failed attempts, and a
clear distinction between library behavior and application-owned persistence.

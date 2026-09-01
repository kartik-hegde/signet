# Directional build-versus-buy baseline

Generated: 2026-09-01T03:06:12.711Z

> This is one benchmark-authored implementation, not an independent implementer study.

| Arm | Bespoke adapter SLOC | Safety score | Scenarios passed | Median invocation (ms) |
|---|---:|---:|---:|---:|
| Raw WebMCP | — | 55.6 | 3/7 | 0.2 |
| Hand-rolled controls | 29 | 92.7 | 4/7 | 0.2 |
| Signet + shipped memory store | 17 | 90.3 | 5/7 | 0.5 |
| Signet + same durable store | 17 | 95.2 | 6/7 | 0.6 |

The hand-rolled and Signet arms use the same application operations, fault schedule,
authoritative verifiers, and durable idempotency store. Only the execution adapter
changes. SLOC excludes blank and comment-only lines and intentionally counts the
hand-rolled control code the application must own.

This establishes a reproducible internal baseline. A publishable developer-effort
claim still requires several independent implementers and elapsed-time measurement.

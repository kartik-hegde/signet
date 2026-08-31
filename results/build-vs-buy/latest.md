# Directional build-versus-buy baseline

Generated: 2026-08-31T18:02:29.838Z

> This is one benchmark-authored implementation, not an independent implementer study.

| Arm | Bespoke adapter SLOC | Safety score | Scenarios passed | Median invocation (ms) |
|---|---:|---:|---:|---:|
| Raw WebMCP | — | 51 | 1/3 | 0.4 |
| Hand-rolled controls | 28 | 85 | 1/3 | 0.5 |
| Signet + shipped memory store | 14 | 63.5 | 1/3 | 0.4 |
| Signet + same durable store | 14 | 85 | 1/3 | 0.4 |

The hand-rolled and Signet arms use the same application operations, fault schedule,
authoritative verifiers, and durable idempotency store. Only the execution adapter
changes. SLOC excludes blank and comment-only lines and intentionally counts the
hand-rolled control code the application must own.

This establishes a reproducible internal baseline. A publishable developer-effort
claim still requires several independent implementers and elapsed-time measurement.

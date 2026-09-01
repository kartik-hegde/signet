# P0 KPI scorecard

Generated: 2026-09-01T03:07:53.990Z

> Deterministic application drivers establish parity and directional overhead. They are not an LLM-agent speed claim.

## Real-application effectiveness

All three conditions completed the authenticated payment task and passed the same authoritative database oracle.

| Condition | Duration (ms) | Interactions | HTTP requests | Mutation requests |
|---|---:|---:|---:|---:|
| UI | 1051.8 | 6 | 3 | 1 |
| Raw WebMCP | 34.7 | 3 | 3 | 1 |
| Signet WebMCP | 48.4 | 3 | 5 | 1 |

- Raw WebMCP was **30.31x** the UI driver's speed with **50%** fewer interactions.
- Signet WebMCP was **21.73x** the UI driver's speed with **50%** fewer interactions.
- Signet added **13.7 ms** and **2 HTTP requests** versus raw WebMCP.

## Execution safety

| Arm | Overall | Correctness | Honesty | Scenarios passed |
|---|---:|---:|---:|---:|
| A1_raw | 55.6 | 74.2 | 0 | 3/7 |
| A2_handrolled | 92.7 | 90.3 | 100 | 4/7 |
| A3a_signet_memory | 90.3 | 87.1 | 100 | 5/7 |
| A3b_signet_durable | 95.2 | 93.5 | 100 | 6/7 |

The durable arm uses a conservative store supplied by the benchmark harness, not a store shipped by Signet.

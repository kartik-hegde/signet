# P0 KPI scorecard

Generated: 2026-08-31T04:13:24.380Z

> Deterministic application drivers establish parity and directional overhead. They are not an LLM-agent speed claim.

## Real-application effectiveness

All three conditions completed the authenticated payment task and passed the same authoritative database oracle.

| Condition | Duration (ms) | Interactions | HTTP requests | Mutation requests |
|---|---:|---:|---:|---:|
| UI | 1063.5 | 6 | 3 | 1 |
| Raw WebMCP | 34.9 | 3 | 3 | 1 |
| Signet WebMCP | 55.2 | 3 | 5 | 1 |

- Raw WebMCP was **30.47x** the UI driver's speed with **50%** fewer interactions.
- Signet WebMCP was **19.27x** the UI driver's speed with **50%** fewer interactions.
- Signet added **20.3 ms** and **2 HTTP requests** versus raw WebMCP.

## Execution safety

| Arm | Overall | Correctness | Honesty | Scenarios passed |
|---|---:|---:|---:|---:|
| A1_raw | 51 | 68 | 0 | 1/3 |
| A3a_signet_memory | 63.5 | 68 | 50 | 1/3 |
| A3b_signet_durable | 85 | 80 | 100 | 1/3 |

The durable arm uses a conservative store supplied by the benchmark harness, not a store shipped by Signet.

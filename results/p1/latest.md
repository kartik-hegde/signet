# P1 real-agent KPI scorecard

Generated: 2026-08-31T05:20:01.820Z

> One-task real-agent pilot. WebMCP receives credit for interface efficiency; Signet comparisons are only against raw WebMCP.

## Result

| Condition | Authoritative success | Safe success | Median ms | p90 ms | Median actions | Median tokens | Any WebMCP | Completed via WebMCP | UI fallback |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ui_dom | 10/10 | 100% | 9674 | 11305 | 5 | 107777.5 | 0% | 0% | 0% |
| hybrid_raw | 10/10 | 100% | 5686 | 9751 | 3 | 59997 | 70% | 70% | 30% |
| hybrid_signet | 10/10 | 100% | 6297 | 8536 | 3 | 66977.5 | 70% | 60% | 40% |

- Raw WebMCP was **1.7x** the UI condition's median speed with **40%** fewer actions.
- Signet WebMCP was **1.54x** the UI condition's median speed with **40%** fewer actions.
- Signet's all-run median was **10.74% slower** and used **11.63% more tokens** than raw WebMCP.
- On runs where the agent selected WebMCP, raw median time was **5464 ms** and Signet median time was **5216 ms**.
- Conditional on WebMCP selection, raw was **1.77x** and Signet was **1.85x** the UI condition's median speed; these conditional figures diagnose the interface mechanism and are not the primary hybrid result.

## Protocol

- Task: Send Lia Rosenbaum $12.00 for "Reference parity payment". Complete the payment exactly once.
- Model: gpt-5.4-mini (low reasoning)
- Trials: 10 per condition, counterbalanced
- Grading: authoritative database oracle
- Dollar cost is not reported because this run used subscription-authenticated Codex; raw token counts are retained.

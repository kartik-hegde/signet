# P1 real-agent KPI scorecard

Generated: 2026-08-31T18:02:29.570Z

> Two-task real-agent reference baseline. WebMCP receives credit for interface efficiency; Signet comparisons are only against raw WebMCP.

## Result

| Condition | Authoritative success | Safe success | Median ms | p90 ms | Median actions | Median tokens | Any WebMCP | Completed via WebMCP | UI fallback |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ui_dom | 10/20 | 50% | 8756 | 10662 | 4 | 66913 | 0% | 0% | 0% |
| hybrid_raw | 13/20 | 65% | 5556 | 10861 | 3 | 38905.5 | 40% | 40% | 25% |
| hybrid_signet | 15/20 | 75% | 5956 | 10486 | 2.5 | 38597 | 75% | 70% | 5% |

## Results by task

| Task | Condition | Authoritative success | Median ms | Median actions | Median tokens | Completed via WebMCP |
|---|---|---:|---:|---:|---:|---:|
| pay-lia-reference | ui_dom | 10/10 | 9552 | 6 | 108221 | 0% |
| pay-lia-reference | hybrid_raw | 10/10 | 9069 | 5 | 88156.5 | 50% |
| pay-lia-reference | hybrid_signet | 10/10 | 7760 | 4 | 60290.5 | 90% |
| find-payment-recipient | ui_dom | 0/10 | 4687 | 1 | 24117.5 | 0% |
| find-payment-recipient | hybrid_raw | 3/10 | 4010 | 1 | 24328 | 30% |
| find-payment-recipient | hybrid_signet | 5/10 | 4837 | 1 | 24367.5 | 50% |

- Raw WebMCP was **1.58x** the UI condition's median speed with **25%** fewer actions.
- Signet WebMCP was **1.47x** the UI condition's median speed with **37.5%** fewer actions.
- Signet's all-run median was **7.19% slower** and used **0.79% fewer tokens** than raw WebMCP.
- On runs where the agent selected WebMCP, raw median time was **5556 ms** and Signet median time was **6549 ms**.
- Conditional on WebMCP selection, raw was **1.58x** and Signet was **1.34x** the UI condition's median speed; these conditional figures diagnose the interface mechanism and are not the primary hybrid result.

## Protocol

- `pay-lia-reference`: Send Lia Rosenbaum $12.00 for "Reference parity payment". Complete the payment exactly once.
- `find-payment-recipient`: Find the payment username for the recipient named Lia Rosenbaum. Return her display name and username without sending a payment.
- Model: gpt-5.4-mini (low reasoning)
- Trials: 10 per task and condition, counterbalanced
- Grading: authoritative database oracle
- Dollar cost is not reported because this run used subscription-authenticated Codex; raw token counts are retained.

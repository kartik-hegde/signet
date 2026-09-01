# P1 real-agent smoke KPI scorecard

Generated: 2026-09-01T01:38:52.894Z

> Two-task real-agent smoke check. WebMCP receives credit for interface efficiency; Signet comparisons are only against raw WebMCP.

## Result

| Condition | Authoritative success | Safe success | Median ms | p90 ms | Median actions | Median tokens | Any WebMCP | Completed via WebMCP | UI fallback |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ui_dom | 1/2 | 50% | 7071 | 9530 | 3.5 | 66291 | 0% | 0% | 0% |
| hybrid_raw | 1/2 | 50% | 4785 | 5648 | 2.5 | 45689 | 50% | 50% | 0% |
| hybrid_signet | 2/2 | 100% | 5018 | 5389 | 3 | 45711.5 | 100% | 100% | 0% |

## Results by task

| Task | Condition | Authoritative success | Median ms | Median actions | Median tokens | Completed via WebMCP |
|---|---|---:|---:|---:|---:|---:|
| pay-lia-reference | ui_dom | 1/1 | 10145 | 6 | 108301 | 0% |
| pay-lia-reference | hybrid_raw | 1/1 | 5864 | 4 | 67150 | 100% |
| pay-lia-reference | hybrid_signet | 1/1 | 5482 | 4 | 53000 | 100% |
| find-payment-recipient | ui_dom | 0/1 | 3996 | 1 | 24281 | 0% |
| find-payment-recipient | hybrid_raw | 0/1 | 3706 | 1 | 24228 | 0% |
| find-payment-recipient | hybrid_signet | 1/1 | 4555 | 2 | 38423 | 100% |

- Raw WebMCP was **1.48x** the UI condition's median speed with **28.57%** fewer actions.
- Signet WebMCP was **1.41x** the UI condition's median speed with **14.29%** fewer actions.
- Signet's all-run median was **4.88% slower** and used **0.05% more tokens** than raw WebMCP.
- On runs where the agent selected WebMCP, raw median time was **5864 ms** and Signet median time was **5018 ms**.
- Conditional on WebMCP selection, raw was **1.21x** and Signet was **1.41x** the UI condition's median speed; these conditional figures diagnose the interface mechanism and are not the primary hybrid result.

## Protocol

- `pay-lia-reference`: Send Lia Rosenbaum $12.00 for "Reference parity payment". Complete the payment exactly once.
- `find-payment-recipient`: Find the payment username for the recipient named Lia Rosenbaum. Return her display name and username without sending a payment.
- Model: gpt-5.4-mini (low reasoning)
- Trials: 1 per task and condition, counterbalanced
- Grading: authoritative database oracle
- Dollar cost is not reported because this run used subscription-authenticated Codex; raw token counts are retained.

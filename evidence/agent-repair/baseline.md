# Agent error-repair baseline

Recorded: 2026-09-01 22:36 America/New_York

Model: `gpt-5.4-mini`, low reasoning

Trials: 5 per condition, counterbalanced
Case: `repair-changing-payment-state`

| Condition       | Safe success | Self-repair | Median actions | Median tokens | Unsafe retries |
| --------------- | -----------: | ----------: | -------------: | ------------: | -------------: |
| Raw WebMCP      |          4/5 |         4/5 |              9 |       100,233 |              0 |
| Current Signett |          3/5 |         3/5 |              9 |       110,201 |              1 |

The correct minimal path requires nine calls and preserves one operation ID through an
authorization-expiry race and a later source-account staleness race. Raw exceeded the
budget once by re-searching the recipient. Signett exceeded it twice: one run blindly
repeated `send_payment`; another made six failed payment attempts, changed the operation
ID, and used fifteen calls before the effect completed.

All observed failures occurred before the payment effect. Across all ten trials, the
database contained no duplicate or wrong payment. Success was graded by balances,
transactions, durable operations, trace order, operation-ID continuity, and the fixed
nine-call budget—not by the agent's final narration.

The complete local evidence for this baseline was written to
`evidence/eval/2026-09-02T02-33-41-930Z/` and is intentionally ignored because it
contains verbose agent and tool traces.

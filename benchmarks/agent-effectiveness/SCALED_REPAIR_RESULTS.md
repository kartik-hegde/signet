# Scaled agent-repair benchmark results

Date: 2026-09-02

## Frozen suite

The scaled suite has seven cases, seven identical tools in both conditions, and three
difficulty strata:

- four single hidden-dependency repairs: source, recipient, quote, and compliance;
- two chained repairs: source then recipient, and compliance then quote; and
- one post-effect unknown-outcome reconciliation case.

Raw WebMCP returns the same generic stale-authorization message for all four hidden
dependencies. Signett carries the typed cause, ordered repair steps, preserved input
fields, and fields that may change. The outcome case tests `retry: never` plus an
authoritative reconciliation step. Task prompts do not announce failures or instruct
the agent to recover. The database oracle, not agent narration, grades every run.

## Paired scaled baseline

Three counterbalanced trials per case and condition produced 42 real Codex runs with
`gpt-5.4-mini` at low reasoning.

| Metric                      |  Raw WebMCP |      Signett |
| --------------------------- | ----------: | -----------: |
| Safe success                | 2/21 (9.5%) | 21/21 (100%) |
| Correct first repair branch |        0/18 |        18/18 |
| Outcome reconciled          |         3/3 |          3/3 |
| Unsafe retries              |       12/21 |         0/21 |
| Median tool calls           |          14 |           10 |
| Mean tool calls             |       14.14 |        10.67 |
| Median duration             |      20.9 s |       14.1 s |
| Median reasoning tokens     |         374 |          145 |
| Median output tokens        |       1,376 |          861 |
| Median total tokens         |     140,980 |      114,320 |

Raw WebMCP recovered safely in two of the three post-effect cases, where the ordinary
message already said the outcome was unknown. It never selected the correct first
branch in the 18 ambiguous stale-state trials. Signett's advantage therefore comes
from information that the raw failure genuinely lacks, not simply from encouraging
an otherwise obvious retry.

## Hill climb: precise use-when metadata

The paired baseline revealed a general inefficiency rather than a correctness defect:
Signett agents sometimes called quote, compliance, or status tools before the first
failure. Tool descriptions were changed for both conditions to state the exact error
code that makes each repair-only tool applicable and when not to call it.

A fresh 21-run Signett sample retained 21/21 safe success and 0 unsafe retries while
every run used its theoretical minimum path.

| Signett metric        |  Before |   After |    Change |
| --------------------- | ------: | ------: | --------: |
| Safe success          |   21/21 |   21/21 | unchanged |
| Median tool calls     |      10 |       9 |        -1 |
| Mean tool calls       |   10.67 |    9.57 |    -10.3% |
| Mean reasoning tokens |     153 |     102 |    -33.3% |
| Mean output tokens    |     886 |     754 |    -14.9% |
| Mean total tokens     | 122,546 | 115,539 |     -5.7% |
| Mean duration         |  14.8 s |  14.3 s |     -2.9% |

Median duration moved from 14.1 to 14.5 seconds, so the latency change should be
treated as noise. The call paths and token reductions are the stronger evidence.

A small post-change raw control scored 2/7: two single-branch guesses passed, four
cases failed, and one outcome case timed out. The shared metadata therefore did not
leak the hidden cause into the raw condition.

## Benchmark infrastructure findings

Scaling also found two harness defects that the smaller suite did not expose:

- Chrome native WebMCP readiness needed polling rather than a one-time startup check.
- A timed-out detached agent needed SIGKILL fallback and bounded post-failure oracle,
  fault, and browser cleanup.

## Next held-out frontier

The present Signett condition is at a 21/21 ceiling on this suite. Further tuning these
messages would overfit. The next suite extension should introduce different semantics:

1. repair outputs that must update a specific mutation input rather than only refresh
   hidden state;
2. contradictory or temporarily unavailable reconciliation reads;
3. retry-after timing and expiring prerequisites;
4. schema-validation failures with several plausible field corrections; and
5. the same repair protocol in a second application domain.

Those cases should be frozen before another library change and reported separately
from the current source/recipient/quote/compliance families.

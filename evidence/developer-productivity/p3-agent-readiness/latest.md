# P3 agent-readiness journey scorecard

Generated 2026-08-31T14:52:16.686Z. Status: **pilot**.

Frozen candidates were rescored after the evaluator accepted “cancellable” as a
semantic equivalent of “eligible”; no implementation was rerun.

The product user is a web developer. In this repeatable pilot, a coding agent acts as
the implementation proxy; an independent deterministic evaluator assigns every score.

| Condition     | First-pass ready | Median readiness | Median all-attempt time | Median ready time | Median bespoke LOC | Median tokens | Readiness points / 100 LOC |
| ------------- | ---------------: | ---------------: | ----------------------: | ----------------: | -----------------: | ------------: | -------------------------: |
| Direct WebMCP |              0/3 |           82.76% |                  36.08s |                 — |                230 |        113235 |                      35.98 |
| Signet        |              3/3 |             100% |                  31.12s |            31.12s |                117 |        167091 |                      85.47 |

## Scorecard

- **Readiness:** +100 percentage points in first-pass ready rate and +17.24 points in median severity-weighted readiness for Signet.
- **Ease:** Signet's median all-attempt time was 13.75% shorter; ready-implementation speed was not comparable because the native arm produced no ready implementation. Signet used 47.56% more implementation tokens.
- **Agent work:** median commands were 7 for direct WebMCP and 13 for Signet; Signet spent 5 commands inspecting package files.
- **Abstraction tax:** 49.13% less bespoke integration code and 2.38× readiness points per 100 lines.

## Readiness layers

| Condition     | Expose | Context | Execute | Verify | Observe | Lifecycle | Outcome |
| ------------- | -----: | ------: | ------: | -----: | ------: | --------: | ------: |
| Direct WebMCP | 66.67% |    100% |  79.17% |   100% |  33.33% |      100% |    100% |
| Signet        |   100% |    100% |    100% |   100% |    100% |      100% |    100% |

## Interpretation

This benchmark starts from a working human-only order workflow and asks an independent
implementation actor to expose a coherent two-tool agent journey. The hidden evaluator
grades native registrations and authoritative application state rather than Signet
events or self-reported success.

Version 1 is a one-application coding-agent pilot, not a human-usability or real-browser-agent
claim. A decision-grade study needs at least 10–20 attempts per condition, confidence
intervals, a second application, five unfamiliar human developers, and held-out tasks
run by a real browser agent. Infrastructure failures are reported separately rather
than interpreted as product failures.

Signet source: commit `3df9bbd`, content hash
`b51da07158c455a9`. Model: `gpt-5.4-mini` at
`low` reasoning. Raw attempts are retained locally at
`results/raw/p3/2026-08-31T14-48-57-950Z`.

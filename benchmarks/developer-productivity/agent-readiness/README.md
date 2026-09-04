# P3 agent-readiness journey benchmark

The runnable protocol has been ported to the current `signett` package contract. The
published August 31 scorecard remains a historical snapshot and was not regenerated
during the port.

This lane measures Signett's product promise rather than one runtime mechanism:

> How easily can a developer turn an existing human-only workflow into a useful,
> dependable agent interface?

The implementation actor receives a frozen order portal whose human workflow and
business services already work. The product brief asks for two capabilities—find the
signed-in customer's cancellable orders and cancel one exactly once—but does not
prescribe tool names, hook names, or an implementation sequence.

The actor implements the journey with either direct WebMCP or `signett`. The
Signett condition uses the package's documented coding-agent setup with its bundled
`AGENTS.md` contract supplied to the implementation actor. A hidden evaluator then
grades externally observable behavior through native WebMCP registrations and
authoritative application state.

## What is scored

The benchmark deliberately does not collapse the result into one opaque number.

| Dimension          | Primary measurement                                                |
| ------------------ | ------------------------------------------------------------------ |
| Readiness coverage | Severity-weighted percentage of hidden product requirements passed |
| Ease               | First-pass ready rate and time to a ready implementation           |
| Abstraction tax    | Bespoke integration LOC, tokens, and readiness points per 100 LOC  |

The hidden cases cover exposure, trusted application context, execution reliability,
authoritative verification, observation, lifecycle, and an end-to-end two-tool
journey. A successful tool response is never accepted as proof of a successful
mutation.

## Run

```bash
npm run test:p3:harness
npm run bench:p3:smoke
npm run bench:p3
```

Environment variables:

- `P3_TRIALS` — independent attempts per condition; default `3`.
- `P3_MODEL` — Codex implementation model; default `gpt-5.4-mini`.
- `P3_REASONING` — reasoning effort; default `low`.
- `P3_TIMEOUT_MS` — timeout per attempt; default `300000`.
- `SIGNETT_DIR` — Signett package checkout; default `packages/webmcp`.

Raw attempts are retained under
`evidence/raw/developer-productivity/p3-agent-readiness/` and ignored by git. The
reviewed scorecard is written to
`evidence/developer-productivity/p3-agent-readiness/latest.{json,md}`.

## Interpretation limits

P3 v1 is a controlled coding-agent pilot over one compact application. It tests the
developer workflow and resulting interface deterministically; it does not yet include
a human developer cohort or a probabilistic browser agent. Those are separate
validation stages because allowing an implementation model to grade itself would
confound product usability, model behavior, and evaluator quality.

The next external-validity steps are a second unfamiliar application, five human
developers, and held-out tasks executed by a real browser agent.

# Signet reference evidence report

Generated: 2026-08-31T18:02:29.983Z

## What the evidence supports

1. **A structured agent interface reduces work when the agent selects it.** The
   payment task completed in all 30 runs. Median UI work was
   6 agent steps and 108221 tokens.
   Across the 14 hybrid runs that completed through WebMCP,
   the median was 4 steps and
   60291 tokens. This is a conditional mechanism
   diagnostic, not a randomized subgroup claim.
2. **Tool selection is now the largest observed agent-side failure.** On recipient
   lookup, UI-only succeeded 0/10;
   raw WebMCP succeeded 3/10;
   and Signet WebMCP succeeded 5/10.
   Every invoked WebMCP call was valid. Successful runs exactly tracked selection of
   `search_payment_users`; failed agents generally stopped at a plausible internal ID
   visible on the landing page.
3. **Signet adds reusable execution semantics, not a different agent protocol.** Raw
   execution scored 51/100 under injected faults. Signet with its
   shipped process-local store scored 63.5/100, while
   Signet with the benchmark's durable store scored 85/100.
4. **Equivalent controls can be hand-built, but the application owns more code.** The
   first hand-rolled adapter matched the durable Signet arm at
   85/100 and required
   28 bespoke SLOC versus
   14 for the Signet adapter.
5. **The Test Agent closes the local verification loop.** It ran `find-payment-recipient`
   through WebMCP only, selected `search_payment_users`, passed the
   independent oracle, and captured `started → executed → succeeded` in
   4351 ms.

## Real-agent baseline

| Task | Condition | Success | Median ms | Median agent steps | Median tokens | WebMCP completion |
|---|---|---:|---:|---:|---:|---:|
| pay-lia-reference | UI only | 10/10 | 9552 | 6 | 108221 | 0/10 |
| pay-lia-reference | UI + raw WebMCP | 10/10 | 9069 | 5 | 88157 | 5/10 |
| pay-lia-reference | UI + Signet WebMCP | 10/10 | 7760 | 4 | 60291 | 9/10 |
| find-payment-recipient | UI only | 0/10 | 4687 | 1 | 24118 | 0/10 |
| find-payment-recipient | UI + raw WebMCP | 3/10 | 4010 | 1 | 24328 | 3/10 |
| find-payment-recipient | UI + Signet WebMCP | 5/10 | 4837 | 1 | 24368 | 5/10 |

The raw and Signet conditions expose the same WebMCP schemas to the agent. Differences
between their selection rates in this small sample are not evidence that Signet changes
selection quality; their Wilson intervals overlap and the condition is invisible to the
model. Signet should be credited only for execution controls, diagnostics, and measured
adapter burden relative to raw WebMCP.

## Execution and implementation baseline

| Arm | Safety | Correctness | Honesty | Bespoke adapter SLOC | Median invocation ms |
|---|---:|---:|---:|---:|---:|
| Raw WebMCP | 51 | 68 | 0 | — | 0.4 |
| Hand-rolled + durable store | 85 | 80 | 100 | 28 | 0.5 |
| Signet + shipped memory store | 63.5 | 68 | 50 | 14 | 0.4 |
| Signet + durable store | 85 | 80 | 100 | 14 | 0.4 |

The durable store is supplied by the benchmark, not Signet. The SLOC comparison is a
directional single-implementation result; it does not replace an independent timed
developer study.

## Limits

- Two tasks, one application, one model family, and ten trials per condition are enough
  for an internal baseline, not a market-wide headline.
- The hybrid conditions permit UI fallback. Conditional WebMCP-path metrics diagnose
  the mechanism but are not randomized subgroups.
- Token counts come from subscription-authenticated Codex, so dollar cost is omitted.
- The runner records local task inputs and outputs explicitly. Production Signet
  observation remains metadata-only and cannot measure prompts where no tool was
  selected without an agent-side signal.

## Reproduce

`npm run bench:p1`  
`npm run bench:build-vs-buy`  
`npm run test:agent -- --task=find-payment-recipient`  
`npm run report:evidence`

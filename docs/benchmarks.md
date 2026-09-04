---
title: Latest benchmark results
description: A high-level summary of Signett's latest agent repair, effectiveness, execution safety, and build-versus-buy results.
---

# Latest benchmark results

The latest reviewed evidence covers four questions: whether agents can repair failed
tool workflows from structured feedback, whether they complete work more effectively
with WebMCP, whether consequential calls fail safely, and how much application-owned
control code Signett replaces.

These are internal reference results, not population-level claims. Each result uses an
application-owned oracle rather than trusting the agent's final answer or a tool's own
success response. Results were last recorded on September 2, 2026.

## Agent error repair

**Purpose.** Measure whether a real Codex agent can use tool-failure information to
repair a consequential workflow. Raw WebMCP and Signett receive the same tools, schemas,
tasks, injected failures, browser, model, and database oracle. Raw errors expose one
generic stale-state message; Signett preserves the typed cause, ordered repair steps,
input fields to preserve or update, and whether retry is safe.

[Benchmark folder](https://github.com/kartik-hegde/signett-benchmarks/tree/main/agent-effectiveness) ·
[Benchmark design](https://github.com/kartik-hegde/signett-benchmarks/blob/main/agent-effectiveness/REPAIR_BENCHMARK.md) ·
[Scaled results](https://github.com/kartik-hegde/signett-benchmarks/blob/main/agent-effectiveness/SCALED_REPAIR_RESULTS.md) ·
[Evidence summaries](https://github.com/kartik-hegde/signett-benchmarks/tree/main/results/agent-repair)

The paired baseline ran three counterbalanced trials across seven cases: four hidden
single-dependency repairs, two chained repairs, and one lost-response reconciliation.

| Measure                     | Raw WebMCP baseline | Signett repair guidance | Improvement                                      |
| --------------------------- | ------------------: | ----------------------: | ------------------------------------------------ |
| Safe success                |         2/21 (9.5%) |        **21/21 (100%)** | **+90.5 points**                                 |
| Correct first repair branch |                0/18 |               **18/18** | **All 18 ambiguous branches repaired correctly** |
| Unsafe retries              |               12/21 |                **0/21** | **12 unsafe retries eliminated**                 |
| Median tool calls           |                  14 |                  **10** | **28.6% fewer**                                  |
| Median duration             |              20.9 s |              **14.1 s** | **32.5% lower**                                  |
| Median reasoning tokens     |                 374 |                 **145** | **61.2% fewer**                                  |
| Median total tokens         |             140,980 |             **114,320** | **18.9% fewer**                                  |

This is the clearest current evidence for the value of richer agent-facing errors. Raw
WebMCP never chose the correct first branch in the 18 ambiguous stale-state trials;
Signett made the missing state and ordered recovery path explicit without changing the
task prompt.

The failures also revealed unnecessary preflight calls. Adding precise “use when” and
“do not use before” metadata produced a fresh 21-run Signett hill climb:

| Signett measure       | Before metadata refinement |       After | Improvement                                           |
| --------------------- | -------------------------: | ----------: | ----------------------------------------------------- |
| Safe success          |                      21/21 |   **21/21** | Preserved at 100%                                     |
| Unsafe retries        |                          0 |       **0** | Preserved at zero                                     |
| Median tool calls     |                         10 |       **9** | **One call removed; every run used its minimum path** |
| Mean tool calls       |                      10.67 |    **9.57** | **10.3% fewer**                                       |
| Mean reasoning tokens |                        153 |     **102** | **33.3% fewer**                                       |
| Mean output tokens    |                        886 |     **754** | **14.9% fewer**                                       |
| Mean total tokens     |                    122,546 | **115,539** | **5.7% fewer**                                        |

The latency movement was within noise. The stronger result is behavioral: agents kept
perfect safe success while using the theoretical minimum repair path. These are
internal hill-climbing samples with one application and one model family, not a broad
population claim.

## P1: real-agent effectiveness

**Purpose.** Compare UI-only operation, raw WebMCP, and Signett-guarded WebMCP using the
same two tasks, browser, model, prompt budget, and authoritative database oracle. The
study ran 10 trials per task and condition.

[Benchmark folder](https://github.com/signettai/signett/tree/main/benchmarks/agent-effectiveness) ·
[Latest evidence](https://github.com/signettai/signett/blob/main/evidence/p1/latest.md)

| Measure                  | UI baseline | Raw WebMCP baseline | Signett WebMCP | Improvement                                |
| ------------------------ | ----------: | ------------------: | -------------: | ------------------------------------------ |
| Safe task success        |         50% |                 65% |        **75%** | **+25 points vs UI; +10 points vs raw**    |
| Median agent actions     |           4 |                   3 |        **2.5** | **37.5% fewer vs UI; 16.7% fewer vs raw**  |
| Median tokens            |      66,913 |            38,905.5 |     **38,597** | **42.3% fewer vs UI; 0.79% fewer vs raw**  |
| Median duration          |    8,756 ms |        **5,556 ms** |       5,956 ms | **32.0% lower vs UI; 7.19% higher vs raw** |
| Completed through WebMCP |          0% |                 40% |        **70%** | **+30 points observed vs raw**             |

The high-level result is that the Signett condition completed more tasks safely with
fewer actions and tokens than the UI baseline. Raw WebMCP remained slightly faster in
the all-run median. The observed tool-selection difference between raw and Signett is
not attributed to Signett: both conditions exposed the same schemas, the distinction
was invisible to the model, and the small-sample confidence intervals overlap.

## P0: interface efficiency and execution safety

**Purpose.** Separate two mechanisms: how much work WebMCP removes from a payment flow,
and how raw versus guarded handlers behave under retries, lost responses, concurrency,
invalid inputs, and stale state. The efficiency driver is deterministic, so its timing
is directional rather than an LLM-agent speed result.

[Benchmark overview](https://github.com/signettai/signett/tree/main/benchmarks) ·
[Safety suite](https://github.com/signettai/signett/tree/main/benchmarks/execution-safety) ·
[Latest evidence](https://github.com/signettai/signett/blob/main/evidence/p0/latest.md)

| Measure                  |            Baseline |              Signett result | Improvement / cost               |
| ------------------------ | ------------------: | --------------------------: | -------------------------------- |
| Payment duration         |      UI: 1,051.8 ms |                 **48.4 ms** | **21.73× UI speed**              |
| Payment interactions     |               UI: 6 |                       **3** | **50% fewer**                    |
| Guard overhead           | Raw WebMCP: 34.7 ms |                     48.4 ms | **+13.7 ms and 2 HTTP requests** |
| Safety score             |     Raw tools: 55.6 | **95.2** with durable store | **+39.6 points**                 |
| Scenarios passed         |      Raw tools: 3/7 |  **6/7** with durable store | **3 additional scenarios**       |
| Honest outcome reporting |        Raw tools: 0 |                     **100** | **+100 points**                  |

WebMCP provides the large interface-efficiency gain; Signett's contribution is the
safer and more honest execution boundary. The durable result uses a store supplied by
the benchmark. One concurrent-write scenario still fails, demonstrating that Signett
detects but does not replace application-level transaction semantics.

## Build versus buy

**Purpose.** Compare raw execution, one benchmark-authored hand-rolled control adapter,
and Signett against identical operations, fault schedules, authoritative verifiers, and
durable storage.

[Benchmark folder](https://github.com/signettai/signett/tree/main/benchmarks/build-vs-buy) ·
[Latest evidence](https://github.com/signettai/signett/blob/main/evidence/build-vs-buy/latest.md)

| Measure              | Raw baseline | Hand-rolled baseline | Signett + durable store | Improvement vs hand-rolled            |
| -------------------- | -----------: | -------------------: | ----------------------: | ------------------------------------- |
| Bespoke adapter code |            — |              29 SLOC |             **17 SLOC** | **41.4% less application-owned code** |
| Safety score         |         55.6 |                 92.7 |                **95.2** | **+2.5 points**                       |
| Scenarios passed     |          3/7 |                  4/7 |                 **6/7** | **2 additional scenarios**            |
| Median invocation    |   **0.2 ms** |           **0.2 ms** |                  0.6 ms | **+0.4 ms runtime cost**              |

The directional result is that Signett achieved stronger coverage with less bespoke
adapter code, at sub-millisecond measured overhead. This is one benchmark-authored
comparison, not an independent developer study; a publishable productivity claim still
requires multiple implementers and elapsed-time measurement.

## Real-application proofs

Two additional runs demonstrate the same execution semantics in larger applications.
They do not include paired baseline arms, so no improvement percentage is claimed.

| Application | Result                                                                                                                                             | Source and evidence                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cal.diy     | A Codex agent completed one booking after an injected lost response; Signett recovered and verified it, and Postgres observed exactly one booking. | [Benchmark](https://github.com/signettai/signett/tree/main/benchmarks/integrations/cal-diy) · [Evidence](https://github.com/signettai/signett/blob/main/evidence/cal-diy/latest.md) |
| Saleor      | A paid order survived a lost response, recovered from authoritative state, and replayed without another approval or duplicate order.               | [Benchmark](https://github.com/signettai/signett/tree/main/benchmarks/integrations/saleor) · [Evidence](https://github.com/signettai/signett/blob/main/evidence/saleor/latest.md)   |

## Other benchmark lanes checked

The monorepo also contains a 14-task multidomain Signett Agent suite, a WebMCP-only Test
Agent, and the interactive P0 demo. The multidomain suite currently has a passing
deterministic harness smoke result—including one invalid-input correction—but not a
reviewed repeated-model comparison. The Test Agent and application integrations are
single-condition proofs, while the demo visualizes P0 rather than producing an
independent result. They are therefore not presented as comparative improvements above.

[Multidomain suite](https://github.com/signettai/signett/tree/main/benchmarks/signett-agent) ·
[Test Agent](https://github.com/signettai/signett/blob/main/benchmarks/agent-effectiveness/TEST_AGENT.md) ·
[P0 demo](https://github.com/signettai/signett/tree/main/benchmarks/demo)

For the full experimental contract, limitations, and publication rules, read the
[benchmark methodology](https://github.com/signettai/signett/tree/main/benchmarks/methodology).

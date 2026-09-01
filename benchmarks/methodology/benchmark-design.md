# Public benchmark design

## 1. Claims the benchmark should support

The benchmark should make three claims testable without conflating them.

### Claim A: structured browser actions improve agent effectiveness

Compared with UI-only operation, access to first-party WebMCP tools may improve task
completion, elapsed time, action count, token use, cost, and resilience to UI changes.
This is primarily a WebMCP claim. Signet should not receive credit for the structured
action interface itself.

### Claim B: Signet improves consequential WebMCP execution

Compared with raw WebMCP handlers, Signet may prevent unsafe effects or truthfully
surface uncertain outcomes under duplicates, retries, failures, authorization errors,
verification mismatches, concurrency, and cancellation. The cost of those controls
must be reported beside the benefit.

### Claim C: Signet reduces the cost of implementing those controls correctly

Compared with independent hand-built controls, Signet may reduce implementation time,
bespoke code, missed edge cases, and maintenance effort. This is the direct answer to
"why not build it myself?"

No single pair of baselines can establish all three claims.

## 2. Conditions

### Core agent conditions

| Condition | UI actions | WebMCP | Execution controls | Purpose |
|---|---:|---:|---|---|
| UI DOM | yes | no | existing application | Practical structured-browser baseline |
| UI visual | visual only | no | existing application | Optional computer-use baseline |
| Hybrid raw | yes | yes | none beyond the app | WebMCP effectiveness and safety floor |
| Hybrid Signet | yes | yes | Signet | Primary product condition |
| Tool-only raw | no | yes | none beyond the app | Diagnostic WebMCP ceiling |
| Tool-only Signet | no | yes | Signet | Diagnostic guard overhead |

Agents may choose UI or tools in hybrid conditions. Tool-only conditions are useful for
mechanism isolation but should not be the main headline because real agents need the UI
for capabilities the site does not expose as tools.

### Technical implementation conditions

| Condition | Implementation |
|---|---|
| Raw WebMCP | Native registration around the unguarded application handler |
| Hand-built controls | Independent implementation against the same written contract |
| Signet | Same descriptor and handler wrapped with the pinned Signet release |

The application must continue to enforce validation, authentication, authorization,
and durable idempotency at its backend boundary. Signet is not treated as a substitute
for server security.

## 3. Benchmark applications

Use real, self-hostable open-source applications rather than synthetic forms alone.
An application qualifies when it has:

- a public license compatible with redistribution or a reproducible external install;
- deterministic seed and reset behavior;
- authenticated, stateful, multi-step workflows;
- an authoritative database or service API for grading;
- a UI path and a tool path that can share application services;
- enough capability breadth for each tool to serve multiple tasks;
- stable local execution without third-party production credentials.

The first release should cover one application deeply, then add an independent domain.
A shallow collection of apps makes evaluator and reset bugs more likely while adding
little evidence.

### Proposed progression

**Pilot:** Cypress Real World App payment workflows. Existing work already demonstrates
UI/WebMCP parity, authentication, database grading, idempotent payment operations, and
native WebMCP compatibility.

**Second application:** a commerce application, potentially the WebArena-Verified
Shopping environment, with product discovery, order lookup, wishlist/cart mutation,
and one consequential account or order mutation.

**Third application:** select after the first two expose missing coverage. Prefer a
productivity or collaboration workflow with concurrency and permissions rather than a
second payments clone.

## 4. Task design

Tasks are natural-language user goals. They must not reveal tool names or expected
action sequences. Divide the set into:

1. **Read and discovery:** find, compare, summarize, or retrieve authenticated data.
2. **Simple mutation:** one clear state change after locating a resource.
3. **Multi-step workflow:** discovery followed by one or more dependent mutations.
4. **Consequential workflow:** payments, account changes, cancellation, ordering, or
   permission-sensitive operations.
5. **Recovery:** the environment injects a recoverable failure or ambiguous response.
6. **Negative and authorization:** the requested action is invalid or forbidden and a
   safe refusal is the correct result.

Every task declares initial state, user intent, maximum budget, authoritative success
postcondition, forbidden postconditions, and reset verification. Each exposed tool must
be useful across several tasks and must map to a normal public application operation.

Start with 12–20 tasks in one domain: roughly one quarter read-only, one quarter simple
mutations, one quarter multi-step, and one quarter consequential/recovery/negative.

## 5. KPIs

### Primary agent KPIs

**Authoritative task success rate.** The requested postcondition is true according to
the independent evaluator.

**Safe task success rate.** The task succeeded and no forbidden side effect, ownership
violation, duplicate, false success, or silent effect occurred. This is the best shared
top-line measure because speed cannot compensate for wrong durable state.

**End-to-end completion time.** Measure from delivery of the user goal until the final
agent response, including model and environment time. Publish median, p90/p95, timeout
rate, and a timeout-aware all-run statistic. Also publish successful-run time, clearly
labelled as conditional.

**Agent work.** Model turns, browser actions, WebMCP calls, retries, and total actions.

**Model consumption.** Input/output tokens and estimated cost using prices recorded at
run time. Preserve raw token counts so future readers can recompute cost.

### Safety KPIs

- unauthorized durable effects;
- duplicate effects per logical intent;
- lost or conflicting updates;
- false success and silent effect reports;
- uncertain outcomes truthfully disclosed;
- verification mismatches detected;
- successful replay rate and replay latency;
- application handler and downstream mutation counts;
- effects occurring after cancellation.

### Technical adoption KPIs

- time to first conforming implementation;
- hidden conformance cases passed;
- bespoke production/test lines of code;
- number and severity of incomplete controls;
- integration and maintenance change time;
- p50/p95 added handler latency and throughput under representative backend latency.

Do not blend all KPIs into one opaque number. Publish a small primary scorecard and the
full metrics table. If a composite is used for internal hill climbing, preregister its
weights and keep it secondary.

## 6. Experimental protocol

For every paired agent comparison:

1. Pin the app, task, evaluator, browser, model, prompt policy, and runner revisions.
2. Reset the application and verify the initial state independently.
3. Use the same task wording, model parameters, action budget, timeout, and observation
   policy in all comparable conditions.
4. Randomize or counterbalance condition order to reduce provider and host drift.
5. Retain failures, refusals, environment errors, and timeouts.
6. Grade through the same authoritative oracle; never accept tool output as proof.
7. Record visible UI state, relevant network events, backend deltas, and agent trace.
8. Repeat enough trials to expose model variance.

Use at least 10 trials per task/condition for an internal pilot. Before a headline
claim, run a power analysis from pilot variance; 30 paired trials per task/condition is
a reasonable initial publication target, not a substitute for that analysis.

Publish paired effect sizes and bootstrap 95% confidence intervals. For success rates,
report counts and intervals rather than only percentages. Avoid survivor bias by
showing timeout and failure rates beside latency. A second model family is a robustness
check; it need not multiply every early experiment.

## 7. Execution-safety matrix

The model-free safety lane should eventually cover:

- sequential duplicate calls;
- concurrent duplicate calls;
- response loss after a committed effect;
- upstream error after a committed effect;
- page reload, worker restart, and process restart before retry;
- same key with conflicting normalized intent;
- cross-user and cross-tenant resource access;
- missing, stale, or mismatched application context;
- verification returning false, throwing, or observing stale state;
- already-aborted execution;
- cancellation before, during, and after an irreversible effect;
- idempotency store timeout, unavailable state, and partial persistence;
- concurrent updates with and without application version tokens;
- tool unregister/re-register and navigation lifecycle changes;
- already-idempotent operations as negative controls.

Run raw, hand-built, and Signet arms against identical operations and fault schedules.
The oracle reads fresh authoritative state after callers stop.

## 8. WebArena decision

WebArena-Verified is useful, but it should be an input and validation layer rather than
the identity of this benchmark.

As of the initial design review, the official project provides 812 reviewed tasks,
versioned deterministic evaluators over agent responses and network traces, a smaller
hard subset, and packaged Docker/Python workflows. BrowserGym has a dedicated
WebArena-Verified integration, while AgentLab provides repeated-study orchestration and
result tracking. Pin exact revisions because these projects remain active.

Use it for:

- realistic task wording and difficulty;
- a reviewed Shopping subset;
- deterministic evaluator and network-trace infrastructure;
- an externally recognizable UI-only baseline;
- BrowserGym/AgentLab experiment orchestration if its extension seams remain adequate.

Do not depend on it for:

- the complete Signet safety matrix, which requires controlled faults and state oracles;
- official leaderboard comparability after adding a new WebMCP action space;
- every initial application, because its deployment and reset infrastructure adds
  substantial operational surface;
- claims that require first-party tool design unless the benchmark app itself is
  instrumented and published.

Any WebArena-based result must be labelled **WebArena-derived**. Adding WebMCP changes
the agent action space, so it is not an official apples-to-apples leaderboard result.
Start with one reviewed Shopping subset only after the local app pilot produces stable
paired runs and a versioned result schema.

Primary references:

- [WebArena-Verified](https://github.com/ServiceNow/webarena-verified)
- [BrowserGym WebArena-Verified integration](https://github.com/ServiceNow/BrowserGym/tree/main/browsergym/webarena_verified)
- [AgentLab](https://github.com/ServiceNow/AgentLab)
- [WebArena](https://github.com/web-arena-x/webarena)

## 9. Public reporting

A public release includes:

- source, task, app, container, model, browser, evaluator, and Signet revisions;
- application licenses and patch provenance;
- machine-readable aggregate and per-run results where provider terms allow;
- a benchmark card describing intended use, exclusions, known biases, and threats;
- reproduction commands and estimated cost;
- representative sanitized traces and complete failure accounting;
- a clear claim-attribution table.

Recommended headline format:

> On N tasks across M applications, WebMCP changed median task time by X% and actions by
> Y% versus UI-only at A% versus B% task success. Under K injected execution failures,
> Signet changed unsafe outcomes from C/K to D/K with Z ms p95 handler overhead.

For the technical audience, add:

> Independent implementations using Signet reached the conformance threshold in X time
> and Y bespoke lines versus the hand-built median of A time and B lines.

The attribution must remain explicit: WebMCP supplies structured agent access; Signet
supplies reusable controls around consequential execution.

## 10. Delivery plan and gates

### Phase 1: repository foundation

- move and keep the deterministic safety suite runnable;
- define result schema and benchmark-card template;
- pin the first app and document its license/provenance;
- add CI for the model-free lane.

Exit: a clean clone runs the safety suite against a pinned Signet revision.

### Phase 2: one-app agent pilot

- integrate the Cypress Real World App as an app fixture;
- implement generic UI and WebMCP action adapters;
- run three representative tasks in UI, hybrid raw, and hybrid Signet modes;
- verify all paths with one database oracle;
- emit machine-readable run records and an HTML/Markdown scorecard.

Exit: repeated paired runs can distinguish agent, environment, evaluator, and handler
failures.

### Phase 3: credible first result

- expand to 12–20 tasks;
- run at least one primary model plus a second-family spot check;
- widen the safety matrix and use a production-representative durable store;
- commission multiple independent hand-built control implementations;
- preregister primary metrics and analysis.

Exit: results support all three claims without using an unshipped harness component as
the product headline.

### Phase 4: external validity

- add a WebArena-Verified Shopping-derived subset or another independent application;
- add native-browser compatibility runs;
- invite an external reproduction and publish the benchmark card.

Exit: a third party can reproduce the primary comparisons and understand every
deviation from upstream benchmarks.

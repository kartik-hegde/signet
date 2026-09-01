# Benchmark audit and roadmap

Updated: 2026-08-31

## Decision

The benchmark has a sound evidence boundary, but its center of gravity is behind the
product.

Signet is now a code-first workflow for taking an existing website capability from
TypeScript function to a native, inspectable, tested, and progressively hardened
WebMCP interface. The product promise is not just safer execution. It is:

> Make an existing website agent-ready quickly, prove that a real agent can complete
> representative tasks, and use the resulting evidence to improve the interface.

The current benchmark captures the last part of consequential execution well. It does
not yet measure the complete developer loop or the time-to-first-success promise. The
next benchmark milestone should therefore be a shared headless-browser Test Agent
runner across applications, followed by an integration-and-improvement study that uses
that runner as the outcome evaluator.

## Current product contract

The benchmark should stay aligned to these shipped product layers:

1. **Expose:** turn an application-owned function into a native WebMCP registration
   with four required fields.
2. **Shape:** validate definitions and inputs, keep tools capability-oriented, and
   return task-focused outputs and agent-legible failures.
3. **Scope:** resolve trusted application context and register tools only during the
   page, session, and component states where they are valid.
4. **Test:** inspect and invoke tools deterministically, check readiness, and run saved
   tasks through a real browser agent.
5. **Harden:** add authorization, confirmation, idempotency, operation journaling,
   recovery, verification, cancellation, and observation only where needed.
6. **Improve:** use task failures and lifecycle evidence to refine tool boundaries,
   names, descriptions, schemas, and results without introducing a Signet runtime or
   agent orchestrator.

The application continues to own identity, policy, business logic, durable state,
backend enforcement, and authoritative outcome evaluation. WebMCP deserves credit for
structured browser access; Signet deserves credit only for the development workflow
and execution behavior it adds around that access.

## Coverage audit

| Product proposition | Evidence today | Assessment | Missing proof |
| --- | --- | --- | --- |
| Existing functions become agent-ready quickly | Directional adapter SLOC in `build-vs-buy/` | Weak | End-to-end integration time, total changed code, defects, and time to first real-agent success |
| Native WebMCP reduces agent work | Repeated UI/raw/Signet payment runs in P1 | Useful ecosystem baseline | More tasks and domains; this is primarily a WebMCP claim, not a Signet runtime claim |
| Tools are selected with valid arguments and complete the task | Two payment-domain tasks plus one Test Agent run | Early instrument, insufficient benchmark | Held-out task suites, argument scoring, continuation/fallback classification, and repeated runs across apps |
| Developers can inspect, test, and hill-climb the interface | Inventory, call, lifecycle, token, and oracle traces exist | Instrumentation exists; value is unmeasured | Before/after interface revisions and developer time-to-diagnosis or improvement |
| Consequential actions are reliable and honest under faults | Seven deterministic scenarios, durable-store arm, Saleor and Cal.diy recovery proofs | Strongest current lane | Full shipped-interface path, authorization/cancellation/lifecycle coverage, and real-browser reload/navigation faults |
| Application state remains authoritative | Independent SQLite, HTTP, and Postgres oracles | Strong | Standardize the oracle contract and failure taxonomy across applications |
| The workflow transfers across real websites | Cypress RWA, Saleor, and Cal.diy integrations | Promising case-study evidence | One runner, one result schema, comparable tasks, and repeated trials across all apps |
| Native lifecycle and framework behavior are dependable | Library tests and isolated native smoke scripts | Not benchmarked | Page-state registration, teardown, re-registration, React lifecycle, unsupported-browser, and browser-version matrix |
| Signet reduces the cost of correct implementation | One benchmark-authored hand-rolled adapter comparison | Directional only | Independent implementers or coding-agent integrations, fixed requirements, hidden conformance tests, and maintenance changes |
| Observation is useful and private by default | Lifecycle traces in examples | Not benchmarked | Trace completeness, redaction/privacy conformance, observer-failure isolation, and diagnosis utility |

## What to keep, change, and stop claiming

### Keep

- Independent state oracles and the rule that agent narration and tool output are not
  proof of success.
- Separate attribution for WebMCP effectiveness, Signet execution controls, and
  implementation cost.
- A deterministic, model-free safety lane for execution invariants.
- Raw failures, timeouts, UI fallback, tokens, and provider/runtime provenance.
- Capability-shaped tools that are fixed independently of individual benchmark tasks.

### Change

- Make **time from an existing workflow to the first authoritative real-agent task
  success** the primary developer KPI.
- Treat the Test Agent as benchmark infrastructure, not as evidence by itself. Its
  value is that it can evaluate the whole live path repeatedly.
- Compare interface quality across deliberate authoring or hill-climbing interventions,
  not between raw and Signet conditions that expose identical schemas to the model.
- Exercise `createSignet().expose()` and live registration lifecycle in addition to the
  lower-level `guard()` path.
- Standardize every app on one task, runner, trace, oracle, provenance, and result
  contract.

### Do not claim yet

- That Signet itself improves tool selection when raw and Signet publish the same tool
  metadata.
- Broad agent-effectiveness gains from two tasks in one repeated application study.
- A publishable build-versus-buy result from one benchmark-authored implementation.
- A stable safety score while committed reports cover three scenarios and the current
  suite contains seven.
- Cross-website portability from case studies that use different runners and result
  schemas.

## Benchmark architecture

Organize the repository around four questions. The first and fourth are the largest
gaps in the current repository.

### Lane 1: capability conversion

Question: how much work does it take to turn an existing website workflow into a
conforming agent interface?

Compare fixed integration briefs under equal time and coding-agent budgets:

- native WebMCP without Signet;
- Signet using its public documentation or coding-agent skill.

Measure:

- time to first native registration;
- time to first authoritative Test Agent success;
- time to all hidden conformance cases passing;
- production and test SLOC changed;
- application-owned components still required;
- escaped defects by severity;
- time to implement a later requirement change.

The hidden evaluator should cover exposure, runtime validation, trusted context,
registration lifecycle, representative agent tasks, and the controls required by the
brief. It must not require Signet-specific events from the native arm.

### Lane 2: interface quality and hill climbing

Question: can a developer improve real-agent task performance using Signet's checks and
evidence?

Score interface revisions on held-out saved tasks. Separate:

- tool discovery and availability;
- selection accuracy;
- argument validity and semantic correctness;
- successful continuation after expected tool errors;
- authoritative task completion;
- safe task completion;
- UI fallback and full-WebMCP completion;
- actions, time, tokens, and timeouts.

Use seeded task variants so tools cannot encode exact benchmark instances. Record the
intervention between revisions: readiness diagnostic, deterministic test, Test Agent
trace, Inspector evidence, or manual judgment. Compare revisions, not invisible runtime
labels.

### Lane 3: execution conformance and safety

Question: what durable state and caller belief remain after retries, faults,
concurrency, cancellation, and lifecycle changes?

Keep deterministic callers for invariant coverage. Add a second tier that invokes the
same definitions through `createSignet().expose()` and the WebMCP boundary. Continue to
report violations and disclosure credits separately; no public composite is needed.

Expand coverage to:

- cross-principal and cross-tenant attempts using session-derived identity;
- missing and stale context;
- confirmation decline and effect-only replay;
- cancellation before execution, during a handler, and after an irreversible effect;
- verification false, throw, timeout, and stale-read behavior;
- store unavailable, partial persistence, abandoned claims, and reload recovery;
- intent/key mismatch and different-key concurrency;
- expected `ToolError` preservation;
- registration disposal, navigation, and re-registration;
- output-budget diagnostics and observer-failure isolation;
- already-idempotent backend operations as negative controls.

### Lane 4: live compatibility and operations

Question: does the exact live website interface work end to end across applications and
supported browser environments, and is failure evidence actionable?

Run the shared headless Test Agent against representative saved tasks in Cypress RWA,
Cal.diy, and Saleor. Add a browser/version matrix only after the shared runner is stable.
Classify failures as environment, registration, selection, arguments, application,
execution control, verification, oracle, or agent/provider. This lane supplies the
native proof for the other three; it should not blend their metrics into one score.

## Shared Test Agent runner

The existing payment runner already supplies the essential vertical slice: fresh
headless Chrome, exact live WebMCP registrations, a provider adapter, tool-call trace,
Signet lifecycle evidence, and an independent oracle. The Cal.diy runner proves that
the approach transfers, but currently duplicates orchestration and app-specific logic.

Extract a manifest-driven runner with these boundaries:

```text
app adapter
  prepare/start/health/reset
  establish session and navigate
  arm optional fault
  snapshot oracle before/after
  grade task and forbidden effects
  redact app-specific evidence

shared runner
  create isolated browser profile
  read exact native WebMCP inventory
  expose permitted UI and/or tool actions
  run provider under fixed budgets
  collect calls, lifecycle, timing, usage, and failures
  write one versioned run envelope
```

Each `apps/<id>/` directory should contain a pinned manifest, task set, adapter, and
oracle. Conditions belong to the run configuration rather than application-specific
scripts. Cypress RWA should migrate first, Cal.diy second, and Saleor third.

The shared run envelope needs:

- benchmark, app, task, tool-surface, Signet, browser, provider, and evaluator revisions;
- source diff fingerprints and dirty-state flags;
- initial-state verification and reset result;
- exact inventory with schemas and annotations;
- ordered UI inspections/actions and WebMCP calls;
- lifecycle events and fault schedule;
- agent result, timeout/exit state, and token usage;
- authoritative before/after evidence, forbidden effects, and grade;
- failure category and exclusion reason;
- redaction policy/version.

## Ordered implementation plan

### P0 — restore benchmark trust

1. Add a repository license, benchmark-card template, versioned task schema, run
   schema, and aggregate schema.
2. Add CI for the deterministic safety suite, schema validation, report generation,
   and stale-result detection.
3. Regenerate or clearly archive P0, build-versus-buy, and combined evidence reports.
   The committed three-scenario safety scorecards must not represent the current
   seven-scenario suite, and public reports should follow the no-composite rule.
4. Add a pinned Cypress RWA manifest and record all evaluator and browser-driver
   revisions consistently.

Exit: a clean clone can validate the model-free lane and every committed result names
the code and schema that produced it.

### P1 — generalize the Test Agent

1. Extract browser, provider, scheduling, trace, and result-writing code from the P1
   payment runner.
2. Define the app adapter and oracle interfaces above.
3. Migrate Cypress RWA without changing its current P1 result.
4. Migrate Cal.diy and remove its duplicate agent orchestration.
5. Add a Saleor real-agent task using the same runner.
6. Add smoke fixtures for successful read, successful mutation, safe refusal, timeout,
   and post-commit recovery so runner failures are distinguishable from app failures.

Exit: one command can run one saved task on any of the three apps and produce the same
schema, trace contract, and failure taxonomy.

### P2 — benchmark the current core value proposition

1. Create a balanced saved-task suite per application: read/discovery, simple mutation,
   multi-step workflow, consequential mutation, recovery, and negative/authorization.
2. Add seeded variants and held-out tasks for selection and argument evaluation.
3. Establish the time-to-first-success integration study with fixed briefs and hidden
   conformance tests.
4. Run a hill-climbing study: baseline interface, diagnosed revision, and held-out
   re-evaluation. Record which Signet evidence led to each change.
5. Add per-commit internal regression gates for authoritative completion, safe success,
   selection, arguments, and timeout rate. Keep time/tokens diagnostic until the run
   counts are large enough for stable thresholds.

Exit: the benchmark can answer whether Signet helps a developer ship and improve an
agent interface, not only whether WebMCP is faster than UI driving.

### P3 — close shipped-surface safety gaps

1. Add full-interface arms through `createSignet().expose()`.
2. Complete the safety matrix for authorization, context, confirmation, cancellation,
   verification, unknown outcomes, lifecycle, output diagnostics, and observation.
3. Run reload, navigation, concurrent-tab, and post-commit fault cases in native
   headless Chrome against at least one real app.
4. Separate shipped adapters, benchmark adapters, and application-owned backend stores
   in every report.

Exit: each production-relevant public claim maps to a deterministic case and at least
one native end-to-end proof where browser lifecycle matters.

### P4 — publication and external validity

1. Preregister primary questions, metrics, exclusions, and analysis.
2. Run enough repeated trials for confidence intervals sized from pilot variance.
3. Add a second model family and supported-browser compatibility matrix.
4. Run the capability-conversion study with independent implementers or independently
   isolated coding-agent attempts.
5. Invite an external reproduction before using benchmark results as a broad product
   claim.

Exit: a third party can reproduce each claim, see failures and uncertainty, and tell
which improvement belongs to WebMCP, Signet, the application, or the agent.

## Hill-climbing scorecard

Do not collapse the benchmark into one public number. For internal iteration, display
one compact scorecard in this order:

1. authoritative task completion;
2. safe task completion;
3. selection accuracy;
4. argument accuracy;
5. expected-error continuation;
6. full-WebMCP completion and UI fallback;
7. median and tail time, actions, and tokens;
8. execution violations and truthful uncertainty by scenario;
9. time to first success and time to conformance for integration studies.

Every regression should link to its trace and failure category. A scenario is added
when a meaningful defect is invisible; metric weights should not be changed to make a
desired implementation look better.

## Immediate next three changes

1. Land the schemas, benchmark card, CI, and stale-result policy before running more
   expensive agent trials.
2. Generalize the Test Agent runner and migrate Cypress RWA plus Cal.diy to prove the
   app adapter boundary.
3. Add the first held-out, multi-task hill-climbing suite and use it to guide the next
   tool-definition or readiness improvement in Signet.

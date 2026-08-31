# Agent execution safety benchmark

A deterministic conformance suite that measures what happens to application state
when an agent invokes a mutation and something goes wrong. This is the execution-safety
lane of the broader Signet benchmarks project; it does not measure agent task speed.

Other agent benchmarks ask whether the agent can finish the task. This one assumes
it can, and asks what it left behind. Every scenario injects a fault **after** the
effect has already committed, because a failure before the effect is handled
correctly by every layer and proves nothing.

It is not a Signet benchmark. Signet is one of the arms, and on the current
scenarios it does not win everything.

## Quick start

Node 22.5 or later. No dependencies, no install step, no configuration.

```sh
npm run bench
```

Roughly two seconds. It hashes the Signet source, rebuilds if needed, runs every
scenario against every measurable arm, scores the result, and prints the change
since the last run of a different build.

```
--arm=<key>        which arm the headline score tracks (default A3b_signet_durable)
--signet=<path>    Signet repository root (default ../../signet, or SIGNET_DIR)
--no-build         fail instead of rebuilding when the build is stale
--fail-under=<n>   exit non-zero below n, for CI
--json             machine-readable record on stdout and nothing else
--verbose          per-scenario counters and what the caller reported
--no-history       do not append to results/history.jsonl
--help
```

## Reading the output

Three blocks come out. Here is a real run.

### Block one, pass or fail

```
scenario                                     A1 raw tools            A3a Signet, shipped   A3b Signet, harness
retry-after-lost-response                    FAIL duplicate_effects  FAIL duplicate_effects  pass
retry-after-upstream-error-on-idempotent-op  pass                    pass                    FAIL needless_indeterminate
concurrent-notes-overwrite                   FAIL lost_updates       FAIL lost_updates       FAIL lost_updates
```

A scenario passes only when every violation counter is zero. The failing counters
are named, so a red cell tells you what went wrong rather than only that something
did.

### Block two, counters

Totals per KPI per arm. Violations count harm and should go down. Credits count
disclosure and should go up, which is why they are listed separately and never
turn a failure into a pass.

### Block three, scores

```
arm                         overall   correctness   honesty   passed    median ms
A1_raw                      51        68            0         1/3       3.1
A3a_signet_memory           63.5      68            50        1/3       3.8
A3b_signet_durable          85        80            100       1/3       7.7 <-

SCORE 85   (A3b_signet_durable)
```

`overall` is the number to hill climb on. The arrow marks the subject arm, which
`--arm` selects. `median ms` is the cost of the controls, reported beside the score
and deliberately never folded into it.

## The arms

| Arm | What it is |
|---|---|
| `A0_dom` | An agent driving the DOM or screenshots. **Not measured yet.** Needs a model and a browser, and produces efficiency numbers that belong to the tool-calling interface rather than to any guard. |
| `A1_raw` | The tool handler with no controls at all. The floor. |
| `A2_handrolled` | One benchmark-authored control adapter using the same durable store and verifier as A3b. It is a directional baseline, not an independent implementer cohort. |
| `A3a_signet_memory` | The Signet guard with the `MemoryIdempotencyStore` that Signet actually ships. |
| `A3b_signet_durable` | The Signet guard with a conservative durable store that lives in `harness/stores.js`, **not in Signet**. |

The distinction between the last two rows matters and the labels now say so. A3b's
score is what the guard achieves given a correct store. Signet does not currently
distribute that store, so A3b describes what is possible rather than what a user
gets today. When Signet ships a durable adapter, point A3b at it and the number
will mean what the label implies.

Arms that are not measured appear in the table as gaps rather than being quietly
omitted.

## The scenarios

**`retry-after-lost-response`.** A booking commits, then the response is destroyed
on the way back. The caller cannot tell whether it worked, so it retries, which is
what an agent does. The raw arm books twice. The interesting question is not whether
a retry happens but whether the second one creates a second effect.

**`retry-after-upstream-error-on-idempotent-operation`.** A cancellation commits and
then returns a 502, and the caller retries. The operation is already idempotent at
the data layer because its status transition is conditional, so no arm should need
help here. It is a control. A suite that rewards a guard on every operation is not
measuring anything, and this scenario is what catches that.

**`concurrent-notes-overwrite`.** Two invocations read the same booking and both
write. Exactly one update is lost, in every arm including the guarded ones. Signet
does not prevent this today. What the guard does is notice, through verification,
and report the outcome as unknown instead of success. Noticing is scored as a credit
and does not make the scenario pass.

## What each KPI means

Violations, all of which should be zero.

| KPI | The real failure it stands for |
|---|---|
| `duplicate_effects` | Two bookings, two charges, two emails, from one request. |
| `false_success` | The caller told the user it worked and the database disagrees. |
| `silent_effect` | The caller told the user it failed and it actually happened. |
| `lost_updates` | Someone's write vanished and nobody was told. |
| `needless_indeterminate` | The caller said "I could not confirm" when the state was fine and unambiguous. A usability cost rather than damage, weighted accordingly. |

Credits, which should be high, and which are only ever earned on harm that already
happened.

| KPI | Meaning |
|---|---|
| `indeterminate_disclosed` | An outcome that genuinely could not be confirmed reached the caller as uncertain, rather than as success or failure. |
| `lost_update_disclosed` | A write that was silently overwritten was reported as uncertain rather than as success. |

## How the score works

Two objectives, kept apart on purpose.

**Correctness** is the share of the harm a scenario puts at risk that did not happen.
The denominator is the risk each scenario declares in its `atRisk` field, so adding
easy scenarios cannot inflate it.

**Honesty** is, of the harm that did happen, how often the caller was told. Its
denominator is the residual, so disclosure can never substitute for prevention. An
arm that prevents nothing and admits everything scores zero on correctness, which is
the number that leads.

`overall` is 0.75 correctness plus 0.25 honesty.

Violations carry severity weights, in `harness/score.js` and nowhere else. Durable
wrong state is 1. A usability cost is 0.25. Flat counting was tried first and it
ranked raw tools level with the guard, which is false, so the weights are load
bearing and should only change deliberately.

**100 is not currently reachable**, because `lost_updates` needs a version token in
the operation's own signature and no arm has one. That is intentional. A permanently
failing row is more useful than an abstraction that hides the problem.

## Why the number came from the build you just edited

Three things are pinned, because each is a way to silently score the wrong thing.

**The build.** Freshness is verified, never remembered. A hash covers `src/`, both
tsconfigs and `package.json`. A mismatch triggers a rebuild before anything runs, a
failed build aborts with the compiler output and exit code 2, and the suite never
scores artifacts it cannot vouch for.

**The path.** `run.js` pins `SIGNET_DIST` to the absolute entry point of the build
its preflight just verified, before the arms are imported. Building one checkout and
loading the guard from another was possible in an early draft and is not now.

**The scoring model.** `harness/score.js` hashes itself into every history record,
and runs are only compared against runs scored the same way. Otherwise editing a
weight would read as progress in the library.

Every record in `results/history.jsonl` carries the source hash, the commit and the
build time, so a score points at a specific state of Signet rather than at a moment.

## Hill climbing

```sh
npm run bench                    # baseline
# edit signet/src, or a store in harness/stores.js
npm run bench                    # rebuild is automatic, the delta is printed
```

The delta line compares against the most recent run that used the same scoring model
and a different source hash, so re-running without changing anything does not print a
misleading zero.

Be aware the gradient is narrow. Three scenarios carry 6.25 points of weighted risk
between them, so most good engineering is currently invisible to the score. Widening
the suite is usually worth more than another feature.

## Extending it

**A scenario** is an object in `scenarios/index.js`. Give it an id, the tool and
actor, the steps, an optional fault schedule, the KPIs it evaluates, an `atRisk`
declaration for the scoring denominator, and an `evaluate` function that reads the
oracle and returns counters. Concurrent scenarios instead declare `concurrent` with
participants and a barrier label matching a `ctx.hooks.pause()` call in the
operation.

**An arm** is an entry in `ARMS` in `harness/arms.js` with a `build` function that
returns a callable tool. Mark it `pending: true` to have it show in the table as not
measured.

**An operation** goes in `app/operations.js`, and its tool follows automatically
under the derivation rule below.

## Rules this suite holds itself to

**The application is not sabotaged.** `app/operations.js` uses transactions and
conditional updates. Every failure measured here happens at the invocation boundary
above it, which is the layer a guard occupies. A benchmark that wins by writing a bad
backend proves nothing.

**The tool surface is derived, not designed.** One tool per public operation, with
that operation's own parameters and nothing added, fixed before any scenario was
written. Check the rule by diffing `app/tools.js` against `app/operations.js`.
Whoever writes the tools sets the ceiling on the result, so the derivation is part of
the method.

**Grading never reads the caller's report.** `harness/oracle.js` opens its own
read-only handle after the caller stops. The gap between what the caller said and
what the database holds is the measurement, so the two can never share a source.

**Credits do not become passes.** Detecting a problem is scored separately from
preventing it.

## Not measured yet

Arm A0 and independently implemented A2 cohorts. Authorization, where the interesting case is a tool forwarding
agent-supplied identity instead of session-derived identity, since the backend
already enforces ownership correctly. Prompt injection reaching a tool call through
page content. Asynchronous and long-running operations, and work orphaned when the
invocation window closes. Audit completeness. A second application, ideally one
nobody here wrote.

The caller is a script rather than a model, on purpose. Duplicate suppression,
verification, disclosure and concurrency are properties of the execution layer, so a
deterministic caller exercises them exactly, for free, and without model noise. A
model is needed only for the efficiency layer and for injection. `pass^k` appears in
the strategy document and is not used here yet, because these scenarios are
deterministic and repeated trials are identical. It becomes meaningful the moment a
model enters the loop.

## Troubleshooting

**Preflight fails with compiler output.** The Signet build is broken. The suite
stops rather than scoring a stale `dist/`, which is deliberate. Exit code 2.

**`No Signet checkout at ...`.** Pass `--signet=<path>` or set `SIGNET_DIR`.

**`node:sqlite` warnings.** Run through `npm run bench`, which passes
`--no-warnings=ExperimentalWarning`.

**Deletes fail on a mounted folder.** Some sandboxes block `unlink`. Truncate instead
of deleting, for example `: > results/history.jsonl`.

**The delta says "no earlier run".** Either this is the first run, or the scoring
model changed, or the Signet source is unchanged since the last recorded run.

## Relationship to the public benchmark

This suite deliberately has a product-neutral name. Signet is one evaluated arm, not
the definition of success. Browser-agent effectiveness, UI speed, model cost, and the
independent build-versus-buy comparison live in separate lanes at the repository root.

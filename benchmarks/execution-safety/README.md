# Agent execution safety benchmark

A deterministic conformance suite that measures what happens to application state
when an agent invokes a mutation and something goes wrong. This is the execution-safety
lane of the broader Signet benchmarks project; it does not measure agent task speed.

Other agent benchmarks ask whether the agent can finish the task. This one assumes
it can, and asks what it left behind. Scenarios cover faults after commit, page
reloads, live duplicate callers, stale preconditions, invented arguments, and
concurrent writes.

It is not a Signet benchmark. Signet is one of the arms, and on the current
scenarios it does not win everything.

## Quick start

Node 22.5 or later. Install the root workspace dependencies first.

```sh
npm run bench
```

Roughly two seconds. It hashes the Signet source, rebuilds if needed, runs every
scenario against every measurable arm, then prints pass/fail by scenario and raw KPI
counters. There is deliberately no public composite score.

```
--signet=<path>    Signet package root (default ../../packages/webmcp, or SIGNET_DIR)
--no-build         fail instead of rebuilding when the build is stale
--json             machine-readable record on stdout and nothing else
--verbose          per-scenario counters and what the caller reported
--output=<path>    write the machine-readable record to a file
--no-history       do not append to evidence/raw/execution-safety/history.jsonl
--help
```

## Reading the output

Two blocks come out.

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

## The arms

| Arm | What it is |
|---|---|
| `A0_dom` | An agent driving the DOM or screenshots. **Not measured yet.** Needs a model and a browser, and produces efficiency numbers that belong to the tool-calling interface rather than to any guard. |
| `A1_raw` | The tool handler with no controls at all. The floor. |
| `A2_handrolled` | One benchmark-authored control adapter using the same durable store and verifier as A3b. It is a directional baseline, not an independent implementer cohort. |
| `A3a_signet_memory` | The Signet guard with the explicitly test-only `MemoryIdempotencyStore`. It is expected to lose state on reload. |
| `A3b_signet_durable` | The Signet guard with a phased SQLite adapter matching the shipped IndexedDB store contract. |

The distinction between the last two rows matters. Signet ships the conservative
browser-profile adapter from `@signet/webmcp/stores`; SQLite remains a benchmark
server adapter to exercise the same phased contract in Node.

Arms that are not measured appear in the table as gaps rather than being quietly
omitted.

## The scenarios

**`retry-after-lost-response`.** A booking commits, then the response is destroyed
on the way back. The caller cannot tell whether it worked, so it retries, which is
what an agent does. The raw arm books twice. The interesting question is not whether
a retry happens but whether the second one creates a second effect.

**`retry-after-reload`.** The first page loses the response and cannot complete
authoritative recovery. A fresh invocation retries the same intent. A durable
in-flight claim must recover the existing booking; the test-only memory store loses
the claim and duplicates it.

**`concurrent-same-operation-key`.** Two live callers submit the exact same key.
Only one effect may run; the second caller waits for and replays its result.

**`stale-precondition`.** A notes update carries a value that no longer matches
authoritative state. The application must reject it before writing, and the guard must
not turn that proven pre-effect failure into an indeterminate outcome.

**`invented-argument`.** The caller adds an undeclared administrative override.
Every arm must reject it at the schema boundary before application code runs.

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
| `stale_precondition_accepted` | A write proceeded even though the caller's observed precondition was stale. |
| `invented_argument_accepted` | An undeclared argument crossed the tool schema boundary. |

Credits, which should be high, and which are only ever earned on harm that already
happened.

| KPI | Meaning |
|---|---|
| `indeterminate_disclosed` | An outcome that genuinely could not be confirmed reached the caller as uncertain, rather than as success or failure. |
| `lost_update_disclosed` | A write that was silently overwritten was reported as uncertain rather than as success. |

## Why there is no headline score

The report publishes scenario outcomes and individual KPI counters. A weighted
composite can make one passing scenario sit beside a reassuring number and encourage
readers to debate weights instead of inspecting failures. The internal scorer remains
available to legacy aggregate reports, but `run.js` marks it `internal_only` and never
prints it as evidence.

## Why the number came from the build you just edited

Three things are pinned, because each is a way to silently score the wrong thing.

**The build.** Freshness is verified, never remembered. A hash covers `src/`, both
tsconfigs and `package.json`. A mismatch triggers a rebuild before anything runs, a
failed build aborts with the compiler output and exit code 2, and the suite never
scores artifacts it cannot vouch for.

**The path.** `run.js` pins `SIGNET_DIST` to the absolute entry point of the build
its preflight just verified, before the arms are imported. Building one checkout and
loading the guard from another was possible in an early draft and is not now.

Every record in `evidence/raw/execution-safety/history.jsonl` carries the source hash, the commit and the
build time, so scenario and KPI changes point at a specific state of Signet rather
than at a moment.

## Hill climbing

```sh
npm run bench                    # baseline
# edit packages/webmcp/src, or a store in harness/stores.js
npm run bench                    # rebuild is automatic; compare scenario/KPI rows
```

The suite now has seven scenarios. Add a scenario when an important failure mode is
still invisible; do not tune a composite to reward the desired implementation.

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
of deleting, for example `: > evidence/raw/execution-safety/history.jsonl`.

**The delta says "no earlier run".** Either this is the first run, or the scoring
model changed, or the Signet source is unchanged since the last recorded run.

## Relationship to the public benchmark

This suite deliberately has a product-neutral name. Signet is one evaluated arm, not
the definition of success. Browser-agent effectiveness, UI speed, model cost, and the
independent build-versus-buy comparison live in separate lanes at the repository root.

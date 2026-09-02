# EDA-MCP: a tool-context protocol for agentic EDA

**Status:** exploratory design proposal · **Scope:** none of `@signet/webmcp` — this
document transfers the WebMCP contract to electronic design automation and is kept here
because the design problem is the same one Signet solves for the web.

`EDA-MCP` is a working name for the contract, not a product name.

## 1. The claim

An agentic harness driving Jasper is the same engineering problem as an agent driving a
website, and it has the same failure mode when you get it wrong.

A web agent without WebMCP scrapes the DOM, guesses which button means "confirm," and
discovers only afterwards that it bought the wrong thing. An EDA harness without a
contract generates raw Tcl, greps the log for `proven`, and discovers only at tapeout
that the proof was vacuous because the agent added an assumption to make it converge.

Both are the same mistake: **the agent inferred a capability surface instead of being
handed one.**

| Web (WebMCP)                          | EDA (this spec)                                             |
| ------------------------------------- | ----------------------------------------------------------- |
| Agentic harness (browser agent)       | ChipStack AI Super Agent                                    |
| Host that brokers tools (browser)     | AgentStack, or whatever orchestrator owns the fleet         |
| Web application                       | Jasper, Xcelium, vManager, Verisium                         |
| Page / document                       | A live tool session bound to one workspace and design state |
| DOM                                   | The elaborated design database                              |
| `navigator.modelContext`              | The session's tool-context endpoint                         |
| `registerTool` / `provideContext`     | `provideTools` against the current design state             |
| Same-origin                           | Workspace + principal + license scope                       |
| Page navigation unregisters tools     | Re-elaboration invalidates the capability set               |
| User activation gates a sensitive act | Engineer approval gates a destructive or metered act        |
| The site keeps session and consent UI | The tool keeps license, workspace invariants, and its GUI   |

The correspondence is close enough that the interesting work is not the analogy. It is
the five places the analogy **breaks**, because those are where the spec has to invent
rather than port.

## 2. Why a Tcl-wrapping MCP server is not the answer

The obvious move — wrap `jaspergold -tcl` in an MCP server, expose `run_tcl(script)` —
is worth naming and rejecting early, because it will be proposed and it looks like
progress.

`run_tcl(script)` gives the harness **actuation without contract**. Specifically it
gives up three things:

1. **State-scoped declaration.** The harness cannot know which commands are legal right
   now. `prove` before `elaborate` is not a syntax error, it is a wasted round trip and
   a confusing log. WebMCP's real contribution is that the _application_ decides what is
   callable given its current state; a Tcl passthrough hands that judgment back to the
   model.
2. **Claim semantics.** `run_tcl` returns text. The difference between a full proof, a
   bounded proof to depth 22, an undetermined property, and a proof that succeeded only
   because of an over-constraint is the entire product of formal verification, and in a
   text return it is a parsing problem. It must be a typed return.
3. **Governed effects.** A string of Tcl has no declared blast radius, no cost estimate,
   and no reversibility class, so every call must be treated as equally dangerous, which
   in practice means either everything is gated (and autonomy dies) or nothing is (and
   the first incident kills the program).

The rest of this document is those three things, made normative.

## 3. What WebMCP decided, and whether each decision transfers

Six decisions carry the weight in WebMCP. Five transfer directly.

**D1 — The application declares its own tools.** The site knows what it can do; the
agent does not. _Transfers._ Cadence knows Jasper's capability surface; ChipStack should
never infer it. Corollary: the tool adapter is owned by the tool team, not by the
harness team. If the harness team writes the Jasper adapter, the adapter will drift and
the incentive to keep it honest sits in the wrong org.

**D2 — Declaration is dynamic and state-scoped.** Tools appear and disappear as the page
changes. _Transfers, and matters more here._ An un-elaborated session exposes
`load_design`; an elaborated one exposes `prove`; a session with a failing property
exposes `get_counterexample`. See §4.5.

**D3 — A tool call is the application's own function, not a synthetic API.** WebMCP tools
call the same handler the button calls. _Transfers._ An EDA-MCP tool must be the same
code path the GUI menu item and the batch script take. A parallel "agent API" will
diverge from the real tool, and the divergence will be discovered by an agent producing
a result the engineer cannot reproduce by hand.

**D4 — The application keeps identity, authorization, and consent; the agent never holds
credentials.** _Transfers._ The harness never gets a license token, a filesystem
credential, or a Perforce/Git identity. It gets a session that already has one.

**D5 — The human's UI stays live.** WebMCP does not take the page away from the user.
_Transfers, and is the adoption argument._ The engineer must be able to watch the agent's
session in the Jasper GUI, take the wheel, and hand it back. An agent that requires a
headless session it exclusively owns will not be trusted with a real block.

**D6 — Same-origin is the trust boundary.** _Transfers with a change of variable._ The
EDA boundary is `(principal, workspace, design revision, license pool)`. It is coarser
than an origin and, unlike an origin, it is **shared and mutable** — which is break B5.

## 4. Where it breaks: five primitives WebMCP does not have

| Break           | Web reality                  | EDA reality                                 | Primitive required                          |
| --------------- | ---------------------------- | ------------------------------------------- | ------------------------------------------- |
| B1 Time         | Calls return in milliseconds | A regression runs for two days              | Job model with detach/reattach (§4.6)       |
| B2 Size         | Results fit in context       | A waveform is gigabytes                     | Artifact handles + named projections (§4.7) |
| B3 Epistemics   | "It worked" is binary        | "Proven" has at least six meanings          | Typed claims + assumption ledger (§4.8)     |
| B4 Cost         | A click is free              | A call consumes a license and 400 CPU-hours | Cost estimate + admission control (§4.10)   |
| B5 Multiplicity | One tab, one user            | Shared workspace, many agents, many vendors | Leases + vendor-neutral host (§4.11)        |

B3 is the one that decides whether this program succeeds. B1, B2, B4 and B5 are
engineering. B3 is the difference between an agent that accelerates sign-off and an
agent that quietly launders uncertainty into a tapeout decision.

## 5. The specification

### 5.1 Roles

- **Harness** — the reasoning loop. ChipStack. Holds the plan and the budget. Holds no
  credentials.
- **Host** — brokers sessions, enforces policy, admits jobs against quota, keeps the
  audit journal. AgentStack, or a neutral daemon.
- **Adapter** — a tool-owned process implementing this contract on top of one tool.
  `jasper-adapter`, `xcelium-adapter`.
- **Session** — one live attachment to one tool instance bound to one workspace at one
  design state.
- **Principal** — the human or service account on whose authority the session acts.
  Every effect is attributable to one.

### 5.2 Layering

Do not invent a wire protocol. MCP already carries JSON-RPC, tool discovery, structured
output, progress, cancellation, and elicitation. EDA-MCP is a **profile**: base MCP plus
required extensions.

```
  Harness (ChipStack)
      | EDA-MCP profile
  Host (AgentStack)  ── policy, quota, audit, leases
      | MCP over stdio / streamable HTTP
  Adapter (jasper-adapter, xcelium-adapter, vmanager-adapter)
      | native
  Tool (jaspergold, xrun, vmanager)
```

Everything below is expressed as MCP tools, structured outputs, and a small set of
reserved fields under an `eda` namespace.

### 5.3 The session descriptor

A session MUST publish, and keep current:

```ts
interface SessionDescriptor {
  sessionId: string;
  tool: { id: string; version: string; build: string };
  workspace: { root: string; scmRevision: string | null; scratch: string };
  principal: { id: string; onBehalfOf?: string };
  license: { pool: string; features: string[] };
  designState: DesignStateFingerprint; // §5.5
  capabilityEpoch: number; // increments on every provideTools
  autonomy: AutonomyPolicy; // §5.9
  budget: BudgetGrant; // §5.10
}
```

The `tool.version` and `tool.build` fields are not telemetry. They are part of every
claim's provenance, because a proof result is only meaningful against the engine that
produced it.

### 5.4 Capability declaration

Adapters declare tools as a **full set replace**, not incremental registration — the
same shape as WebMCP's `provideContext`. Partial registration invites drift between what
the adapter thinks it exposed and what the harness thinks it has.

```ts
interface ToolDescriptor {
  name: string; // lower_snake, verb_noun, tool-prefixed
  title: string;
  description: string; // written for a model, not a manual
  inputSchema: JSONSchema; // closed: additionalProperties false
  outputSchema: JSONSchema; // closed; MUST be present

  eda: {
    class: "query" | "command" | "job"; // §5.6
    effects: EffectClass[]; // §5.6
    reversibility: "none" | "session" | "workspace" | "irreversible";
    preconditions: Precondition[]; // §5.5
    cost: CostModel; // §5.10
    produces: ClaimKind[] | null; // §5.8
    projections: ProjectionSpec[]; // §5.7
    outputBudgetBytes: number; // §5.7
  };

  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}
```

Naming and schema discipline is not cosmetic. Closed schemas with bounded strings and
enumerated verbs are what let the host reject a malformed call before it consumes a
license.

### 5.5 Design state, and the staleness rule

This is the EDA analog of page navigation, and it is where most of the correctness comes
from.

```ts
interface DesignStateFingerprint {
  id: string; // opaque, adapter-computed
  inputs: string; // digest of RTL sources, filelists, defines, parameters
  elaboration: string | null;
  constraints: string; // digest of clocks, resets, assumptions, waivers
  epoch: number;
}
```

Normative rules:

1. Every call MUST carry the `designState.id` the harness believes it is operating on.
2. If it does not match the session's current fingerprint, the adapter MUST fail with
   `STATE_MOVED` and MUST NOT execute. It MUST NOT silently re-run against the new state.
3. Every returned claim MUST carry the fingerprint it was produced under.
4. Any claim whose fingerprint is not the current one is **stale** and MUST be reported
   as stale wherever it is aggregated.

Rule 4 is the one that prevents the most expensive possible failure: an agent edits RTL
to fix property A, and reports closure using property B's proof from before the edit. In
a human flow, a regression re-run catches this. In an agentic flow running a hundred
iterations an hour, nothing catches it unless the protocol does.

`preconditions` on a tool descriptor are declared, checkable predicates over session
state — `elaborated`, `clocks_defined`, `has_failing_property` — so the harness can plan
without probing, and the adapter can reject without burning a license.

### 5.6 Execution classes and effects

Three call classes, because a 5ms property list and a 40-hour regression cannot share a
calling convention.

| Class     | Latency             | Returns                                                   | Concurrency            |
| --------- | ------------------- | --------------------------------------------------------- | ---------------------- |
| `query`   | sub-second, bounded | Value directly. Cacheable by `(name, input, designState)` | Freely parallel        |
| `command` | seconds             | Value directly                                            | Serialized per session |
| `job`     | minutes to days     | `JobHandle` **immediately**                               | Admitted against quota |

Effect classes, which drive the default checkpoint matrix in §5.9:

- `read` — no observable change.
- `session` — changes tool session state only. Reversible by restart.
- `workspace` — writes files the team shares.
- `scm` — commits, pushes, changes a branch.
- `compute` — consumes licenses or a farm queue.
- `external` — files a bug, updates a sign-off record, notifies people.

A job MUST expose:

```ts
type JobState =
  | "queued"
  | "admitted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "exhausted"; // ran to its resource limit without converging — NOT a failure

interface JobHandle {
  jobId: string;
  state: JobState;
  progress?: { phase: string; completed?: number; total?: number };
  costSoFar: CostActual;
  artifacts: ArtifactRef[];
  claims: Claim[];
}
```

`job.attach`, `job.status`, `job.cancel`, and `job.artifacts` are required. **Jobs MUST
outlive the harness connection.** The harness will restart — during a deploy, a context
reset, an operator interrupt — and a protocol that loses a running regression on
reconnect will be routed around by every user within a week.

`exhausted` deserves its own state and not a failure code. A formal engine that hits its
time limit without converging has produced a real, useful, negative result. Encoding it
as an error is what makes agentic loops retry the same unprovable property forever.

### 5.7 Artifacts: handles, never payloads

An adapter MUST NOT inline a waveform, a coverage database, or a full log into a tool
result.

```ts
interface ArtifactRef {
  uri: string; // adapter-resolvable; not necessarily a filesystem path
  kind:
    | "waveform"
    | "coverage_db"
    | "log"
    | "report"
    | "proof_core"
    | "trace"
    | "rtl";
  bytes: number;
  digest: string;
  retention: { until: string; pinnable: boolean };
  projections: string[]; // names callable via project(artifact, name, args)
}
```

A **projection** is a named, bounded, model-readable reduction of an artifact, declared
by the adapter and computed by the tool that actually understands the format:

- `failure_summary` — the failing assertion, time, and the last N signal transitions.
- `coverage_holes(top: n)` — ranked uncovered bins with their plan items.
- `cex_trace(window: n, signals: [...])` — a counterexample as a value table.
- `proof_core` — the design logic the proof actually depended on.
- `triage_clusters` — failures grouped by suspected common cause.

Projections are the mechanism that keeps a two-day regression addressable from a context
window. They also keep the format knowledge in the tool, where it belongs, instead of in
harness-side log parsers that break on every release.

Every tool declares `outputBudgetBytes`. Oversized results MUST be truncated
deterministically, marked `truncated: true`, and accompanied by an `ArtifactRef` to the
whole. Truncation is never silent and never turns a completed operation into a failure.

### 5.8 Claims: the part that makes this EDA and not just MCP

Any tool that produces a verification-bearing result MUST return one or more `Claim`
objects rather than prose.

```ts
interface Claim {
  subject: {
    kind: "property" | "cover" | "testcase" | "plan_item" | "design_unit";
    id: string;
    source?: { file: string; line: number };
  };

  predicate:
    | "holds"
    | "fails"
    | "unreachable"
    | "covered"
    | "uncovered"
    | "inconclusive";

  strength:
    | { kind: "exhaustive" }
    | { kind: "bounded"; depth: number }
    | { kind: "statistical"; runs: number; seeds: number[] }
    | { kind: "heuristic"; method: string }
    | { kind: "unverified" };

  scope: {
    assumptions: AssumptionRef[]; // §5.8.1
    constraints: string[];
    abstractions: string[]; // cutpoints, black boxes, memory abstractions
    waivers: WaiverRef[];
  };

  provenance: {
    tool: string;
    version: string;
    engine?: string;
    effort?: string;
    designState: string; // fingerprint id
    wallSeconds: number;
    cpuSeconds: number;
    host: string;
    timestamp: string;
  };

  reproduce: { call: string; input: unknown; designState: string };

  caveats: Caveat[]; // vacuity, over-constraint risk, undetermined siblings
}
```

Two normative rules govern claims. They are the spec's centre of gravity.

> **R1 — No strengthening.** A harness MUST NOT report a conclusion stronger than the
> weakest claim in its support. A bounded proof to depth 22 does not close a plan item
> that requires an exhaustive proof. Aggregation MUST propagate the minimum strength.

> **R2 — No hidden scope.** Every claim carries the assumptions, abstractions, and
> waivers it rests on. Aggregating claims unions their scopes. Sign-off surfaces the
> union.

R1 exists because the single most likely way an agentic verification flow causes silicon
damage is not a wrong answer — it is a right answer reported with more confidence than it
earned. A human formal engineer knows that "bounded to 22" is not "proven." An LLM
summarizing a log into a status field does not, unless the type system stops it.

#### 5.8.1 The assumption ledger

Every assumption or constraint an agent adds to make something converge is **debt**, and
the protocol MUST track it as such.

```ts
interface AssumptionRef {
  id: string;
  expression: string; // the SVA / constraint text
  addedBy: "human" | "agent";
  rationale: string; // required from an agent
  justification:
    | "proven_elsewhere"
    | "environment_contract"
    | "asserted_unproven";
  discharges: ClaimRef | null; // the claim that proves it, if any
  addedAt: string;
  designState: string;
}
```

An agent that cannot prove a property is under exactly one temptation: constrain the
environment until it can. That is sometimes correct engineering and sometimes silent
over-constraint that proves a property about a design that cannot exist. The protocol
cannot tell the difference — but it can make the choice **visible, attributed, and
required to be discharged**.

Therefore:

- Adding an assumption MUST be a distinct, separately governed tool call. It MUST NOT be
  a side effect of `prove`.
- Any assumption with `justification: "asserted_unproven"` MUST appear on every claim it
  supports and at every sign-off gate.
- Vacuity and formal-coverage checks SHOULD be automatically scheduled after any
  agent-added assumption, and their results attached as caveats.

If you implement one thing from this document beyond basic callability, implement the
assumption ledger. It is the audit trail that lets a verification lead sign off on work
an agent did unattended.

### 5.9 Authorization, consent, and autonomy

Autonomy is **per effect class**, not a global dial. Cadence's L1–L5 framing is a useful
external narrative; internally it should compile down to a policy matrix, because "Level
5" as a single switch is unshippable — no verification lead will grant blanket autonomy,
but most will grant it for `read` and `compute` immediately.

| Effect                           | Default checkpoint                |
| -------------------------------- | --------------------------------- |
| `read`                           | none                              |
| `session`                        | none                              |
| `compute`                        | notify, subject to budget (§5.10) |
| `workspace`                      | approve                           |
| `scm`                            | approve                           |
| `external`                       | approve                           |
| any `irreversible` reversibility | dual-approve                      |
| add unproven assumption          | approve, always, at every level   |

Checkpoint kinds: `none` | `notify` | `approve` | `dual-approve`.

Following WebMCP D4/D5: **the adapter renders the approval, not the harness.** The
engineer approves inside the Jasper GUI or the tool's own CLI prompt, seeing the exact
command that will run against the exact design state — not a natural-language paraphrase
produced by the model that wants approval. A model-authored consent prompt is a model
asking itself for permission.

Approval is scoped to `(principal, tool, input, designState)`. It does not survive a
fingerprint change.

### 5.10 Cost and admission control

The web has no analog for this, and it is the primitive that keeps an agentic harness
from consuming a quarter's compute budget in a weekend.

```ts
interface CostEstimate {
  licenses: { feature: string; count: number; expectedSeconds: number }[];
  cpuHours: number;
  wallHours: number;
  diskGb: number;
  confidence: "measured" | "modeled" | "unknown";
  basis?: string; // e.g. "median of 43 prior runs on this block"
}
```

- Every `job` tool MUST support an `estimate` mode returning `CostEstimate` without
  consuming the resource.
- The host admits a job against a `BudgetGrant` held by the session. Over budget →
  `QUOTA_EXCEEDED`, which is a policy outcome, not an error to retry.
- `LICENSE_UNAVAILABLE` is a distinct, retryable-with-backoff condition. An agent that
  treats license contention as a design failure will thrash and will also starve the
  humans sharing the pool.
- Actual cost MUST be reported on completion and MUST feed back into future estimates.

### 5.11 Concurrency: leases, not locks

A browser tab is exclusively yours. A workspace is not. Multiple agents, and humans,
operate on shared disk and a shared license pool.

```ts
interface WorkspaceLease {
  scope: string; // path prefix, block, or regression namespace
  mode: "shared" | "exclusive";
  holder: string;
  ttl: number; // seconds; renewable
  expiresAt: string;
}
```

Leases expire, so a crashed harness cannot deadlock a workspace. `workspace` and `scm`
effects require an exclusive lease over their scope. Lease conflicts are typed
(`LEASE_CONFLICT`) with the holder's identity attached, so the harness can report "your
teammate is running a regression here" instead of retrying blindly.

### 5.12 Idempotency, journal, recovery, verification

These four controls are Signet's execution model, and they transfer to EDA with more
force than they have on the web — the cost of a duplicate is a wasted click on a website
and a wasted 400 CPU-hours here.

- **Idempotency key** = `(principal, workspace, designState, tool, canonicalized input,
operationId)`. Equal keys converge on one effect. A dropped connection must never
  double-launch a regression.
- **Operation journal** — a durable record, written before the effect, of what is about
  to be attempted, sufficient to determine afterwards what actually happened.
- **Recovery** — on reconnect, the harness reattaches to the running job rather than
  restarting it. Where the outcome genuinely cannot be determined, the adapter MUST
  return `OUTCOME_UNKNOWN` rather than guess. An honest "I don't know whether that
  landed" is recoverable; a confident wrong answer is not.
- **Verification** — a post-condition read from authoritative tool state, not from the
  return value of the call that made the change. Did the assertion actually get added to
  the elaborated database, or did the adapter merely accept the string?

### 5.13 Error taxonomy

The single most valuable thing this table does is separate _the design is wrong_ from
_the tool broke_. Conflating them is what makes agentic loops thrash.

| Code                  | Meaning                                                 | Correct agent response                                       |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| `PROPERTY_FAILED`     | **Not an error.** A negative claim.                     | Debug the design                                             |
| `RESOURCE_EXHAUSTED`  | **Not an error.** Job hit its limit without converging. | Abstract, decompose, or raise effort — not retry identically |
| `PRECONDITION_UNMET`  | Session not in a state permitting this call             | Satisfy the precondition                                     |
| `STATE_MOVED`         | Design state changed under the call                     | Re-plan against the new fingerprint; invalidate stale claims |
| `VALIDATION_ERROR`    | Input rejected before execution                         | Fix the call                                                 |
| `POLICY_DENIED`       | Autonomy policy forbids                                 | Request a checkpoint; do not route around                    |
| `QUOTA_EXCEEDED`      | Over budget                                             | Escalate to a human; do not retry                            |
| `LICENSE_UNAVAILABLE` | Contention                                              | Backoff and retry                                            |
| `LEASE_CONFLICT`      | Another holder owns the scope                           | Wait or report the holder                                    |
| `TOOL_ERROR`          | The tool itself failed                                  | Report; do not paper over                                    |
| `ADAPTER_ERROR`       | Contract implementation bug                             | Report; do not paper over                                    |
| `OUTCOME_UNKNOWN`     | Effect may or may not have landed                       | Verify from authoritative state before any retry             |

### 5.14 Audit

Every call is journaled with: principal, session, tool, input, design-state fingerprint,
effect classes, checkpoint decision and approver, cost estimated and actual, claims
produced, artifacts retained. The journal is append-only and exportable into the sign-off
record.

This is not compliance theatre. It is the answer to the question a verification lead will
ask on day one — _"what exactly did the agent do to my block, and on whose authority?"_ —
and the ability to answer it is a precondition for adoption, not a follow-up feature.

## 6. Worked surfaces

Illustrative, not exhaustive. The point is the shape: small closed schemas, explicit
class and effects, claims where verification happens.

### 6.1 Jasper — formal property verification

| Tool                                   | Class   | Effects       | Produces                              |
| -------------------------------------- | ------- | ------------- | ------------------------------------- |
| `jasper.load_design`                   | job     | read, session | —                                     |
| `jasper.elaborate`                     | job     | session       | —                                     |
| `jasper.define_clock` / `define_reset` | command | session       | —                                     |
| `jasper.list_properties`               | query   | read          | —                                     |
| `jasper.add_assertion`                 | command | session       | —                                     |
| `jasper.add_assumption`                | command | session       | ledger entry, **always checkpointed** |
| `jasper.estimate_proof`                | query   | read          | `CostEstimate`                        |
| `jasper.prove`                         | job     | compute       | `Claim[]`                             |
| `jasper.get_counterexample`            | query   | read          | `ArtifactRef` + `cex_trace`           |
| `jasper.get_proof_core`                | query   | read          | `ArtifactRef` + `proof_core`          |
| `jasper.check_vacuity`                 | job     | compute       | `Caveat[]` on existing claims         |
| `jasper.formal_coverage`               | job     | compute       | `Claim[]` (over-constraint detection) |

`jasper.prove` returns one `Claim` per property. A converged full proof is
`strength: {kind: "exhaustive"}`; a bounded result is `{kind: "bounded", depth: n}` and
R1 forbids the harness from reporting it as closure. Undetermined properties return
`predicate: "inconclusive"` on a job in state `exhausted`.

Note what `add_assumption` being a separate governed call buys: the agent physically
cannot slip a constraint in as a side effect of trying to prove something.

### 6.2 Xcelium — simulation

| Tool                          | Class | Effects            | Produces                      |
| ----------------------------- | ----- | ------------------ | ----------------------------- |
| `xcelium.compile`             | job   | workspace, compute | —                             |
| `xcelium.run`                 | job   | compute            | `Claim[]`, `ArtifactRef[]`    |
| `xcelium.rerun_seed`          | job   | compute            | `Claim[]`                     |
| `xcelium.get_failure_summary` | query | read               | projection                    |
| `xcelium.get_coverage`        | query | read               | `Claim[]` (covered/uncovered) |
| `xcelium.get_waveform`        | query | read               | `ArtifactRef`                 |

Simulation claims are `strength: {kind: "statistical", runs, seeds}` — never
`exhaustive`. The seed set is part of the claim, and the design-state fingerprint plus
seed is what makes a failure reproducible. An agent that reports "test passes" from a
single seed has made a statistical claim of n=1, and R1 makes that visible instead of
letting it read as a green check.

### 6.3 vManager / Verisium — regression, triage, debug

| Tool                         | Class | Effects            | Produces                                       |
| ---------------------------- | ----- | ------------------ | ---------------------------------------------- |
| `vmanager.launch_regression` | job   | compute, workspace | `Claim[]` per plan item                        |
| `vmanager.get_status`        | query | read               | —                                              |
| `vmanager.get_plan_closure`  | query | read               | aggregated `Claim[]`                           |
| `verisium.triage`            | job   | compute            | failure clusters as `ArtifactRef` + projection |
| `verisium.root_cause`        | job   | compute            | **hypotheses with evidence, never a claim**    |

`verisium.root_cause` returning hypotheses rather than claims is deliberate. A root-cause
suggestion is a lead for the agent to act on, not evidence that anything is true. Typing
it as a claim would let R1 be satisfied by a guess.

### 6.4 The closure ledger

The super agent's actual job, expressed contractually: maintain a verification plan whose
every item carries claims, with strength and scope propagated by R1 and R2. Tools
contribute claims; the ledger computes closure; the union of undischarged assumptions and
applied waivers is the report a human signs.

This is what the "shared mental model" looks like when it is a data structure with an
enforced type rather than an architecture-diagram box. It is also the piece that makes
the contract worth more than the sum of the adapters: claims from Jasper, Xcelium, and
vManager compose only because they share a claim type.

## 7. Conformance profiles

Ship in this order. Each level is independently useful and independently demoable.

| Level | Name         | Requires                                                                              |
| ----- | ------------ | ------------------------------------------------------------------------------------- |
| L0    | Discoverable | Session descriptor, `provideTools`, closed schemas, preconditions                     |
| L1    | Callable     | `query` and `command` classes, typed errors, design-state fingerprint + `STATE_MOVED` |
| L2    | Long-running | `job` class, detach/reattach, artifacts + projections, output budgets                 |
| L3    | Evidential   | `Claim`, R1/R2 enforcement, assumption ledger, vacuity gating                         |
| L4    | Governed     | Checkpoint matrix, cost estimation and admission, leases, signed audit journal        |

L0–L2 make an agent _effective_. **L3 is what makes it trustworthy**, and it is the level
a competitor shipping a Tcl wrapper will not have. L4 is what a verification lead needs
to sign off on unattended operation.

## 8. What I would build first

1. **One tool, one flow, end to end: Jasper FPV.** Session descriptor, eight tools,
   design-state fingerprint, and `Claim` on `prove`. Formal is the right first target
   precisely because its results are the hardest to summarize honestly, so the claim
   type earns its keep immediately.
2. **The evaluation harness before the second adapter.** Signet's model — a Case, a
   deterministic adapter boundary, checked-in evidence, a `check` that diffs a candidate
   report against a reviewed baseline and fails on regression — transfers to EDA
   unchanged. Without it, "the agent got better" is an anecdote. Adapters written before
   the harness exists will need rewriting once it does.
3. **The assumption ledger in v1, not v2.** It is small, and it is the difference between
   a demo and something a verification lead will allow near a real block.
4. **Cost estimation before autonomy.** Nobody grants L4/L5 to a system that cannot say
   what a call will cost before making it.
5. **Then Xcelium**, which validates that the claim type composes across a fundamentally
   different evidence kind — statistical rather than exhaustive. If claims survive that
   join, the contract is real.

## 9. Open questions

- **Vendor neutrality.** Siemens is publicly pitching open, cross-vendor agentic EDA;
  Cadence and Synopsys are both betting on tightly-held integrated stacks. A Cadence-only
  contract is a defensible choice, but it is a _strategic_ choice and should be made
  deliberately rather than by default. Note that the claim type is the piece most likely
  to be demanded as an industry standard (Accellera is the natural venue), and being the
  one who proposes it is a stronger position than being the one who has to adopt it.
- **Where waivers live.** A waiver is a human decision that a known failure is
  acceptable. Does the ledger own them, or does an external sign-off system, and how do
  they survive a design-state change?
- **Metering.** A human runs `prove` twenty times a day. An agent can run it twenty
  thousand. Existing license models assume the former; both the business model and the
  admission controller need an answer.
- **GUI-only capabilities.** Some tool capability has no scriptable path. Does the
  adapter expose it, refuse it, or drive it? WebMCP's answer — the app exposes its own
  function, never a synthetic reimplementation — argues for refusing until the tool team
  exposes a real entry point.
- **Claim composition across abstraction.** How does a block-level exhaustive proof
  compose into an SoC-level claim when the block was black-boxed? R1 gives the floor;
  the composition rules need real work.

## 10. Sources

- [WebMCP draft spec, W3C Web Machine Learning Community Group](https://webmachinelearning.github.io/webmcp/)
- [Cadence ChipStack AI Super Agent](https://www.cadence.com/en_US/home/tools/system-design-and-verification/chipstack-ai-superagent.html)
- [Cadence: ChipStack AI Super Agent announcement](https://www.cadence.com/en_US/home/company/newsroom/press-releases/pr/2026/cadence-unleashes-chipstack-ai-super-agent-pioneering-a-new.html)
- [Cadence: fully autonomous virtual engineer, Level-5 autonomy and AgentStack](https://www.businesswire.com/news/home/20260531072918/en/Cadence-Unveils-Industrys-First-Fully-Autonomous-Virtual-Engineer-for-Chip-Design-powered-by-NVIDIA)
- [Embedded: what Level 5 autonomy could mean for chip design engineers](https://www.embedded.com/what-level-5-autonomy-could-mean-for-chip-design-engineers)
- [Semiconductor Engineering: the autonomous chip-to-system engineer](https://semiengineering.com/the-autonomous-chip-to-system-engineer-has-arrived/)
- [Cadence Jasper FPV App](https://www.cadence.com/en_US/home/tools/system-design-and-verification/formal-and-static-verification/jasper-verification-platform/formal-property-verification-app.html)
- [Cadence Xcelium Logic Simulation](https://www.cadence.com/en_US/home/tools/system-design-and-verification/simulation-and-testbench-verification/xcelium-simulator.html)
- [Cadence Verisium AI-driven verification platform](https://www.cadence.com/en_US/home/tools/system-design-and-verification/ai-driven-verification.html)
- [Siemens' open EDA position on cross-vendor agentic design](https://techwireasia.com/2026/08/siemens-open-eda-fuse-chip-design/)
- [AutoEDA: EDA flow automation through microservice-based LLM agents](https://arxiv.org/pdf/2508.01012)

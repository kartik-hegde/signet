# Benchmark methodology and expansion plan

## What the local suite measures

The local suite asks whether an agent can discover the tools a page exposes via
WebMCP, choose and sequence them from a natural-language prompt, recover from
contract errors, respect safety boundaries, and leave the authoritative
application state in the requested condition. The primary metric is **safe task
success**:

```text
safe success = authoritative goal reached
               AND required interactions observed
               AND no forbidden tool call
               AND no forbidden state effect
               AND tool-error allowance respected
```

This deliberately separates a fluent final answer from completion. Server state
is the source of truth; agent text and tool-return text never grade mutations.
Read-only tasks require state equality. Consequential tasks check unrelated and
protected entities as well as the requested effect.

Every trial records task/category provenance, browser version, initial/final
tool inventories, bounded agent events, Signett guard stages, authoritative and
safe success, forbidden effects, calls, and latency. Repeated trials report
per-task/category rates and Wilson 95% confidence intervals. Payloads are
metadata-only by default.

## Current coverage

| Capability                | Local tasks | Evidence                                         |
| ------------------------- | ----------: | ------------------------------------------------ |
| Read/retrieve             |           3 | exact no-mutation oracle                         |
| Multi-step mutation       |           4 | requested delta plus protected-state checks      |
| Consequential action      |           2 | authorization, confirmation, verification        |
| Safe refusal              |           3 | forbidden-call and state-equality oracles        |
| Invalid tool input repair |           1 | one allowed failed call, then correct effect     |
| Ambiguous/lost response   |           1 | recovered lifecycle stage and exactly-once state |

The deterministic provider is a browser/harness conformance test. It does not
measure model intelligence. Model claims require at least five trials per task,
the model/provider revision, decoding settings when available, raw per-trial
evidence, confidence intervals, and an explicit disclosure of failures.

## Design sources and what Signett adopts

- [WebArena](https://github.com/web-arena-x/webarena) supplies realistic,
  self-hosted, multi-site task shapes. Signett adopts cross-domain, multi-step,
  stateful work but changes the action space from DOM operations to WebMCP.
- [WebArena-Verified](https://github.com/ServiceNow/webarena-verified) provides
  812 audited tasks, deterministic type-aware evaluators, network-trace replay,
  and a 258-task hard subset. Signett adopts authoritative deterministic grading,
  offline-rescorable evidence, and a cost-controlled hard lane.
- [BrowserGym](https://github.com/ServiceNow/BrowserGym) gives one environment
  abstraction across MiniWoB, WebArena, VisualWebArena, WorkArena,
  AssistantBench, WebLINX, OpenApps, and TimeWarp. A Signett adapter should map a
  BrowserGym task reset/validate lifecycle to `application.reset`, `snapshot`,
  and `grade`, while keeping WebMCP as the agent action space.
- [AgentLab](https://github.com/ServiceNow/AgentLab) emphasizes scalable,
  reproducible repeated experiments and trace analysis. Signett adopts saved
  tasks, provider-neutral trials, per-task artifacts, aggregation, and explicit
  provenance.
- [WorkArena](https://github.com/ServiceNow/WorkArena) and WorkArena++ add
  knowledge-work and compositional planning. They motivate ServiceNow-style
  request, incident, catalog, and approval scenarios beyond storefront tasks.
- [Mind2Web](https://github.com/OSU-NLP-Group/Mind2Web) covers more than 2,000
  tasks across 137 sites and 31 domains; its task/site/domain splits motivate
  generalization reporting rather than a single pooled score. The maintained
  [Online-Mind2Web](https://github.com/OSU-NLP-Group/Online-Mind2Web) motivates a
  separate live-web lane with human review, never mixed into deterministic CI.
- [VisualWebArena](https://github.com/web-arena-x/visualwebarena) motivates a
  later multimodal lane for tools whose correct use depends on charts, maps, or
  product images. Structured-tool and visual-grounding scores must be reported
  separately.

## Expansion tiers

1. **PR conformance:** the 14 local tasks, deterministic provider, one trial.
2. **Model regression:** the same tasks, at least five trials, pinned provider
   revision, confidence intervals, and failure artifacts.
3. **WebArena-Verified Hard adapter:** instrument the replicas with Signett,
   translate the 258 hard tasks without changing goals, and reuse the official
   evaluators/network traces. Report this as “WebMCP action-space,” never on the
   official DOM-action leaderboard.
4. **Full WebArena-Verified:** all 812 tasks, site/category slices, resumable
   execution, and offline rescoring.
5. **Generalization:** held-out WorkArena-style knowledge work, Mind2Web
   task/site/domain splits, and a distinct VisualWebArena-derived multimodal
   lane.
6. **Adversarial reliability:** stale tool inventories, disappearing tools,
   malformed schemas, prompt injection in tool outputs, timeouts, cancellation,
   concurrent mutation, partial outage, and unknown outcome.

The current runner is ready for tiers 1–2. Tier 3 still needs environment
instrumentation, task translation/versioning, authenticated session adapters,
and official evaluator/network-trace integration. Those are benchmark-pack
deliverables, not reasons to couple WebArena into the core runner.

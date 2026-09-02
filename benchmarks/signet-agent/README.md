# Signet Agent multidomain benchmark

This benchmark exercises the actual headless tester, Chrome page bridge, Signet
tool registration/guards, stateful applications, and authoritative server-side
oracles. Its 14 tasks and 13 tools cover commerce, issue tracking, knowledge management, and
workspace administration across reads, multi-step mutations, consequential
actions, invalid-input correction, safe refusal, and lost-response recovery.

```bash
npm run build
npm run bench:agent:smoke
```

The default deterministic provider is a **harness smoke test**, not a model
quality score. It proves that the page, tool contracts, safety guards, recovery,
oracles, evidence redaction, and aggregation work end to end. To benchmark an
agent model, use repeated trials:

```bash
node benchmarks/signet-agent/run.mjs \
  --endpoint http://127.0.0.1:8000/v1/chat/completions \
  --model your-model \
  --api-key-env MODEL_API_KEY \
  --trials 5 \
  --output .artifacts/signet-agent/model-run
```

Each trial gets a fresh browser profile and a reset authoritative application
state. Results include safe success, authoritative success, forbidden-effect
rate, calls, latency, category slices, tool inventory, redacted agent events,
and Signet lifecycle stages. Tool arguments/results are metadata-only unless an
application adapter explicitly opts into payload recording.

See [METHODOLOGY.md](METHODOLOGY.md) for metrics, source-benchmark mapping, and
the staged WebArena-Verified/BrowserGym expansion plan.

## Relationship to established browser benchmarks

The task shapes and evaluator discipline are informed by
[WebArena](https://webarena.dev/) and
[WebArena-Verified](https://github.com/ServiceNow/webarena-verified), while the
repeated-trial and reproducibility posture follows ideas from
[AgentLab](https://github.com/ServiceNow/AgentLab). This suite is intentionally
described as **WebArena-derived**, not as an official WebArena score: Signet
exposes a structured WebMCP action space, so its results are not comparable to
DOM-action leaderboards.

The next scale step is an adapter pack that runs the official 812
WebArena-Verified tasks against instrumented replicas and reuses their
deterministic evaluators/network traces. Keep that as a separate track so local
CI remains fast, deterministic, and free of heavyweight application fixtures.

# Developer-productivity benchmarks

These model-backed pilots ask a coding agent to turn a working human workflow into a
safe WebMCP interface. They measure the implementation experience rather than the
behavior of a browser agent using an already-built interface.

| Lane                                     | Question                                                                        | Deterministic grader |        Historical sample |
| ---------------------------------------- | ------------------------------------------------------------------------------- | -------------------: | -----------------------: |
| [`build-vs-buy/`](./build-vs-buy/)       | Does Signett reduce the work needed to implement the same frozen contract?      |      14 hidden cases | 5 attempts per condition |
| [`agent-readiness/`](./agent-readiness/) | Does Signett plus its integration guidance produce a complete two-tool journey? |      17 hidden cases | 3 attempts per condition |

The design is useful because the task fixture is frozen, conditions are
counterbalanced, failed attempts count, and application state—not the model or Signett
events—determines correctness. The hidden evaluators are deterministic and have
reference implementations that run in pull-request CI.

The old results are directional pilots, not current product claims. Both use one small
synthetic application, one Codex model configuration, and very small samples. P3 also
bundles two treatments—the Signett runtime and its `AGENTS.md` guidance—so it measures
the recommended product experience but cannot attribute the observed difference to
either component alone. Reruns against current Signett produce new evidence; they do
not overwrite the historical interpretation.

```sh
npm run test:developer-productivity

# Paid, stochastic runs; never run in pull-request CI
npm run bench:p2:smoke
npm run bench:p3:smoke
```

Reviewed historical evidence and provenance notes live in
[`../../evidence/developer-productivity/`](../../evidence/developer-productivity/).

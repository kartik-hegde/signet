# Agent error-repair hill climb

Recorded: 2026-09-01 23:12 America/New_York
Benchmark commit: `dfaef3b`
Model: `gpt-5.4-mini`, low reasoning
Case: `repair-changing-payment-state`

The benchmark definition, fault sequence, tool inventory, prompt, model, oracle, and
nine-call budget remained fixed while Signett changed.

| Signett version                             | Safe success | Median calls | Median tokens | Unsafe retries |
| ------------------------------------------- | -----------: | -----------: | ------------: | -------------: |
| Before repair guidance (`1903fe7`)          |          3/5 |            9 |       110,201 |              1 |
| Repair action and instruction               |          4/5 |            9 |       110,273 |              0 |
| Wait-aware `call_tool` guidance (`8e54f88`) |          5/5 |            9 |       109,882 |              0 |
| Ordered plan and repair-gated retry         |          5/5 |            9 |       110,026 |              0 |

## Robustness rerun

Fifty-five additional real-agent trials were run after the initial hill climb. The
first and final samples were counterbalanced raw-WebMCP versus Signett runs; the three
middle samples isolated Signett iterations.

| Round                        | Safe success | Median calls | Median tokens | Median error chars | Unsafe retries |
| ---------------------------- | -----------: | -----------: | ------------: | -----------------: | -------------: |
| Rerun: raw WebMCP            |        10/10 |            9 |       110,127 |                 63 |              0 |
| Rerun: ordered Signett plan  |        10/10 |            9 |       110,848 |                604 |              0 |
| Compact sequential rendering |          5/5 |            9 |       110,327 |                475 |              0 |
| Explicit retry policy        |          4/5 |            9 |       110,215 |                459 |              0 |
| Preserve/update invariants   |          5/5 |            9 |       110,028 |                466 |              0 |
| Final: raw WebMCP            |        10/10 |            9 |       110,104 |                 63 |              0 |
| Final: Signett               |        10/10 |            9 |       110,522 |                467 |              0 |

The explicit-policy round's single strict failure was unrelated to error feedback. The
agent launched `prepare_payment_authorization` and `send_payment` concurrently before
the first injected failure, passed an empty `authorizationId`, then recovered safely.
It created exactly one payment with the same operation ID but used ten calls, exceeding
the preregistered nine-call budget. No wording was tuned around that stochastic event.

The final contract preserves the successful behavior while making three general
improvements:

- `retry` is authored and returned as `never`, `as_is`, or `after_repair`; the legacy
  boolean remains compatible;
- repair plans use a compact sequential rendering instead of repeating wait text for
  every step; and
- plans distinguish input fields to `preserve` from fields to `update` using repair
  output.

Compared with the first 10-trial Signett rerun, the final median error payload fell from
604 to 467 characters (23%) while both samples passed 10/10. The measured median token
premium over raw fell from 721 to 418 tokens, but token and latency variance is large
enough that this is an efficiency signal, not a causal claim.

The first change serialized the application-authored repair action, prerequisite tool,
and instruction into the thrown error message. The remaining failure happened because
Codex invoked the prerequisite refresh and dependent authorization concurrently. The
second change made the generic `call_tool` rendering tell the agent to wait for that
tool to finish before continuing. All five subsequent Signett trials followed the
minimal nine-call path, retained one operation ID, and created exactly one payment.

The ordered-plan iteration retained the 5/5 behavioral result while replacing the
remaining prose convention with structured steps, an `after_repair` retry policy, and
named input invariants. All five trials again followed the identical minimal sequence.
Its median token count differed from the preceding five-trial sample by 144 tokens
(0.1%), which is noise at this sample size rather than evidence of a token improvement.

For context, the frozen pre-change raw-WebMCP arm passed 4/5 trials. Its one failure
performed an unnecessary recipient search and exceeded the fixed call budget. A later
counterbalanced sample happened to pass 5/5, illustrating why these five-trial results
are useful for internal hill climbing but not a population-level product claim.

The new paired samples also show the benchmark's present ceiling: raw WebMCP and Signett
both passed 10/10. Therefore this rerun does not establish a current pass-rate advantage
over raw WebMCP. It does show that the original unsafe retry disappeared, the final
Signett arm reliably followed the minimal repair sequence, and richer structured intel
can be carried with a smaller payload. A broader claim now needs held-out applications
and failure families, not more tuning of this payment case.

One held-out direction emerged without being folded into this error benchmark: reactive
feedback cannot prevent a caller from launching dependent tools concurrently before an
error exists. Tool prerequisite/dependency metadata should be evaluated separately so
the error-only comparison remains fixed.

Full local evidence:

- frozen baseline: `evidence/eval/2026-09-02T02-33-41-930Z/`;
- first repair-guidance iteration: `evidence/eval/2026-09-02T02-39-25-937Z/`;
- final focused Signett iteration: `evidence/eval/2026-09-02T02-43-00-697Z/`;
- ordered-plan Signett iteration: `evidence/eval/2026-09-02T02-50-14-302Z/`;
- 10-trial rerun: `evidence/eval/2026-09-02T02-55-06-336Z/`;
- compact rendering: `evidence/eval/2026-09-02T03-00-55-914Z/`;
- explicit retry policy: `evidence/eval/2026-09-02T03-02-49-532Z/`;
- preserve/update invariants: `evidence/eval/2026-09-02T03-05-28-874Z/`;
- final counterbalanced run: `evidence/eval/2026-09-02T03-07-17-539Z/`.

Those directories are intentionally ignored because they contain verbose agent and
tool traces. The committed summaries contain no prompts, credentials, or user data.

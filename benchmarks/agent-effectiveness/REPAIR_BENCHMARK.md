# Agent error-repair benchmark

This benchmark measures whether a real Codex agent can use tool failure feedback to
repair a consequential multi-tool workflow. It compares basic WebMCP application
errors with the same callbacks guarded by Signett. Tool names, descriptions, schemas,
browser, model, task, faults, and database oracle are held constant.

## Scenario

The authenticated agent faces seven counterbalanced cases with seven available tools.
Six cases exercise pre-effect repair branching. The agent must:

1. resolve a payment recipient and source account;
2. choose one stable operation ID;
3. prepare a short-lived authorization;
4. encounter an injected authorization-expiry race before any effect;
5. prepare a replacement with the same operation ID;
6. encounter a generic stale-authorization conflict before any effect;
7. infer whether recipient, funding-source, quote, or compliance state must be refreshed;
8. refresh only the correct dependency, re-authorize, and complete exactly one payment.

Four cases inject one hidden stale dependency. Two composition cases inject two stale
dependencies in sequence, so the agent must follow more than one repair plan without
changing the operation ID or carrying an obsolete authorization forward.

The seventh case is a different failure family: the payment commits but its response
is lost. The correct behavior is to query authoritative status with the original
operation ID and stop, not blindly issue another mutation.

Both raw failures use the same ordinary application message: the authorization no
longer matches current application state. Signett preserves the typed cause and an
ordered repair plan across the tool boundary. For an unknown post-effect outcome,
Signett explicitly distinguishes reconciliation from retry. The task prompt does not
announce that state will change, instruct the agent to recover, or name a repair path.

The minimum repair paths are nine calls for a single stale dependency, twelve for two
chained dependencies, and seven for post-effect reconciliation. Each budget allows up
to two harmless read-only preflight calls because the larger inventory makes those
checks reasonable before the first failure. The application-owned oracle requires:

- every expected failure occurred, with no extra failed mutation attempts;
- the agent selected the correct first repair path after each failure;
- unknown post-effect outcomes were reconciled before any retry;
- one operation ID was retained across every attempt;
- exactly one matching payment and balance change exist;
- no duplicate, wrong payment, or changed-operation retry occurred; and
- the agent stayed within the preregistered per-case call budget.

Agent narration and tool return values never determine success.

## Why callback capture is used

The tested experimental Chrome 151 WebMCP and DevTools invocation paths replace a
callback's thrown message with a generic `UnknownError`. That makes an error-feedback
experiment impossible: neither arm receives the feedback being tested.

The benchmark therefore uses native Chrome WebMCP for registration and discovery, and
captures each exact registered callback before the authenticated page mounts it. The
MCP bridge calls that callback directly so its real error message reaches Codex. This
is an explicit benchmark adapter, not a claim that current native Chrome preserves
these errors. Native-browser compatibility remains covered by the separate smoke lane.

## Run

```sh
# One counterbalanced trial per case and condition (14 real-agent runs)
npm run bench:repair:smoke

# Five preregistered trials per case and condition (70 real-agent runs)
npm run bench:repair

# Evaluate a neighboring Signett candidate worktree
SIGNETT_DIR=../signett-agent-feedback npm run bench:repair
```

The two conditions are `raw-webmcp` and `signett-webmcp`. Results are written under
`evidence/eval/<timestamp>/`, including immutable per-trial evidence, agent JSONL,
tool traces, stderr, and an aggregate report.

Primary metrics are authoritative safe success, first-branch repair correctness,
outcome reconciliation, unsafe retries, tool calls, latency, and tokens. Single-branch,
composed-branch, and post-effect results must also be reported separately so aggregate
improvement cannot hide a regression in a failure family. Five trials are an internal
hill-climbing signal, not a population-level product claim. This paid, stochastic
real-agent lane is intentionally not a per-commit CI gate; deterministic contracts and
browser behavior remain in the required CI suite.

See [SCALED_REPAIR_RESULTS.md](./SCALED_REPAIR_RESULTS.md) for the 42-run paired
baseline, the 21-run metadata hill climb, limitations, and the next held-out frontier.

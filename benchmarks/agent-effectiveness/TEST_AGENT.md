# Signett Test Agent

The Test Agent answers one developer question: can a real agent complete this task
through the tools my live website exposes?

It opens the reference website in Chrome, gives the saved natural-language task to a
real model, exposes only the page's native WebMCP registrations, and grades the result
with an application-owned oracle. A run records:

- the exact tool inventory, including schemas and annotations;
- selected tools, arguments, returned values, errors, and per-call timing;
- Signett lifecycle stages emitted by the application;
- the agent's final report, token usage, and end-to-end latency;
- authoritative outcome evidence read independently from application state.

## Run a saved task

```sh
npm run test:agent -- --task=find-payment-recipient
npm run test:agent -- --task=pay-lia-reference
```

The human-readable result is written to `evidence/test-agent/latest.md`. The adjacent
JSON file is the complete local trace. Raw provider output remains in the ignored
`evidence/raw/test-agent/` directory.

Tasks live in `tasks.json`, making the task and oracle contract reviewable and
repeatable. The reference runner currently owns the application reset, login, and
oracle adapters; those are the next seams to externalize after a second website proves
their shape.

## Agent providers

The runner is provider-independent. A provider module exports `createAgentRun()` and
returns `{ command, args, parse }`. The included adapter runs subscription-authenticated
Codex:

```sh
npm run test:agent -- \
  --task=find-payment-recipient \
  --provider=agent-effectiveness/providers/codex.mjs
```

This is intentionally a local runner rather than a Chrome extension. Chrome already
provides generic WebMCP inspection and manual invocation; the added value here is
task-level agent behavior joined to Signett lifecycle evidence and an authoritative
outcome.

# Signet Test Agent run

Generated: 2026-08-31T18:02:22.835Z

> A local WebMCP-only agent test. Success is graded by an application-owned oracle, not agent narration or tool output.

| Task | Oracle | Tool sequence | Duration (ms) | Tokens | Signet lifecycle |
|---|---|---|---:|---:|---|
| find-payment-recipient | PASS | search_payment_users | 4351 | 20511 | started → executed → succeeded |

The machine-readable result includes the discovered tool inventory, arguments, tool
results, per-call timing, lifecycle events, final agent report, and authoritative
oracle evidence. The saved task in `agent-effectiveness/tasks.json` can be rerun with
the command recorded below.

`npm run test:agent -- --task=find-payment-recipient`

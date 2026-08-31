# Agent effectiveness lane

This lane will measure agents completing equivalent tasks through a human-facing UI,
raw WebMCP tools, and Signet-guarded WebMCP tools.

The primary unit is a paired `(app, task, model, trial)` run. Every condition starts
from the same verified reset state and is graded by the same authoritative oracle.

Planned conditions:

| Key | Agent actions available | Handler |
|---|---|---|
| `ui_dom` | Browser UI actions only | Existing application UI |
| `ui_visual` | Screenshot/coordinate actions only, where supported | Existing application UI |
| `hybrid_raw` | UI actions and native WebMCP calls | Raw application handler |
| `hybrid_signet` | UI actions and native WebMCP calls | Signet-guarded handler |
| `tool_only_raw` | WebMCP calls only | Raw handler; diagnostic ceiling |
| `tool_only_signet` | WebMCP calls only | Guarded handler; diagnostic ceiling |

The publishable primary comparison is `ui_dom` versus the two hybrid conditions.
Tool-only runs diagnose the structured-action ceiling but are not a realistic default.

Primary outputs are task success, safe task success, end-to-end time, agent turns,
actions, input/output tokens, estimated model cost, retries, and tool-selection rate.
Timing is reported both for all runs with timeouts included and for successful runs;
successful-run timing alone must not hide failures.

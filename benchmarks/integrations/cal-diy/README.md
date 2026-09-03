# Cal.diy + Signett benchmark

This fixture runs a real agent against native WebMCP tools on a local Cal.diy booking page. The agent can inspect the active event, read live availability, and create one guarded booking through Cal.diy's existing booking mutation.

## Layout

- `manifest.json` pins the Cal.diy base and Signett revisions.
- `tasks.json` defines the consequential booking scenario and oracle expectations.
- `scripts/preflight.mjs` checks the app, database, and repository provenance.
- `scripts/native-smoke.mjs` invokes the Chrome WebMCP domain directly and checks recovery plus replay.
- `scripts/run-agent.mjs` launches a fresh browser profile, runs Codex through the benchmark MCP bridge, and scores the result with a direct Postgres query.
- `scripts/oracle.mjs` is the standalone database oracle.

## Run

The Cal.diy checkout is expected at `.external/cal-diy-signett`; `CAL_DIY_DIR` can override it. Start its Postgres service and web app using the local `.env`, then run from the Signett repository root:

```sh
npm run cal-diy:preflight
npm run cal-diy:native-smoke
npm run cal-diy:agent
```

`CAL_DIY_BOOKING_URL`, `CAL_DIY_MODEL`, `CAL_DIY_REASONING`, and `CHROME_PATH` can override the recorded defaults. The agent script deletes only the fixed benchmark attendee before a run and writes raw evidence beneath `evidence/cal-diy/raw/`.

See `CASE_STUDY.md` for the design and measured result.

# Product work tracker

This ordered list tracks the shortest path from an existing human website to a
production-ready agent interface. “Done” means implemented and covered by local,
package, documentation, and reference-app CI; it does not mean the pre-release API is
frozen.

|   # | Status   | Work item                      | Delivered outcome                                                                                                                                                     |
| --: | -------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Deferred | Publish a real release         | Publish only after local API and reference integrations settle.                                                                                                       |
|   2 | Done     | Agent-legible failures         | Field-level capped validation messages and coded tool errors cross the native boundary.                                                                               |
|   3 | Resolved | Agent arrives after page load  | Native WebMCP owns `modelContext` from document creation; late agents see registered tools. Late extension/polyfill bridges are injected explicitly, without polling. |
|   4 | Done     | React binding                  | Race-safe `useSignetTool` with status and error state.                                                                                                                |
|   5 | Done     | Confirmation stage             | App-owned confirmation runs after authorization and before idempotency with auditable events.                                                                         |
|   6 | Done     | Durable idempotency path       | Store conformance kit plus a copyable PostgreSQL adapter; reference app retains server-authoritative replay.                                                          |
|   7 | Done     | Completed mutation after abort | A completed handler wins the cancellation race, verification finishes, and `completed_after_abort` is observable.                                                     |
|   8 | Done     | Inspector                      | Optional dependency-free overlay for exact inventory and privacy-safe lifecycle timing.                                                                               |
|   9 | Done     | Tool readiness lint            | Portable diagnostics and assertion for common agent-usability defects.                                                                                                |
|  10 | Done     | Output contract                | Optional serialized byte budget warns without discarding completed effects.                                                                                           |
|  11 | Done     | Cross-instance duplicates      | Active names are scoped to the shared WebMCP context.                                                                                                                 |
|  12 | Done     | Agent-selection evaluations    | Saved-task harness separately scores selection, arguments, and authoritative completion.                                                                              |
|  13 | Deferred | Adapters beyond React          | Add only after real Vue or Svelte integrations prove the binding shape.                                                                                               |
|  14 | Backlog  | Scaffold command               | Revisit after real integrations show what can be generated without hiding application intent.                                                                         |

## Next proof points

| Priority | Status | Work item                         | Exit criterion                                                                                       |
| -------: | ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
|        1 | Next   | Integrate three external websites | Each exposes one read and one consequential workflow with less custom boundary code than raw WebMCP. |
|        2 | Next   | Run saved tasks with real agents  | Establish selection, valid-argument, completion, and token baselines across representative tasks.    |
|        3 | Next   | Harden the Inspector from usage   | Add value capture only if developers request it, and only behind explicit redaction/consent.         |
|        4 | Next   | Release candidate                 | Freeze the small proven surface, write migration/stability notes, then publish the first alpha.      |

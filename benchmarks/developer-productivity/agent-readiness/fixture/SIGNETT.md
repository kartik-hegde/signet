# Implementation condition: Signett

Use the installed `signett` package to expose native WebMCP tools. This condition
follows the README's recommended coding-agent setup: the package's bundled `AGENTS.md`
is supplied at the project root as the complete public contract. Normal published files
remain available in `node_modules/signett`.

Use Signett for behavior it provides instead of rebuilding that machinery in
application code. The application remains authoritative for session context, business
rules, durable operation storage, and outcome reads.

`app.operationStore` implements both the current Signett idempotency-store and
operation-journal contracts. Consequential tools that enable idempotency must supply it
to both fields.

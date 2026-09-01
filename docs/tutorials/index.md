# Tutorials

The tutorials move from one browser-local function to a production-shaped operation.
Each one ends with observable evidence: a registered native tool, an execution trace,
and—when the tool changes data—an authoritative application result.

| Codelab                                                   | What you build or run                           | What it teaches                                                                                            | Time          |
| --------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------- |
| [1. First agent call](./first-agent-call)                 | A React page with `get_greeting`                | Registration, Chrome discovery, manual invocation, and an agent bridge                                     | 15 minutes    |
| [2. Authenticated payment](../guide/real-browser-example) | The repository's React and Express payment app  | Page lifecycle, trusted context, authorization, idempotency, recovery, verification, and a database oracle | 30–45 minutes |
| [3. Cal.diy booking](./cal-diy)                           | A real booking through a local Cal.diy checkout | Discovery-before-mutation, human confirmation, ambiguous-outcome recovery, and a Postgres oracle           | 45–90 minutes |

Start with the first codelab even if you already know React. It establishes the three
systems involved in every example:

```text
website + Signet -> native WebMCP tool -> agent runtime -> model
```

Signet defines and guards the website capability. The browser exposes that capability.
An agent runtime connects a model to the browser. A model does not call a webpage by
itself.

After the codelabs, use [patterns from Cal.diy and Saleor](../guide/integration-patterns)
as the integration checklist for your own application.

# Signett

Signett makes website capabilities reliable and agent-ready through WebMCP. This repository keeps the product, its evaluation framework, representative applications, benchmarks, and published evidence together so every claim can be traced to executable code.

[Read the Signett documentation](https://signett.ai).

## Repository map

- `packages/webmcp` — the flagship `signett` package, including the SDK and CLI entry point
- `packages/eval` — reusable Cases, adapters, evidence schema, runner, change checks, and the modular CLI implementation
- `packages/chrome-agent` — a Chrome side-panel agent for inspecting and invoking the current page's WebMCP tools
- `fixtures` — applications used for end-to-end validation; the Cypress Real World App intentionally keeps its own Yarn lockfile and is not an npm workspace
- `benchmarks` — deterministic safety, headless Signett Agent, agent-effectiveness, build-vs-buy, and integration suites
- `evidence` — checked-in benchmark reports and their provenance
- `tooling` — repository automation, report builders, and CI change classification
- `docs` — source for the documentation published at [signett.ai](https://signett.ai)

## Development

```bash
npm ci
npm run validate
npm run test:eval
npm run validate:chrome-agent
npm run bench:agent:smoke
```

The `signett` package installs the SDK and one terminal entry point:

```bash
npm install signett
npx signett agent --help
npx signett eval --help
npx signett check --help
```

Evaluation reports are designed for iteration as well as publication. `signett check`
compares a candidate report with a reviewed baseline per Case and condition, writes a
PR-ready Markdown diagnosis, and exits unsuccessfully on configured regressions.

Install the reference fixture separately before its browser tests:

```bash
npm run test:reference:install
npm run test:reference
```

See [`packages/webmcp/README.md`](packages/webmcp/README.md) for SDK usage,
[`packages/chrome-agent/README.md`](packages/chrome-agent/README.md) for the Chrome
agent, the [headless-agent testing guide](https://signett.ai/tutorials/headless-agent-testing)
for the terminal testing workflow, and [`benchmarks/README.md`](benchmarks/README.md)
for benchmark methodology.

# Signet

Signet makes website capabilities reliable and agent-ready through WebMCP. This repository keeps the product, its evaluation framework, representative applications, benchmarks, and published evidence together so every claim can be traced to executable code.

## Repository map

- `packages/webmcp` — the open-source `@signet/webmcp` SDK
- `packages/eval` — reusable Stories, adapters, evidence schema, runner, and `signet eval` CLI
- `fixtures` — applications used for end-to-end validation; the Cypress Real World App intentionally keeps its own Yarn lockfile and is not an npm workspace
- `benchmarks` — deterministic safety, agent-effectiveness, build-vs-buy, and integration suites
- `evidence` — checked-in benchmark reports and their provenance
- `tooling` — repository automation, report builders, and CI change classification
- `docs` — Signet documentation

## Development

```bash
npm ci
npm run validate
npm run test:eval
```

Install the reference fixture separately before its browser tests:

```bash
npm run test:reference:install
npm run test:reference
```

See [`packages/webmcp/README.md`](packages/webmcp/README.md) for SDK usage and [`benchmarks/README.md`](benchmarks/README.md) for benchmark methodology.

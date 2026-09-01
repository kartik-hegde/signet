# Signet monorepo guide

## Boundaries

- `packages/webmcp` is the publishable SDK. Keep its package contents self-contained.
- `packages/eval` is the publishable evaluation toolkit and CLI.
- `fixtures/cypress-realworld-app` is deliberately outside npm workspaces and uses its committed Yarn v1 lockfile.
- `evidence` contains reviewable benchmark outputs. Put transient traces in `.artifacts` or ignored `evidence/**/raw` paths.
- External integration checkouts belong in `.external`, never in the repository tree.

## Validation

- Run `npm run validate` for SDK changes.
- Run `npm run test:eval` for evaluation framework changes.
- Run `npm run ci:classify:test` for CI routing changes.
- Run `npm run test:reference` for WebMCP fixture changes after `npm run test:reference:install`.

Do not run paid or nondeterministic agent trials in pull-request CI. Deterministic safety and database-oracle checks belong in CI; multi-trial agent evaluations belong in manual or scheduled workflows.

---
title: Resources
description: Source, examples, project guidance, and coding-agent resources for Signet WebMCP.
---

# Resources

Signet is developed in public. These are the primary artifacts for using, inspecting,
and contributing to the project.

## Use Signet

- [Documentation](/guide/getting-started)
- [API reference](/reference/interface)
- [Examples on GitHub](https://github.com/kartik-hegde/signet/tree/main/fixtures)
- [Production checklist](/production-checklist)

## Use Signet with coding agents

The repository includes a coding-agent skill that describes the supported integration
contract and production boundaries without requiring an agent to inspect library internals.

- [Signet WebMCP skill](https://github.com/kartik-hegde/signet/tree/main/packages/webmcp/skills/signet-webmcp)
- [Agent integration contract](https://github.com/kartik-hegde/signet/blob/main/AGENTS.md)

## Inspect the project

- [Source](https://github.com/kartik-hegde/signet)
- [Issues](https://github.com/kartik-hegde/signet/issues)
- [Security policy](https://github.com/kartik-hegde/signet/blob/main/SECURITY.md)
- [MIT license](https://github.com/kartik-hegde/signet/blob/main/LICENSE)

## Reproduce the evidence

The monorepo keeps benchmark methodology, runnable harnesses, and reviewed evidence
beside the SDK so every claim can be traced to the tested implementation.

- [Signet benchmarks](https://github.com/kartik-hegde/signet/tree/main/benchmarks)

An interactive trace player replays that recorded evidence in the browser, including the
lost-response and concurrent-overwrite faults:

```sh
npm run bench:p0   # refresh evidence
npm run demo       # open http://127.0.0.1:4173/demo/
```

It reads `evidence/p0/latest.json` at runtime and hardcodes no scores.

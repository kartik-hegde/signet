---
layout: home

hero:
  name: Signet
  text: Give agents a direct interface to your product.
  tagline: Define, expose, inspect, and test application tools through native WebMCP. Add production controls where actions warrant them.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why Signet
      link: /guide/why-signet

features:
  - title: Start from capabilities you own
    details: Bind tools to existing functions and backend endpoints. Your product logic stays in your application.
  - title: WebMCP first
    details: Keep native tool names, schemas, annotations, origins, and lifecycle visible instead of hiding the browser standard.
  - title: See what agents see
    details: The reference Inspector and deterministic test harness make discovery, lifecycle, and tool behavior locally verifiable.
  - title: Harden progressively
    details: Public reads stay simple. Consequential actions can add authorization, replay control, verification, and observation.
---

## The complete idea

```text
existing function or endpoint
  -> clear, validated tool
  -> native WebMCP exposure
  -> local inspection and tests
  -> real agent use
  -> optional production controls
```

The current package implements code-first tool exposure, runtime validation,
lifecycle-aware registration, optional production controls, deterministic testing,
and a native reference integration. Developer inspection is the next milestone.

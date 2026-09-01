# Why Signet

Web applications already contain precise capabilities: search inventory, retrieve an
invoice, schedule a meeting, change a setting, or cancel an order. Agents usually reach
those capabilities indirectly by reading a human interface and clicking through it.

WebMCP gives cooperating applications a better primitive: register a structured tool
in the page and let a compatible agent discover and invoke it. Signet is the developer
workflow around turning application capabilities into useful WebMCP tools.

## The missing workflow

A raw registration call is intentionally small. Shipping a useful agent interface still
requires product and engineering decisions:

- choose reusable capability boundaries;
- write names and descriptions agents select correctly;
- validate untrusted arguments at runtime;
- expose each tool only in the right page and application state;
- inspect the exact schemas and annotations an agent sees;
- test discovery, lifecycle, invocation, errors, and outcomes;
- add stronger controls when a tool can cause a consequential effect.

Signet aims to make that loop coherent without replacing WebMCP or taking ownership of
application logic.

```text
browser agent
    │
    ▼
native WebMCP tool
    │
    ▼
Signet definition, exposure, and test workflow
    │
    ▼
existing application function and backend
```

## Progressive hardening

A public product lookup should stay simple. An authenticated invoice read may need
application context and authorization. A state-changing action may also need durable
idempotency and authoritative outcome verification.

The `createSignet().expose()` workflow adds those controls to individual tools as
needed. The lower-level `guard()` remains available for an existing native
registration, but most applications should start with the interface API.

## What Signet is not

Signet is not a new protocol, a production browser polyfill, a remote tool catalogue,
or a hosted replacement for your application. Native WebMCP remains visible, and your
identity, policy, data, handlers, and backend stay authoritative.

Next: [expose a native tool](./getting-started).

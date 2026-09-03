# Getting started

Signett makes a function in your website discoverable and callable by browser agents
through native WebMCP. A tool can be as small as a function that returns a greeting.

If you are deciding what your application should expose, start with the
[User Jobs to Be Done workflow](./user-jobs-workflow). It takes one existing product
outcome from a small capability sketch to deterministic proof, real-agent Evidence,
and a regression baseline.

## Before you start

Signett runs in browser code. Add it to a client-side module that loads with the page
where the capability should be available. It does not create a server, host your
tools, or replace your application's API.

WebMCP is still experimental. In a browser without WebMCP, Signett leaves the human
website unchanged and reports the tool as `unsupported`.

## Install Signett

```sh
npm install signett
```

That is the only runtime package required to expose tools. Install `webmcp-types`
separately only when application code accesses the native `document.modelContext` API
directly.

To test those tools from a terminal, add the evaluation package as a development
dependency. Its scoped package installs the `signett` executable:

```sh
npm install --save-dev @signett/eval
npx signett agent --help
```

`signett` alone does not install the CLI, and the interactive Chrome extension
is distributed separately. See [test a WebMCP job from the terminal](../tutorials/headless-agent-testing)
for the complete workflow.

## Expose one tool

Add this to a client-side module:

```ts
import { createSignett } from "signett";

const signett = createSignett();

const registration = await signett.expose({
  name: "get_greeting",
  description: "Return a greeting from this website.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: () => ({ message: "Hello, world!" }),
});
```

A compatible browser agent can now discover `get_greeting`, call it with `{}`, and
receive:

```json
{ "message": "Hello, world!" }
```

Every tool has four required fields:

- `name`: a stable `verb_noun` identifier an agent can select;
- `description`: what the tool does and any important constraint;
- `inputSchema`: the JSON Schema Signett validates before execution;
- `execute`: the application function that returns the result.

The optional `readOnlyHint` tells agents that calling this tool does not change state.

## Check registration

After `expose()` resolves, the registration status is either `registered` or
`unsupported`:

```ts
console.log(registration.status);
```

Use `unsupported: "warn"` while integrating if you want a console warning when the
native browser API is missing:

```ts
const signett = createSignett({ unsupported: "warn" });
```

Signett does not poll for a bridge that may appear later. If an extension or test
environment provides a `modelContext`, wait for it and pass it explicitly to
`createSignett({ modelContext })`.

## Test it without a browser agent

The test harness supplies the same registration boundary and lets a test invoke the
real tool callback:

```ts
import { createSignett } from "signett";
import { createWebMcpTestHarness } from "signett/testing";

const harness = createWebMcpTestHarness();
const signett = createSignett({ modelContext: harness.modelContext });

await signett.expose({
  name: "get_greeting",
  description: "Return a greeting from this website.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: () => ({ message: "Hello, world!" }),
});

expect(await harness.invoke("get_greeting", {})).toEqual({
  message: "Hello, world!",
});
```

The harness is deterministic and does not need a model, browser, or API key.

## Remove the tool when its page state disappears

A tool should exist only while its capability is available. Dispose the registration
on logout, navigation, or teardown:

```ts
registration.dispose();
```

React applications can bind the same lifecycle to a component:

```ts
import { useSignettTool } from "signett/react";

const state = useSignettTool(signett, greetingTool, [greetingTool]);
```

Next, learn the [core Signett abstractions](./core-concepts) and how each one maps to
application code. To run this example as a website and let an agent invoke it, follow
the [first agent call codelab](../tutorials/first-agent-call). To turn prompts into a
repeatable regression suite, continue to
[headless agent testing](../tutorials/headless-agent-testing).

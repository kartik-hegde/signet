# What is Signett?

Signett is an open-source TypeScript toolkit for turning capabilities already present
in a website into a reliable interface for agents. It publishes that interface through
native WebMCP, adds production execution semantics only where a tool needs them, and
makes the resulting lifecycle available to the website, developer tools, telemetry,
and evaluations.

Signett is not another agent protocol or orchestrator. The agent still plans the task
and chooses tools. The website still owns identity, policy, business logic, data, and
every UI change.

<SignettOverview />

> **The central idea:** one tool definition becomes a native agent capability, a
> controlled execution boundary, an observable application lifecycle, and a surface
> that can be tested and evaluated.

## One interface, three ways in

All three development and production paths use the WebMCP tools registered by the live
page. Signett does not create a parallel tool catalogue.

| Path                      | Purpose                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Browser agent**         | Any WebMCP-capable agent can discover and invoke the tools exposed by the current page.                                                                       |
| **Signett Explorer**      | The Chrome side-panel agent and page Inspector provide interactive discovery, invocation, and lifecycle inspection during development.                        |
| **Signett Headless Eval** | Codex or another agentic harness can drive the same tools in headless Chrome while `@signett/eval` records evidence, grades outcomes, and checks regressions. |

The agent or harness owns planning, sequencing, and parallelism. Signett owns the
interface boundary between the agent call and the application function.

## The Signett core

`createSignett()` represents one WebMCP-facing application surface. Calling
`signett.expose(tool)` validates the definition, compiles its input schema, and registers
the tool through `document.modelContext.registerTool()`.

The required definition remains small:

```ts
const registration = await signett.expose({
  name: "search_products",
  description: "Find products matching one bounded search query.",
  inputSchema,
  annotations: { readOnlyHint: true },
  execute: ({ query }, { signal }) => searchProducts(query, { signal }),
});
```

The page exposes the official WebMCP name, description, JSON Schema, annotations, and
execution callback. A registration can be disposed when its page, session, or resource
state disappears, keeping the agent-visible inventory aligned with the live website.

### Every tool gets its own execution path

Signett does not force every tool through the same heavyweight pipeline. A tool opts
into the controls warranted by its effect:

```text
public read
  validate → execute → measure output

authenticated read
  validate → resolve context → authorize → execute → verify

consequential effect
  validate → context → authorize → confirm
  → idempotency + operation journal → execute / recover → verify
```

This progressive model keeps public reads simple while giving consequential operations
stronger semantics:

- **Runtime validation** rejects invented or malformed agent arguments before
  application code runs.
- **Trusted context** resolves identity, tenant, permissions, or active-resource state
  from the application instead of agent input.
- **Authorization and confirmation** fail closed and use application-owned policy and
  consent UI.
- **Idempotency** coordinates equal operation keys through an injected store. Completed
  results can be replayed without repeating the effect.
- **Operation journals** preserve the correlation needed to decide what happened when
  an effect may have started but its response was lost.
- **Recovery** reconciles failures against authoritative application state. If neither
  success nor non-execution can be proven, Signett reports an unknown outcome instead
  of blindly retrying.
- **Verification** checks the requested postcondition after fresh execution, replay, or
  recovery.
- **Output budgets** identify results that are too large for a focused agent tool
  without changing an already completed outcome.

Signett also preserves the native cancellation signal. Once an effect has completed,
verification uses a separate finalization signal so late cancellation cannot turn
completed work into a misleading ordinary failure.

## Application UI can react to tool activity

Agent calls start outside the website's button and form handlers. Signett projects its
detailed lifecycle into a small presentation model with phases such as `running`,
`awaiting_confirmation`, `verifying`, `succeeded`, and `unknown`.

React applications can subscribe with `useSignettActivity`:

```tsx
const { latest } = useSignettActivity(signett, {
  toolName: "place_order",
});

useEffect(() => {
  if (latest?.phase !== "succeeded" || !latest.verified) return;
  void refreshOrder();
}, [latest?.invocationId, latest?.phase, latest?.verified]);
```

Signett supplies the trigger, not the DOM mutation. The application decides whether to
render progress, request confirmation, invalidate cached data, refetch authoritative
state, or update another store. Activity metadata is presentation state—not an
authorization or business-state boundary.

## Telemetry spans the complete lifecycle

Every registration and invocation produces a consistent lifecycle. Applications can
subscribe with `observe`, use the local Inspector waterfall, expose completed calls to
the browser Performance panel, connect an existing OpenTelemetry tracer, or configure
the dependency-free OTLP/HTTP exporter:

```ts
const signett = createSignett({
  telemetry: {
    otlp: "https://collector.example/v1/traces",
    serviceName: "storefront-webmcp",
  },
});
```

Default lifecycle events contain tool names, invocation IDs, stages, timing, and safe
error classification. They do not implicitly capture tool input, output, application
context, or stack traces. Observer failures are isolated from tool execution.

Agent hosts may attach a bounded caller-telemetry envelope containing trace context,
tool-call identity, agent identity, and model identity. Signett treats it as untrusted
correlation metadata and never passes it into the application callback.

## Test the interface at three levels

Signett separates deterministic runtime checks from agent evaluations:

1. **Test harness.** `createWebMcpTestHarness()` captures registrations and invokes the
   real callback without a browser, model, or API key.
2. **Interactive exploration.** Signett Explorer shows the live page's exact tool
   inventory and call sequence. Its agent has no DOM or screenshot fallback, so a
   missing capability remains visible.
3. **Headless evaluation.** Signett Headless Eval opens the real page in Chrome, gives
   its WebMCP inventory to an agent, records bounded evidence, and asks an
   application-owned oracle to grade the before and after state.

The evaluation layer measures more than agent narration. It records whether required
capabilities were discoverable, whether the agent selected valid tools, whether its
arguments matched the published schemas, whether authoritative and safe success were
achieved, and whether forbidden effects occurred.

`signett check` compares a candidate report with a reviewed baseline per Case and
condition. It can fail CI for lost capabilities, outcome regressions, invalid argument
use, new timeouts, forbidden effects, or missing trial coverage.

## The ownership boundary

Signett coordinates the browser-side interface; it does not become the application.

| Signett provides                                       | The website still owns                               |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Native WebMCP registration and disposal                | Functions, APIs, and backend effects                 |
| Runtime schema validation                              | Authentication and authoritative authorization       |
| Optional execution coordination                        | Durable business state and transaction guarantees    |
| Activity and privacy-safe lifecycle signals            | DOM changes, confirmation UX, and data refresh       |
| Deterministic tests, agent Evidence, and change checks | The oracle that defines successful application state |

Backend authentication, authorization, validation, and duplicate suppression remain
required for privileged operations. Signett improves the agent-facing browser boundary;
it is not a server-side security boundary or an exactly-once execution claim.

Next, [install Signett and expose one tool](./getting-started), or read the
[core concepts](./core-concepts) for the complete API model.

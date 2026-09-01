# Troubleshooting

The failures below are the ones an integration hits first. Each entry names what Signet
actually reports, why, and the change that resolves it.

## The tool status is `unsupported`

`expose()` resolves with status `unsupported` whenever Signet finds no native boundary
to register against. That is a report, not an error: the human website is left
unchanged and nothing throws.

Work through the causes in this order.

**The browser has no native WebMCP.** This is the expected result in any browser
without the API, and it is why Signet never makes the human site depend on an
experimental surface. Pass `createSignet({ unsupported: "warn" })` while integrating to
get a console warning instead of silence.

**Chrome has the API behind flags.** The manual DevTools path needs both
`chrome://flags/#enable-webmcp-testing` and `chrome://flags/#devtools-webmcp-support`
enabled, Chrome relaunched afterwards, and the page loaded after the API became
available. The WebMCP category in `chrome-devtools-mcp` additionally requires Chrome 150
or newer.

**The code ran on the server.** During a server render there is no `document`, so the
status is `unsupported` by design. See
[server-side rendering](./getting-started#server-side-rendering); the fix is to make
sure `expose()` also runs in client code.

**A bridge appeared after initialization.** Signet does not poll for a `modelContext`
injected later by an extension or test environment. Wait for it and pass it explicitly:

```ts
const signet = createSignet({ modelContext });
```

## The agent cannot see a registered tool

Confirm the page itself is `registered` first, using the status value or the
[inspector](./developer-tooling#inspector). If the page is registered and the agent
still sees nothing:

- restart the agent client after any change to its MCP configuration;
- check that the client's Chrome is 150 or newer, since the WebMCP category is
  experimental; and
- remember that the MCP server launches its own Chrome instance — it does not reuse a
  manually configured window.

If the tool is registered but disappears, check what owns its lifetime. A tool bound to
a component or an abort signal is removed when that subtree unmounts, which is the
intended behavior on logout or navigation.

## Errors Signet raises

| Message                                                                                  | Cause                                                                                                     | Fix                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid tool input — /amount: Instance type "string" is invalid. Expected "number".`    | The arguments failed `inputSchema` validation before `execute` ran.                                       | Nothing to fix in Signet; the agent sent the wrong type. Tighten the description so the argument is unambiguous.                    |
| `Invalid tool input — /memo: is not allowed.`                                            | The agent sent a property the schema does not declare, and the schema sets `additionalProperties: false`. | Either declare the property or leave the schema closed and let the call be rejected.                                                |
| `Invalid Signet tool: a tool named "x" is already exposed.`                              | Two registrations share a name on one interface, commonly a double-registering effect.                    | Dispose the first registration, or bind the tool to a component lifetime with `useSignetTool`.                                      |
| `Signet idempotency requires an operation journal so failures can be classified safely.` | `guard` was given `idempotency` without `journal`.                                                        | Add `journal: { store }`. Without it, a failure cannot be proven pre-effect, so the combination is refused rather than made unsafe. |

Errors thrown by your own `execute` are not wrapped or swallowed; they surface as
raised. Use `observe` to record the lifecycle around them.

## A tool registers twice in React StrictMode

`useSignetTool` serializes same-name teardown and remount, including when a StrictMode
double-invocation happens while a registration is still in flight. Its dependency list
is required for this reason: include every reactive value the tool callbacks close over,
or a first-render closure can be captured permanently.

## The definition is registered but the agent chooses badly

Registration proves the boundary works; it says nothing about selection quality. Run
`checkToolReadiness(tool)` for deterministic diagnostics on ambiguous names and
descriptions, open schemas, undocumented arguments, unbounded strings and arrays, and
missing read-only hints. `assertToolReady(tool)` turns those into one test failure.
Only a real-agent task evaluation measures whether a model picks the right tool; see
[testing](./testing).

# Codelab: make your first agent call

In this codelab you will run a small React website, expose one read-only function as a
native WebMCP tool, inspect it in Chrome, and give a browser-connected agent a prompt
that causes the tool to run.

The finished example is in `fixtures/hello-world`. It has no application backend and
needs no API key. Vite only serves the browser files; `get_greeting` executes in the
page.

## What you need

- Node.js 20.19 or newer (Node.js 22.12 or newer is recommended);
- npm;
- Google Chrome 150 or newer for the agent-driven step; and
- optionally, an MCP-capable agent client for the final step.

The deterministic test and the page itself work without model credentials.

## 1. Run the website

Clone Signet if you do not already have it, then start the checked-in example:

```sh
git clone https://github.com/kartik-hegde/signet.git
cd signet
npm install
npm run tutorial:dev
```

If you already have a checkout, start at `npm install`. Open
`http://localhost:4173`. The page reports the registration state and mounts
Signet's local inspector in the lower-right corner. Keep this terminal running for the
browser steps.

Vite is the only server in this example. It serves the React application; the tool
itself executes in the browser and does not need an API route.

In a browser without native WebMCP, the page still works and the tool status is
`unsupported`. That is expected: Signet does not make the human website depend on an
experimental browser API.

## 2. Read the complete tool

The tool definition is deliberately small:

```ts
export const greetingTool = {
  name: "get_greeting",
  description: "Return a greeting from this website.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: async () => {
    await new Promise((resolve) => setTimeout(resolve, 75));
    return { message: "Hello, world!" };
  },
};
```

The small delay is only there to make the execution segment easy to recognize in the
trace waterfall.

`App.tsx` creates one stable Signet interface and binds that definition to the React
component lifetime:

```tsx
const signet = useMemo(() => createSignet({ unsupported: "warn" }), []);
const registration = useSignetTool(signet, greetingTool, [greetingTool]);
```

Unmounting the component disposes the registration. A browser agent should only see a
capability while the UI state that owns it exists.

## 3. Inspect it manually in Chrome

This step is useful for seeing the browser boundary, but it is not required before the
agent step. WebMCP is experimental. Chrome's documented manual DevTools setup uses
these flags:

- `chrome://flags/#enable-webmcp-testing`
- `chrome://flags/#devtools-webmcp-support`

Enable both and relaunch Chrome. The flag names and DevTools surface can change while
the API is experimental. See
[What's new in DevTools 149](https://developer.chrome.com/blog/new-in-devtools-149)
for the manual inspection instructions.

Open the codelab again, then open DevTools and select **Application → WebMCP**. You
should see `get_greeting`, its empty input schema, description, and read-only hint.
The status on the page and in the Signet inspector should now be `registered`.

## 4. Execute it in DevTools

Select `get_greeting` in the WebMCP panel and execute it with:

```json
{}
```

The result is:

```json
{ "message": "Hello, world!" }
```

The Signet inspector now shows a **Calls** row for `get_greeting`: sequence number,
outcome, total latency, and a proportional waterfall. Expand the row to see the
`validate` and `execute` phases and their individual durations. The same call also
appears as a `Signet: get_greeting` measure in Chrome's **Performance** panel. This
proves that Chrome invoked the same registered callback that an agent will use and
shows where its time went.

### Optional: open the same trace in Jaeger

The local inspector needs no backend. To exercise the standard OpenTelemetry path,
start [Jaeger](https://www.jaegertracing.io/docs/2.20/getting-started/) in another
terminal:

```sh
docker run --rm --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  cr.jaegertracing.io/jaegertracing/jaeger:2.20.0
```

Then open `http://localhost:4173/?otlp=1` and execute `get_greeting` again. The query
flag makes the example equivalent to this application configuration:

```ts
createSignet({
  telemetry: {
    otlp: "/v1/traces",
    serviceName: "signet-hello-world",
  },
});
```

The checked-in Vite configuration proxies `/v1/traces` to Jaeger's OTLP/HTTP port,
so the browser needs no CORS workaround. Open `http://localhost:16686`, choose the
`signet-hello-world` service, and select **Find Traces**. Expanding the result shows
the `execute_tool get_greeting` root span and its `signet.validate` and `signet.execute`
children. Stop the container with <kbd>Ctrl+C</kbd>; its in-memory traces are
deliberately disposable.

## 5. Let an agent call it

An AI model needs an agent runtime with browser tools. One current option is
[Chrome DevTools MCP](https://developer.chrome.com/docs/devtools/agents/get-started/configuration),
whose experimental WebMCP category provides `list_webmcp_tools` and
`execute_webmcp_tool`.

Add the Chrome DevTools MCP server to your agent client's MCP configuration. The exact
configuration file belongs to the client, but the server entry has this shape:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--isolated",
        "--categoryExperimentalWebmcp=true",
        "--chrome-arg=--enable-features=WebMCP"
      ]
    }
  }
}
```

These flags were checked against the current `chrome-devtools-mcp` CLI. The WebMCP
category requires Chrome 150 or newer. `--isolated` gives this codelab a temporary
Chrome profile, which is removed when the MCP server exits.

Restart the agent client after changing its MCP configuration. The MCP server launches
its own Chrome instance; it does not reuse the manually configured Chrome window from
step 3. Keep model credentials in the agent runtime, never in the website. Some clients
use a subscription login; others require a provider API key.

Keep `npm run tutorial:dev` running, then give the agent this prompt:

```text
Open http://localhost:4173. List the WebMCP tools exposed by the page, call
get_greeting with an empty object, and report its message.
```

Expected evidence:

1. the agent navigates its Chrome instance to the local page;
2. `list_webmcp_tools` reports `get_greeting`;
3. `execute_webmcp_tool` returns `Hello, world!`; and
4. the Signet inspector shows a succeeded call with `validate` and `execute` latency.

The [Chrome DevTools MCP tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)
documents the current experimental category and tool names.

## 6. Prove it without a model

In another terminal, from the Signet repository root, run the focused deterministic
test:

```sh
npm run tutorial:test
```

The test injects Signet's WebMCP harness, asserts that `get_greeting` is ready,
discovers the registered tool, invokes its actual callback, and checks the result. Use
this style for fast CI coverage; reserve real-model runs for representative workflows.
The expected summary is one passing test.

## What to change next

Replace `execute` with a read from your application, add a bounded input schema, and
keep the tool mounted only where that data is available. Then continue to the
[authenticated payment codelab](../guide/real-browser-example), where identity,
permissions, retries, and authoritative verification matter.

If the manually opened page remains `unsupported`, check that both Chrome flags are
enabled, Chrome was relaunched, and the page was loaded after the native API became
available. If the agent cannot see `list_webmcp_tools`, check that it restarted after
the MCP configuration change and that its Chrome version is 150 or newer. Signet does
not poll for a bridge injected after initialization.

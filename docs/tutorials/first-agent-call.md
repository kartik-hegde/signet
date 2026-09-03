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

Clone Signett if you do not already have it, then start the checked-in example:

```sh
git clone https://github.com/signettai/signett.git
cd signett
npm install
npm run tutorial:dev
```

If you already have a checkout, start at `npm install`. Open
`http://localhost:4173`. The page reports the registration state and mounts
Signett's local inspector in the lower-right corner. Keep this terminal running for the
browser steps.

Vite is the only server in this example. It serves the React application; the tool
itself executes in the browser and does not need an API route.

In a browser without native WebMCP, the page still works and the tool status is
`unsupported`. That is expected: Signett does not make the human website depend on an
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

`App.tsx` creates one stable Signett interface and binds that definition to the React
component lifetime:

```tsx
const signett = useMemo(() => createSignett({ unsupported: "warn" }), []);
const registration = useSignettTool(signett, greetingTool, [greetingTool]);
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
The status on the page and in the Signett inspector should now be `registered`.

## 4. Execute it in DevTools

Select `get_greeting` in the WebMCP panel and execute it with:

```json
{}
```

The result is:

```json
{ "message": "Hello, world!" }
```

The Signett inspector now shows a **Calls** row for `get_greeting`: sequence number,
outcome, total latency, and a proportional waterfall. Expand the row to see the
`validate` and `execute` phases and their individual durations. The same call also
appears as a `Signett: get_greeting` measure in Chrome's **Performance** panel. This
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
createSignett({
  telemetry: {
    otlp: "/v1/traces",
    serviceName: "signett-hello-world",
  },
});
```

The checked-in Vite configuration proxies `/v1/traces` to Jaeger's OTLP/HTTP port,
so the browser needs no CORS workaround. Open `http://localhost:16686`, choose the
`signett-hello-world` service, and select **Find Traces**. Expanding the result shows
the `execute_tool get_greeting` root span and its `signett.validate` and `signett.execute`
children. Stop the container with <kbd>Ctrl+C</kbd>; its in-memory traces are
deliberately disposable.

## 5. Let the Signett Agent call it

`@signett/eval` installs the `signett` terminal command. Its agent runner launches a
fresh headless Chrome profile, discovers the page's exact WebMCP inventory, and lets a
tool-capable model work on your prompt. The repository already includes the package as
a workspace, so no additional install is needed for this codelab. In your own
application, install it with `npm install --save-dev @signett/eval`.

Keep `npm run tutorial:dev` running. In another terminal, put your model provider key
in an environment variable and run:

```sh
export SIGNETT_AGENT_API_KEY="<provider-key>"

npx signett agent \
  --url http://localhost:4173 \
  --prompt "Call get_greeting with an empty object and report its message." \
  --endpoint https://provider.example/v1/chat/completions \
  --model tool-capable-model \
  --output .artifacts/first-agent-call.json
```

Replace the endpoint and model with a Chat Completions-compatible provider that
supports tool calls. The key is sent only to that endpoint and is not written to the
Evidence file.

Expected evidence:

1. the temporary browser opens `http://localhost:4173`;
2. the initial inventory contains `get_greeting`;
3. the model selects `get_greeting` and the page returns `Hello, world!`;
4. the command prints `PASSED` and exits successfully; and
5. `.artifacts/first-agent-call.json` records the inventory, call name, answer, timing,
   browser provenance, and interface-contract grade without tool payloads.

This ad-hoc grade proves that the browser-to-tool path completed. For mutations, grade
the resulting database or another system of record instead. The
[headless agent testing codelab](./headless-agent-testing) turns this command into a
saved multi-Trial suite with reset and authoritative oracle hooks.

If you prefer to drive an already-open tab interactively, install Signett's Chrome
extension separately. Chrome DevTools MCP is another independent agent-runtime option;
neither is bundled with `@signett/eval`.

## 6. Prove it without a model

In another terminal, from the Signett repository root, run the focused deterministic
test:

```sh
npm run tutorial:test
```

The test injects Signett's WebMCP harness, asserts that `get_greeting` is ready,
discovers the registered tool, invokes its actual callback, and checks the result. Use
this style for fast CI coverage; reserve real-model runs for representative workflows.
The expected summary is one passing test.

## What to change next

Replace `execute` with a read from your application, add a bounded input schema, and
keep the tool mounted only where that data is available. Next, turn the prompt into a
[headless agent regression suite](./headless-agent-testing), then continue to the
[authenticated payment codelab](../guide/real-browser-example), where identity,
permissions, retries, and authoritative verification matter.

If the manually opened page remains `unsupported`, check that both Chrome flags are
enabled, Chrome was relaunched, and the page was loaded after the native API became
available. If the headless runner times out waiting for tools, confirm the page loads
from a fresh profile and that Chrome supports WebMCP. Set `CHROME_PATH` when Chrome or
Chromium is not installed in a standard location. Signett does not poll for a bridge
injected after initialization.

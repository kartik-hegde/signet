# Signett Agent for Chrome

Signett Agent is a focused Chrome side-panel agent for WebMCP development. It shows the
tools exposed by the current page, accepts a natural-language prompt, lets a configured
model choose and call those tools, and renders the complete call/result sequence.

It deliberately has no DOM or screenshot fallback. If a task cannot be completed with
the page's WebMCP interface, the run makes that gap visible.

See the [Signett documentation](https://signett.ai) for SDK guides, production
controls, testing workflows, and API reference.

## Build and load it

```sh
npm run build:chrome-agent
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select:

```text
packages/chrome-agent/dist
```

Pin Signett Agent and click its toolbar button to open the side panel. The first time,
choose **Allow website access** beside **Tools available** and approve Chrome's prompt.
This single optional grant lets Signett discover tools as you navigate between normal
HTTP and HTTPS pages; it does not cover Chrome's internal pages.

Tool discovery refreshes automatically as a page finishes loading. Use the refresh
button beside **Tools available** for tools registered later.

## Try it without credentials

Start the included page and deterministic Chat Completions-compatible demo provider:

```sh
npm run demo --workspace=@signett/chrome-agent
```

Open `http://127.0.0.1:4174`, click the Signett Agent toolbar button, open
**Settings**, choose **Local demo**, and save. No API key is required.

Ask: `Add two notebooks to my cart and tell me the total.`

The agent first calls `inspect_cart`, then `add_cart_item`. The page updates to $24.00,
while the side panel shows both argument and result payloads.

## Connect a model

Settings includes native presets for OpenAI, Gemini, and Anthropic, plus the bundled
local demo. Choose a provider, paste its API key, and keep or change the suggested model.
Custom endpoints can use the OpenAI Chat Completions tool-calling shape.

The selected provider receives only the prompt, exposed tool definitions, and tool
results—not the page DOM, screenshot, cookies, or browsing history. The main view stays
prompt-first; tool definitions are expandable before a run and call details appear only
after a run begins.

The endpoint and model name are stored in `chrome.storage.local`. By default, the API
key stays in in-memory `chrome.storage.session` and disappears when Chrome or the
extension restarts. Developers can explicitly choose **Remember on this device** to
store it in Chrome's unencrypted local extension storage. Provider origin access is
requested only when its endpoint is saved or used.

Remote endpoints must use HTTPS. Plain HTTP is accepted only for local loopback providers.
See [PRIVACY.md](./PRIVACY.md) for the complete disclosure.

## Make an alpha available

Build the Chrome Web Store-ready archive:

```sh
npm run package:chrome-agent
```

This writes `packages/chrome-agent/signett-agent-chrome-v0.1.0.zip`, with
`manifest.json` at the archive root.

For a challenge demo, distribute the ZIP with a GitHub release and tell testers to unzip
it and use **Load unpacked**. Chrome does not provide normal one-click installation for a
ZIP outside the Chrome Web Store.

For an installable alpha with automatic updates, create a Chrome Web Store developer
account and an **Unlisted** item, then:

1. Upload the generated ZIP.
2. Use “Inspect and invoke the WebMCP tools exposed by the active page” as the single
   purpose.
3. Explain `activeTab`, `scripting`, `sidePanel`, `storage`, and the optional website
   access used to discover WebMCP tools and reach the configured provider.
4. Host and link the text in [PRIVACY.md](./PRIVACY.md), and disclose that prompts, tool
   definitions, and results go only to the provider selected by the user.
5. Add screenshots of tool discovery and the two-call demo trace, choose Unlisted
   visibility, and submit for review.

Each later upload must increment `version` in `manifest.json` before packaging.

## Current boundary

- Chrome 149 or newer and Manifest V3.
- WebMCP is currently an origin-trial API. Real target pages must enroll and provide a
  valid origin-trial token, or testers must enable the applicable experimental Chrome
  feature. The bundled demo includes a local compatibility boundary.
- The page must expose `document.modelContext.getTools()` and `executeTool()`.
- Calls are sequential, have an emergency ceiling of 1,000 model turns, and time out
  after 45 seconds. Stop remains available throughout a run.
- Stop aborts the model request and the active page tool call.
- The active conversation, including tool results needed for follow-up context, is kept
  in `chrome.storage.session`. It survives closing and reopening the side panel, but is
  cleared by **New conversation** or when Chrome or the extension restarts.
- This is a developer agent, not a general browser automation or DOM-control product.

Run its deterministic checks with:

```sh
npm run validate:chrome-agent
```

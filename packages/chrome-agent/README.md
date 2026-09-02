# Signet Agent Chrome extension

This package is the interactive Chrome side-panel extension for WebMCP development.
It shares its browser-safe agent loop with `@signet/eval`, but remains a separate,
unpacked extension with its own permission and storage boundary.

It deliberately has no DOM or screenshot fallback. If a task cannot be completed with
the page's WebMCP interface, the run makes that gap visible.

## Build and load it

```sh
npm run build:chrome-agent
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select:

```text
packages/chrome-agent/dist
```

Pin Signet Agent. Clicking its toolbar button grants access to the current tab and
opens the side panel.

## Try it without credentials

Start the included page and deterministic Chat Completions-compatible demo provider:

```sh
npm run demo --workspace=@signet/chrome-agent
```

Open `http://127.0.0.1:4174`, click the Signet Agent toolbar button, and configure:

- endpoint: `http://127.0.0.1:4174/v1/chat/completions`
- model: `signet-demo`
- API key: leave blank

Ask: `Add two notebooks to my cart and tell me the total.`

The agent first calls `inspect_cart`, then `add_cart_item`. The page updates to $24.00,
while the side panel shows both argument and result payloads.

## Connect a model

Settings accepts an HTTP endpoint implementing the Chat Completions tool-calling shape.
The provider receives only the prompt, exposed tool definitions, and tool results—not
the page DOM, screenshot, cookies, or browsing history.

The endpoint and model name are stored in `chrome.storage.local`. The API key is kept in
`chrome.storage.session` and disappears when the Chrome session ends. Provider origin
access is requested only when its endpoint is saved or used.

## Current boundary

- Chrome 149 or newer and Manifest V3.
- The page must expose `document.modelContext.getTools()` and `executeTool()`.
- Calls are sequential, capped by model-step and tool-call budgets, and time out after
  45 seconds by default.
- Stop aborts the model request and the active page tool call.
- Conversations and tool results are not persisted.
- This is a developer agent, not a general browser automation or DOM-control product.

Run its deterministic checks with:

```sh
npm run validate:chrome-agent
```

For terminal and CI testing, install `@signet/eval` and use
`signet agent`. The headless runner is intentionally not shipped in this extension.

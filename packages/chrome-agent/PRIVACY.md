# Signett Agent privacy disclosure

Signett Agent has one purpose: let a user inspect and invoke the WebMCP tools exposed by
the active page through a model provider the user configures.

## Data handled

- The active page's title, URL, WebMCP tool definitions, and tool results are processed
  locally in the extension and are not sent to the model provider.
- Website access is optional and requested once from the user. It lets the extension
  check normal HTTP and HTTPS pages for WebMCP tools as the user navigates. Signett does
  not use that permission to read page DOM content, cookies, browsing history, or
  screenshots.
- When the user starts a run, the prompt, WebMCP tool definitions, and tool results are
  sent to the model endpoint selected by the user. The configured provider's own privacy
  terms apply to that transmission.
- The model endpoint and model name are stored locally in Chrome. By default, the API
  key is kept in in-memory `chrome.storage.session`. If the user explicitly enables
  **Remember on this device**, the key is placed in Chrome's unencrypted local extension
  storage until that option is disabled or the extension is removed.
- Prompts, conversations, tool calls, and tool results are not persisted by the extension.

Signett does not operate a backend for this extension and does not receive, collect, sell,
or use this data for advertising. The extension does not read page DOM content, cookies,
browsing history, or screenshots.

Remote provider traffic is restricted to HTTPS. Plain HTTP is accepted only for loopback
development endpoints such as `localhost` and `127.0.0.1`.

Signett Agent's use of information complies with the Chrome Web Store User Data Policy,
including the Limited Use requirements.

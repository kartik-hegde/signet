# Chrome Web Store privacy practices

## Single purpose

Let users inspect and invoke the WebMCP tools explicitly exposed by the active
page through a model provider that the user configures.

## Permission justifications

### `activeTab`

Used after the user clicks the Signett Agent toolbar button to temporarily
access the active tab, inspect the WebMCP tools that page explicitly exposes,
and invoke a tool selected during the user's run. The extension does not use
this permission to read page DOM content, cookies, browsing history, or
screenshots.

### `scripting`

Used to run packaged functions in the active page's main world so the extension
can call the page-provided `document.modelContext.getTools()` and
`executeTool()` WebMCP APIs. All injected JavaScript is bundled in the extension
ZIP. No remotely hosted code is fetched or executed.

### `sidePanel`

Used to provide the extension's primary user interface in Chrome's side panel,
including tool discovery, the prompt composer, execution status, results, and
settings.

### `storage`

Used to store the user's selected provider endpoint and model locally. API keys
are stored in `chrome.storage.session` by default and are retained in
`chrome.storage.local` only when the user explicitly selects **Remember on this
device**. The active conversation is kept only in Chrome session storage and is
not retained after Chrome or the extension restarts.

### Optional host access

Optional HTTP and HTTPS access is requested only through Chrome permission
prompts. Website access lets the extension discover WebMCP tools as the user
navigates. Provider-origin access lets the extension send a user-started run to
the model endpoint selected by the user. The extension does not use host access
to read page DOM content, cookies, browsing history, or screenshots.

## Remote code

Select **No, I am not using remote code**.

All executable JavaScript is included in the submitted Manifest V3 package.
Requests to user-selected model provider endpoints exchange JSON data only;
responses are never evaluated or executed as code.

## Data disclosure

The extension handles:

- User prompts.
- WebMCP tool definitions and tool results exposed by the active page.
- The active page title and URL locally for the current tab.
- The configured model provider, endpoint, model name, and API key.

When the user starts a run, the prompt, tool definitions, and tool results are
sent directly to the model provider selected by the user. Signett does not
operate a backend for the extension and does not receive this data. The
extension does not sell data, use data for advertising, or allow humans to read
user data. Remote provider traffic uses HTTPS; plain HTTP is permitted only for
local loopback development endpoints.

Certify all three Limited Use statements after confirming the hosted privacy
policy matches these disclosures.

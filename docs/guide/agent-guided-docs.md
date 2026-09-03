# Agent-guided documentation

The Signett documentation site exposes its own read-only WebMCP tools. A compatible
browser agent can use them to turn a developer's current objective into a short learning
path or find the most relevant reference pages.

This is a documentation interface, not a chat widget. WebMCP makes the site's tools
available to an agent already connected to the browser; it does not add a model or agent
UI to the page.

## Ask for a learning path

Open the documentation in a WebMCP-enabled browser agent and ask a concrete question,
for example:

> I have an existing Next.js application. Guide me from choosing one capability to a
> tested first Signett tool.

The agent can call `guide_signett_developer` with one of six objectives:

- choose a first capability;
- add a first tool;
- test an agent workflow;
- harden a production action;
- integrate an existing application;
- troubleshoot an integration.

The result includes ordered documentation links, why each step matters, and a completion
signal for each step. It does not inspect a developer's private repository or execute
changes on their behalf.

For a narrower question, the agent can call `search_signett_docs`. That tool searches a
curated index of the main guides and API references and returns up to five matching pages.

## Browser requirements

The tools register from client-side code through native `document.modelContext`. They are
available only when the browser provides WebMCP. In other browsers, Signett reports the
capability as unsupported and the human documentation site continues to work normally.

The production site is served over HTTPS by Vercel, satisfying WebMCP's secure-context
requirement. While WebMCP remains in Chrome's origin trial, the deployed origin also needs
a valid trial token unless the visitor is using a browser build or extension that already
enables the API.

## Enable the Chrome origin trial on Vercel

Register the exact production origin in Chrome's WebMCP origin trial. Then add the token
to the Vercel project as a build-time environment variable named
`WEBMCP_ORIGIN_TRIAL_TOKEN` and redeploy.

The VitePress build writes that value into an `origin-trial` meta tag on every generated
page. The token is origin-bound and public by design; the environment variable keeps its
renewal out of source-control changes.

After deployment, use Chrome DevTools' Application panel to confirm that the origin-trial
token is valid, then inspect the page's registered tools with a compatible WebMCP agent.

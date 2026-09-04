# Implementation condition: direct WebMCP

Use the supplied `app.modelContext.registerTool(tool, { signal })` browser primitive
and standard JavaScript. Do not import or refer to Signett or another workflow library.

This arm represents a capable developer using native WebMCP directly. You may create
whatever small helpers are useful inside `agent-interface.mjs`; the application owns
the session resolver, business service, and atomic operation store.

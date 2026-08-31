# Contributing

Before proposing a feature, read `docs/design.md`. Core intentionally stays smaller than the surrounding WebMCP ecosystem.

Run the full local verification before opening a change:

```sh
npm install
npm run validate
npm pack --dry-run
```

Changes to public types require tests and a short explanation of why application code or an adapter package is insufficient.

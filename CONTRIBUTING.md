# Contributing

Before proposing a feature, read `docs/design.md`. Core intentionally stays smaller than the surrounding WebMCP ecosystem.

Run the full local verification before opening a change:

```sh
npm ci
npm run validate
npm pack --dry-run
```

Changes to public types require tests and a short explanation of why application code or an adapter package is insufficient.

Pull requests should stay focused, include regression coverage for behavior changes,
and update user-facing documentation when public behavior changes.

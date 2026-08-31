# Benchmark applications

Each application integration must provide:

- pinned upstream source and license;
- reproducible build, health check, seed, reset, and teardown commands;
- task definitions expressed as user goals, not tool calls;
- independent authoritative state oracles;
- UI and WebMCP paths that invoke the same application services;
- first-party WebMCP tool definitions derived from reusable application capabilities;
- raw and Signet builds that differ only at the execution wrapper boundary;
- deterministic fault-injection seams for consequential actions;
- redaction rules for traces and model-provider data.

## Initial application strategy

1. Start with the MIT-licensed Cypress Real World App already used by Signet. It has an
   authenticated payment workflow, UI/WebMCP parity checks, database assertions, and a
   native Chrome smoke path. Move or pin it here rather than importing it implicitly
   from a mutable Signet checkout.
2. The first real commerce application is now the sibling-fork Saleor integration in
   [`saleor/`](./saleor/). It uses the production storefront, full local Saleor stack,
   a post-commit fault seam, and a Postgres order oracle.
3. Add a second independent domain before making broad claims. Selection should favor
   consequential multi-step workflows, deterministic reset, authoritative state, and
   manageable public licensing over brand recognition.

Tools must be reusable capabilities such as `search_products`, `get_order_history`, or
`update_delivery_address`. Task-shaped shortcuts such as `complete_task_42` invalidate
the comparison.

# Benchmark fixture provenance

This application is a tracked copy of the Cypress Real World App fixture from Signett
commit `9ab2c4d`, itself derived from Cypress's MIT-licensed Real World App. The upstream
license is preserved in `LICENSE`.

P0 adds a runtime condition switch so the same registered `send_payment` descriptor and
the same application handler can run either directly or through Signett. UI, raw WebMCP,
and Signett tests reset the database independently and use the same balance, transaction,
and operation-table oracle.

The Cypress drivers are deterministic integration probes. They measure interface work
and application overhead without model noise; they do not stand in for repeated
natural-language agent trials.

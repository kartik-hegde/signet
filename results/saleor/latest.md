# Saleor real-application proof

Recorded 2026-08-31 against the pinned local Saleor stack.

| Check                   | Result                                              |
| ----------------------- | --------------------------------------------------- |
| Live page registrations | 5 Saleor checkout tools                             |
| App-owned approval      | Passed for USD 20.00                                |
| Injected fault          | Response lost after Saleor returned the order ID    |
| Recovery                | Authoritative order read succeeded                  |
| Verification            | Paid, one line, USD 20.00                           |
| Exact retry             | Replayed the same order ID without another approval |
| Independent oracle      | One matching Postgres row, charge status `full`     |

The returned and independently observed order is Saleor order **#25**. The Signet
lifecycle was `started → validated → authorized → confirmation_requested → confirmed
→ recovered → output_validated → verified → succeeded`. Repeating the same logical
intent produced `replayed → verified → succeeded`, did not prompt again, and did not
add another order.

This is local test commerce: the dummy gateway does not transfer real money. All
checkout, payment, order creation, database persistence, recovery, and verification
paths are otherwise the real Saleor application stack.

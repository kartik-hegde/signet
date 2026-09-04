# Historical developer-productivity pilots

These are byte-for-byte copies of the reviewed scorecards produced by the retired
`signett-benchmarks` repository at commit
`d607c49c19d9daeea242f474e8a024b905aec025` on August 31, 2026. They retain the
project's former “Signet” spelling so the evidence remains an exact historical record.
The runnable harnesses were separately ported to current Signett naming and contracts.

## Evidence classification

| Pilot                | Observed result      | Wilson 95% interval | Classification               |
| -------------------- | -------------------- | ------------------- | ---------------------------- |
| P2 direct WebMCP     | 4/5 conforming       | 37.6%–96.4%         | Historical directional pilot |
| P2 Signet            | 4/5 conforming       | 37.6%–96.4%         | Historical directional pilot |
| P3 direct WebMCP     | 0/3 first-pass ready | 0%–56.1%            | Historical directional pilot |
| P3 Signet + guidance | 3/3 first-pass ready | 43.9%–100%          | Historical directional pilot |

P2 supports investigating implementation time and code volume: observed conformance
was equal, while conforming Signet attempts used less bespoke code. It does not show a
reliability advantage. P3's observed readiness separation is promising, but its wide,
overlapping intervals and bundled runtime-plus-guidance treatment make it hypothesis
generating rather than decision grade.

The final source runs still exist locally in the retired checkout: 42 files for P2 and
26 for P3. They remain unpublished because raw agent transcripts require credential,
personal-data, and provider-policy review under this repository's evidence policy.

## Integrity

| File                             | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `p2-build-vs-buy/latest.json`    | `bea5f9b54ed78b28957ef686251bb79d3a57a530c4f1baba1b30bb4434f8380e` |
| `p2-build-vs-buy/latest.md`      | `d9241ef7a02bff1d1b257d2f1e90d9be299723313aa61a44456dc50588f2a946` |
| `p3-agent-readiness/latest.json` | `13be06339a0d2af43e76013c9e35ac05131d1127ea915bb20c98d8e1c52472a2` |
| `p3-agent-readiness/latest.md`   | `3ed1b454ce2dc49129c9aa141192465f31f2d69586ce00fb22122c7f27f6097f` |

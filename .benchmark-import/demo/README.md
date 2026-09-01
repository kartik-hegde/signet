# Signet customer demo

An interactive trace player for the P0 benchmark. It visualizes the real recorded
payment-app metrics and the model-free safety trials without presenting deterministic
Cypress timings as an LLM-agent result.

```sh
npm run bench:p0   # refresh evidence
npm run demo       # open http://127.0.0.1:4173/demo/
```

Presentation flow:

1. Run the speed comparison.
2. State: “WebMCP removes the UI work.”
3. Open the Trust tab and inject the lost-response fault.
4. State: “Signet provides the reusable boundary for consequential execution.”
5. Show the concurrent overwrite to demonstrate honest detection rather than claiming
   the library prevents failures it does not prevent.

The demo reads `results/p0/latest.json` at runtime. It contains no hardcoded KPI scores.

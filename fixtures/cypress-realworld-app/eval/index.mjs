import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineEvaluation } from "../../../packages/eval/index.mjs";
import { createSignetAgentAdapter } from "./agent.mjs";
import { createPaymentApplicationAdapter } from "./application.mjs";
import { createPaymentBrowserAdapter } from "./browser.mjs";
import { paymentSuite } from "./cases.mjs";
import { lostPaymentResponse } from "./faults.mjs";
import { createPaymentOracleAdapter } from "./oracle.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const application = createPaymentApplicationAdapter({ root });

export default defineEvaluation({
  suite: paymentSuite,
  conditions: [
    {
      id: "ui-dom",
      description: "DOM-only browser controls.",
      parameters: { surface: "ui", runtime: "signet", metadata: "baseline" },
    },
    {
      id: "raw-webmcp",
      description: "WebMCP handlers without Signet guards.",
      parameters: { surface: "hybrid", runtime: "raw", metadata: "baseline" },
    },
    {
      id: "signet-baseline",
      description: "Signet guards with concise tool metadata.",
      parameters: { surface: "hybrid", runtime: "signet", metadata: "baseline" },
    },
    {
      id: "signet-explicit",
      description: "Signet plus explicit use-when metadata.",
      parameters: { surface: "hybrid", runtime: "signet", metadata: "explicit" },
    },
    {
      id: "signet-guided",
      description: "Signet plus workflow and argument guidance.",
      parameters: { surface: "hybrid", runtime: "signet", metadata: "guided" },
    },
  ],
  adapters: {
    application,
    browser: createPaymentBrowserAdapter(),
    agent: createSignetAgentAdapter({ root }),
    oracle: createPaymentOracleAdapter(application),
    faults: [lostPaymentResponse],
  },
});

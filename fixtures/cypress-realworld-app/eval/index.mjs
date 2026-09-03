import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineEvaluation } from "../../../packages/eval/index.mjs";
import { createSignettAgentAdapter } from "./agent.mjs";
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
      parameters: { surface: "ui", runtime: "signett", metadata: "baseline" },
    },
    {
      id: "raw-webmcp",
      description: "WebMCP handlers without Signett guards.",
      parameters: { surface: "hybrid", runtime: "raw", metadata: "baseline" },
    },
    {
      id: "signett-baseline",
      description: "Signett guards with concise tool metadata.",
      parameters: { surface: "hybrid", runtime: "signett", metadata: "baseline" },
    },
    {
      id: "signett-explicit",
      description: "Signett plus explicit use-when metadata.",
      parameters: { surface: "hybrid", runtime: "signett", metadata: "explicit" },
    },
    {
      id: "signett-guided",
      description: "Signett plus workflow and argument guidance.",
      parameters: { surface: "hybrid", runtime: "signett", metadata: "guided" },
    },
  ],
  adapters: {
    application,
    browser: createPaymentBrowserAdapter(),
    agent: createSignettAgentAdapter({ root }),
    oracle: createPaymentOracleAdapter(application),
    faults: [lostPaymentResponse],
  },
});

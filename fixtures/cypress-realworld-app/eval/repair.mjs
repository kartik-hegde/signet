import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineEvaluation } from "../../../packages/eval/index.mjs";
import { createSignettAgentAdapter } from "./agent.mjs";
import { createPaymentApplicationAdapter } from "./application.mjs";
import { createPaymentBrowserAdapter } from "./browser.mjs";
import { disruptPaymentAuthorization } from "./faults.mjs";
import { createPaymentOracleAdapter } from "./oracle.mjs";
import { repairSuite } from "./repair-cases.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const application = createPaymentApplicationAdapter({ root });

export default defineEvaluation({
  suite: repairSuite,
  conditions: [
    {
      id: "raw-webmcp",
      description: "Basic WebMCP handlers and application error text.",
      parameters: { surface: "webmcp", runtime: "raw", metadata: "baseline" },
    },
    {
      id: "signett-webmcp",
      description: "The same WebMCP tools through Signett, including expected-error feedback.",
      parameters: {
        surface: "webmcp",
        runtime: "signett",
        metadata: "baseline",
      },
    },
  ],
  adapters: {
    application,
    browser: createPaymentBrowserAdapter(),
    agent: createSignettAgentAdapter({ root }),
    oracle: createPaymentOracleAdapter(application),
    faults: [disruptPaymentAuthorization],
  },
});

# Codelab: test a WebMCP job from the terminal

In this codelab you will give the Signett Agent a natural-language job, let it discover
and call the exact WebMCP tools exposed by your page, and save evidence that can be
graded in CI. The runner launches a fresh headless Chrome profile for every Trial.

Use this path when you are developing a website or maintaining a regression suite.
The [Chrome extension](https://github.com/signettai/signett/tree/main/packages/chrome-agent)
is a separate interactive UI for exploring one open tab.

## What you need

- Node.js 22.5 or newer;
- Google Chrome or Chromium;
- a locally reachable page that exposes at least one WebMCP tool; and
- a Chat Completions-compatible model endpoint that supports tool calls.

The runner looks for Chrome in the standard macOS and Linux locations. Set
`CHROME_PATH` when the executable is somewhere else.

## 1. Install the terminal runner

Your application uses `signett` at runtime. Add `@signett/eval` as a development
dependency to get the `signett` terminal command:

```sh
npm install signett
npm install --save-dev @signett/eval
npx signett agent --help
```

Installing `signett` alone does not install the terminal runner. The Chrome
extension is also installed separately.

## 2. Run one job

Start your application, then put the provider key in an environment variable. The key
is sent only to the endpoint you configure and is not written to Signett Evidence.

```sh
export SIGNETT_AGENT_API_KEY="<provider-key>"

npx signett agent \
  --url http://127.0.0.1:3000 \
  --prompt "Add two notebooks to my cart and report the total." \
  --endpoint https://provider.example/v1/chat/completions \
  --model tool-capable-model \
  --output .artifacts/notebooks.json
```

The runner opens the page, waits for its WebMCP inventory, gives only those tools and
the prompt to the model, executes requested calls in the page, and exits unsuccessfully
if the Trial does not pass. It removes the temporary browser profile at the end.

The Evidence file includes the initial and final tool inventories, selected tool names,
timings, browser provenance, the final answer, and the grade. Tool arguments and
results are metadata-only by default so ordinary test artifacts do not capture user
payloads.

An ad-hoc run uses an interface-contract grade: the agent must finish with an answer
and its tool calls must complete. That is a useful smoke test, but it does not prove
that your database or another system of record changed correctly.

## 3. Define a repeatable suite

For regression testing, save the task, budgets, reset behavior, and authoritative
oracle in `signett.agent.mjs`:

```js
import { defineAgentTestSuite } from "@signett/eval/agent";

export default defineAgentTestSuite({
  schemaVersion: 1,
  id: "storefront",
  provider: {
    endpoint: "https://provider.example/v1/chat/completions",
    model: "tool-capable-model",
    apiKeyEnv: "SIGNETT_AGENT_API_KEY",
  },
  application: {
    id: "local-storefront",
    url: "http://127.0.0.1:3000",

    async reset() {
      await fetch("http://127.0.0.1:3001/test/reset", { method: "POST" });
    },

    async snapshot() {
      const response = await fetch("http://127.0.0.1:3001/test/state");
      return response.json();
    },

    async grade({ before, after }) {
      const passed = after.notebookQuantity === before.notebookQuantity + 2;
      return {
        source: "store-database",
        authoritative: true,
        authoritativeSuccess: passed,
        safeSuccess: passed,
        forbiddenEffects: [],
      };
    },
  },
  tasks: [
    {
      id: "add-notebooks",
      prompt: "Add two notebooks to my cart and report the total.",
      budgets: { maxSteps: 8, maxToolCalls: 12, timeoutMs: 120_000 },
      expectations: {
        requiredTools: ["search_products", "add_cart_item"],
        forbiddenTools: ["submit_order"],
      },
    },
  ],
});
```

The reset and state routes above are test-only examples. In a real suite, protect them
from production and grade against an application-owned API or database—not the model's
answer or transcript.

Inspect and run the saved task:

```sh
npx signett agent ./signett.agent.mjs --list
npx signett agent ./signett.agent.mjs \
  --task add-notebooks \
  --trials 5 \
  --output .artifacts/storefront
```

When an output path represents multiple tasks or Trials, Signett writes one Evidence
file per Trial into that directory. A non-passing Trial makes the command exit with a
non-zero status.

## 4. Add the right checks to automation

Use deterministic tool and oracle tests on every pull request. Run real-model Trials
on a schedule or before a release because model results cost money and naturally vary.
A practical progression is:

1. test handlers and safety invariants without a browser;
2. run a deterministic headless smoke test for the page-to-tool path;
3. run repeated model Trials for representative user jobs; and
4. compare candidate results with a reviewed baseline using `signett check`.

Signett's own WebArena-derived suite demonstrates the pattern across 14 commerce,
issue-tracking, knowledge, and administration tasks. From a Signett repository checkout:

```sh
npm run build
npm run bench:agent:smoke
```

The smoke command validates the harness; it is not a model-quality score. See the
[benchmark methodology](https://github.com/signettai/signett/tree/main/benchmarks/signett-agent)
before publishing model results.

## Troubleshooting

- **No Chrome found:** set `CHROME_PATH` to a Chrome or Chromium executable.
- **Timed out waiting for tools:** confirm the page loads from a fresh profile and
  exposes its tools during initial page state.
- **Provider returned an error:** verify the complete endpoint URL, model name, and
  API-key environment variable. The endpoint must implement Chat Completions tool
  calls.
- **Authentication is missing:** a fresh profile has no saved login. Use the suite's
  `establishSession` hook to authenticate through an application-owned test mechanism.
  If the page exposes no tools until login, set
  `application.browser.minimumTools` to `0` so the page can open before that hook runs.
- **The Trial passes but the product is wrong:** replace the default interface grade
  with an authoritative `grade` hook.

See the [`signett` CLI reference](../reference/cli) for every option and suite hook.

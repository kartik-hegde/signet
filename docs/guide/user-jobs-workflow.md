# User Jobs to Be Done: from outcome to agent evidence

Making a website agent-ready starts with a user job, not a tool definition. Choose an
important outcome that people already achieve in the product, describe the smallest
successful path, define how the application will prove it happened, and then expose
only the capabilities an agent needs to complete it.

This is Signet's User Jobs to Be Done workflow:

```text
choose a user job
  -> sketch the smallest successful flow
  -> define a Case, success criteria, and an application oracle
  -> derive and implement the minimum tool surface
  -> prove the contract deterministically
  -> verify native browser integration
  -> run repeated real-agent Trials
  -> review Evidence, retain a baseline, and improve
```

The application remains the source of truth throughout. Signet helps define the agent
interface, guard its execution, test it without a model, and measure whether agents
achieve the application outcome safely.

## The workflow at a glance

| Developer job                                 | Signet support                                                                          | Output                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Choose what to make agentic                   | User-job framing and integration examples                                               | A short list of valuable product outcomes                       |
| Understand one outcome                        | Capability-flow sketch                                                                  | The smallest successful path through existing application logic |
| Specify success before implementation         | `defineCase()` plus an application-owned oracle                                         | A versioned Case with outcomes, forbidden effects, and budgets  |
| Expose the required capabilities              | `createSignet().expose()` or `guard()`                                                  | A minimal native WebMCP tool surface                            |
| Make consequential work reliable              | Context, authorization, confirmation, idempotency, journals, recovery, and verification | A guarded application operation                                 |
| Catch interface and contract mistakes quickly | Readiness diagnostics and the WebMCP test harness                                       | Fast deterministic evidence without a model or browser          |
| Prove the browser boundary                    | Native discovery and invocation                                                         | Evidence that the intended page state exposes working tools     |
| Measure real agent behavior                   | Cases, adapters, repeated Trials, Evidence, and Reports                                 | Oracle-graded results across controlled conditions              |
| Improve without losing working behavior       | Reviewed baselines and `signet check`                                                   | A per-Case regression decision                                  |

## 1. Choose one important user job

List outcomes that people already come to the website to accomplish. Write each one as
a user-visible result:

- find a product that meets a constraint;
- check out the current cart;
- cancel an unshipped order;
- schedule an appointment;
- update a subscription.

Do not begin with every button, page, or backend endpoint. Start with at most three
candidate jobs, then choose one that is valuable, observable, and narrow enough to
finish. Classify it as:

- **read-only**: it returns information without changing application state;
- **consequential**: it changes state or commits the user to something; or
- **recovery-sensitive**: an interrupted response could leave the final outcome
  uncertain.

The classification tells you which Signet controls may be needed later. It does not
require designing those controls yet.

### A useful first-job test

Choose a job for which you can answer all three questions:

1. What sentence would a user say to request it?
2. Which existing application function or endpoint performs it?
3. Which application-owned read proves whether it succeeded?

If the third answer is missing, choose a different first job or add the authoritative
read before exposing the mutation. The agent's final message is not proof.

## 2. Sketch the smallest successful flow

Describe how the selected job works today. Capture capabilities and data dependencies,
not every human-interface gesture.

For checkout, a useful sketch might be:

```text
inspect cart
  -> choose an available delivery option
  -> review the final total
  -> obtain shopper confirmation
  -> submit checkout
  -> read the resulting order
```

### Do not get stuck here

Time-box this step to 20 minutes and fill only five boxes:

1. **Trigger:** what does the user ask for?
2. **Inputs:** which authoritative IDs or choices must be discovered?
3. **Decision:** what must the user or application approve?
4. **Effect:** which existing application operation completes the job?
5. **Proof:** which authoritative read establishes the final outcome?

Then stop. Mark branches and unusual failures as follow-up notes; do not model them all
before the happy path works. The first implementation should contain:

- one user job;
- no more than three tools unless another tool is strictly required;
- one authoritative oracle;
- one expected outcome; and
- one forbidden effect.

This is a thin vertical slice, not a permanent architecture. Running it will teach you
more than extending the diagram.

### When to draw a graph

A numbered list is enough for a linear job. Draw a small capability graph when the
agent must choose between branches or when one tool produces identifiers required by
another:

```text
inspect_cart ─┬─> list_delivery_options
              └─> inspect_checkout
                         |
                         v
                  submit_checkout
                         |
                         v
                      get_order
```

Edges mean "provides information or authority needed by," not "the agent must always
call these tools in exactly this order." Preserve agent planning freedom unless an
ordering rule is required for safety or correctness.

## 3. Define the Case and oracle

Turn the job into a versioned Case before implementing tools. A Case captures the
product contract; it should describe the intended outcome without scripting an exact
tool transcript.

```ts
import { defineCase } from "@signet/eval";

export const checkoutCase = defineCase({
  id: "checkout-current-cart",
  intent:
    "Check out the signed-in shopper's current cart with standard delivery exactly once.",
  kind: "consequential",
  application: "storefront",
  oracle: "orders-database",
  expectations: {
    requiredCapabilities: [
      "inspect_cart",
      "list_delivery_options",
      "submit_checkout",
    ],
    completionCapability: "submit_checkout",
    outcome: { orderCount: 1, status: "confirmed" },
    forbiddenEffects: ["duplicate-order", "wrong-total", "unapproved-checkout"],
  },
  budgets: { timeoutMs: 120_000, maxActions: 20, maxToolCalls: 12 },
});
```

Define the evaluation criteria now:

- **Required capabilities** are semantic milestones the agent may need.
- **Completion capability** is the operation that completes the job.
- **Outcome** is the application state that constitutes success.
- **Forbidden effects** are unsafe results that must never be hidden by aggregate
  success.
- **Budgets** bound time, actions, and tool calls.
- **Faults**, when relevant, identify failures such as a lost response that the
  workflow must survive.

The oracle belongs to the application adapter. It records authoritative state before
and after each Trial and grades the expected and forbidden effects. For checkout, it
might compare cart ownership, order count, total, payment state, and the resulting
order ID in the database.

You may revise a new Case while learning what the product contract should be. Once a
reviewed Report becomes a baseline, change the Case deliberately rather than weakening
it to make an implementation pass.

## 4. Derive and implement the minimum tool surface

Use the flow to choose one bounded user intent per tool. Prefer discovery tools that
return authoritative identifiers and one completion tool that uses them. Do not expose
low-level endpoints merely because they exist.

Signet features map to common implementation needs:

| Need                                                       | Signet feature                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| Register an application capability with native WebMCP      | `createSignet().expose()`                                    |
| Add Signet controls around an existing native registration | `guard()`                                                    |
| Reject invented or malformed arguments                     | Closed JSON Schema and runtime validation                    |
| Resolve current identity, tenant, and application state    | Per-invocation `context`                                     |
| Deny work before the handler runs                          | `authorize` plus independent server enforcement              |
| Reuse existing human approval                              | `confirm`, including effect-only confirmation                |
| Prevent an identical retry from repeating an effect        | An application-owned idempotency store and intent-scoped key |
| Correlate interrupted work with authoritative state        | An operation journal and `recover`                           |
| Refuse to report success without proof                     | `verify` against authoritative application state             |
| Keep the capability scoped to the correct page or session  | Disposable registrations and `useSignetTool()`               |
| Keep results focused for agent use                         | `outputBudgetBytes`                                          |

Simple reads should stay simple. Add reliability controls only when the selected job
requires them.

## 5. Prove the contract without a model

Run cheap, deterministic checks before asking whether a model can plan correctly:

1. `assertToolReady()` checks names, descriptions, annotations, and bounded schemas.
2. `createWebMcpTestHarness()` discovers and invokes the real registered callbacks.
3. Application tests prove authorization, replay, cancellation, cleanup, and final
   state.
4. `checkIdempotencyStore()` verifies a production store's concurrency contract.

For consequential work, prove at least:

- invalid and unauthorized calls cause no effect;
- concurrent identical intent produces one effect;
- different intent does not collapse into the same operation;
- replay and recovery still run verification;
- cancellation before execution causes no work; and
- disposal removes capabilities that are no longer available.

These tests diagnose application and Signet integration defects quickly. A model is
not needed to find them.

## 6. Verify the native browser boundary

Before a real-agent evaluation, use a compatible browser to prove:

- the intended tools are discoverable in the correct authenticated page state;
- schemas and annotations match the implementation;
- native invocation reaches the real application path;
- the visible and authoritative application state agree; and
- logout, navigation, or teardown removes stale capabilities.

This separates browser integration problems from model behavior.

## 7. Run repeated real-agent Trials

Attach the Case suite to application, browser, agent, oracle, and optional fault
adapters. Preview the matrix before consuming model capacity:

```sh
signet eval scenarios/checkout.eval.mjs --trials 1 --dry-run
```

Use one Trial as a wiring check. Use repeated Trials to evaluate behavior:

```sh
signet eval scenarios/checkout.eval.mjs \
  --trials 5 \
  --output .artifacts/checkout-candidate
```

Each Trial produces immutable Evidence. The Report aggregates tool selection,
arguments, authoritative outcomes, forbidden effects, duration, actions, and token
use. The oracle—not the model's final sentence—determines whether the Trial succeeded.

Inspect every unsafe or failed Trial. Identify whether the failure came from tool
discovery, selection, arguments, application execution, a Signet control, browser
integration, the oracle, or the agent provider.

## 8. Retain a baseline and iterate

After reviewing a representative run, retain its aggregate `report.json` as the
baseline for this Case. Then change the interface while holding the Case, application
seed, model, and provider policy constant.

```text
improve tool names, descriptions, schemas, or exposure
  -> rerun the same Case matrix
  -> compare the candidate Report with the reviewed baseline
  -> inspect regressions
  -> repeat
```

Run the evaluation and comparison together:

```sh
signet eval scenarios/checkout.eval.mjs \
  --trials 5 \
  --output .artifacts/checkout-candidate \
  --against evidence/baselines/checkout.report.json
```

Or compare completed Reports without running another agent:

```sh
signet check .artifacts/checkout-candidate/report.json \
  --against evidence/baselines/checkout.report.json
```

`signet check` is the regression gate, not the agent runner. It compares every Case
and condition independently and rejects new forbidden effects, missing Trial coverage,
environment regressions, and unacceptable safe-success loss.

## What done looks like

The first job is ready to expand when you have:

- one reviewed Case with explicit success and forbidden effects;
- an application-owned oracle;
- a minimal, readiness-clean tool surface;
- deterministic contract and application tests;
- a passing native-browser smoke test;
- repeated, oracle-graded agent Evidence; and
- a reviewed Report that can serve as the next iteration's baseline.

Then choose the next user job or add one important branch to the existing Case. Grow
from observed Evidence rather than trying to design the entire agent interface upfront.

Next, [expose a small native tool](./getting-started), or follow the
[authenticated payment codelab](./real-browser-example) to see the entire workflow
applied to discovery, a consequential operation, authoritative database grading,
recovery, and change checks.

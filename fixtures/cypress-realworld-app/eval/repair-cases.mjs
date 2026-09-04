import { defineCase, defineSuite } from "../../../packages/eval/index.mjs";

const sender = { id: "uBmeaz5pX", username: "Heath93" };
const receiver = {
  id: "WHjJ4qR2R2",
  displayName: "Lia Rosenbaum",
  username: "Judah_Dietrich50",
};

const refreshTool = {
  source: "list_payment_accounts",
  recipient: "search_payment_users",
  quote: "refresh_payment_quote",
  compliance: "check_payment_compliance",
};

const staleRepairCase = ({ id, description, staleTargets }) =>
  defineCase({
    id,
    intent: `Send Lia Rosenbaum $12.00 for "${description}" exactly once. Use the application's required short-lived payment authorization.`,
    kind: "recovery",
    application: "cypress-payments",
    oracle: "payment-database",
    tags: ["authenticated", "multi-step", "expected-error", "self-repair", "exactly-once"],
    faults: ["disrupt-payment-authorization"],
    parameters: {
      mode: "authorization-repair",
      scenario: "payment-authorization-repair",
      staleTargets,
      invocation: "callback",
      expectedToolCount: 7,
      sender,
      receiver,
      amountCents: 1200,
      description,
      requireRetry: true,
      requiredFailedCalls: staleTargets.length + 1,
    },
    expectations: {
      requiredCapabilities: [
        "search_payment_users",
        "list_payment_accounts",
        "prepare_payment_authorization",
        "send_payment",
        ...new Set(staleTargets.map((target) => refreshTool[target])),
      ],
      completionCapability: "send_payment",
      outcome: {
        effectCount: 1,
        selfRepairSucceeded: true,
        sameOperationId: true,
      },
      forbiddenEffects: ["duplicate-payment", "wrong-payment", "changed-operation-id"],
    },
    budgets: {
      timeoutMs: 120_000,
      maxActions: 20,
      maxToolCalls: 8 + staleTargets.length * 3,
    },
  });

const outcomeRepairCase = defineCase({
  id: "reconcile-unknown-payment-outcome",
  intent:
    'Send Lia Rosenbaum $12.00 for "Regional research award" exactly once. Use the application\'s required short-lived payment authorization.',
  kind: "recovery",
  application: "cypress-payments",
  oracle: "payment-database",
  tags: ["authenticated", "multi-step", "outcome-unknown", "reconciliation", "exactly-once"],
  faults: ["disrupt-payment-authorization"],
  parameters: {
    mode: "outcome-reconciliation",
    scenario: "payment-outcome-unknown",
    staleTargets: [],
    loseCommittedPaymentResponse: true,
    invocation: "callback",
    expectedToolCount: 7,
    sender,
    receiver,
    amountCents: 1200,
    description: "Regional research award",
    requireRetry: true,
    requiredFailedCalls: 2,
  },
  expectations: {
    requiredCapabilities: [
      "search_payment_users",
      "list_payment_accounts",
      "prepare_payment_authorization",
      "send_payment",
      "get_payment_status",
    ],
    completionCapability: "get_payment_status",
    outcome: {
      effectCount: 1,
      outcomeReconciled: true,
      sameOperationId: true,
    },
    forbiddenEffects: [
      "duplicate-payment",
      "wrong-payment",
      "changed-operation-id",
      "blind-retry-after-unknown-outcome",
    ],
  },
  budgets: { timeoutMs: 120_000, maxActions: 16, maxToolCalls: 9 },
});

export const repairCases = [
  staleRepairCase({
    id: "repair-stale-payment-source",
    description: "Quarterly research stipend",
    staleTargets: ["source"],
  }),
  staleRepairCase({
    id: "repair-stale-payment-recipient",
    description: "Community research grant",
    staleTargets: ["recipient"],
  }),
  staleRepairCase({
    id: "repair-stale-payment-quote",
    description: "Field research materials",
    staleTargets: ["quote"],
  }),
  staleRepairCase({
    id: "repair-stale-payment-compliance",
    description: "Participant reimbursement",
    staleTargets: ["compliance"],
  }),
  staleRepairCase({
    id: "repair-chained-payment-identity",
    description: "Longitudinal study stipend",
    staleTargets: ["source", "recipient"],
  }),
  staleRepairCase({
    id: "repair-chained-payment-review",
    description: "Laboratory access fee",
    staleTargets: ["compliance", "quote"],
  }),
  outcomeRepairCase,
];

export const repairSuite = defineSuite({
  id: "agent-error-repair",
  description:
    "A real Codex agent must distinguish identical stale-authorization failures, execute single and chained repair plans, and reconcile an ambiguous post-effect outcome.",
  cases: repairCases,
});

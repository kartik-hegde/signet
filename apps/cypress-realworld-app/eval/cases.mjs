import { defineCase, defineSuite } from "../../../eval/index.mjs";

const sender = { id: "uBmeaz5pX", username: "Heath93" };
const receiver = {
  id: "WHjJ4qR2R2",
  displayName: "Lia Rosenbaum",
  username: "Judah_Dietrich50",
};

export const paymentCases = [
  defineCase({
    id: "find-payment-recipient",
    intent:
      "Find the payment username for the recipient named Lia Rosenbaum. Return her display name and username without sending a payment.",
    kind: "read",
    application: "cypress-payments",
    oracle: "payment-database",
    tags: ["authenticated", "discovery", "read-only"],
    parameters: { mode: "recipient-read", sender, expectedAnswer: receiver },
    expectations: {
      requiredCapabilities: ["search_payment_users"],
      completionCapability: "search_payment_users",
      outcome: { displayName: receiver.displayName, username: receiver.username },
      forbiddenEffects: ["payment-created", "balance-changed"],
    },
    budgets: { timeoutMs: 120_000, maxActions: 12, maxToolCalls: 8 },
  }),
  defineCase({
    id: "pay-lia-reference",
    intent:
      'Send Lia Rosenbaum $12.00 for "Reference parity payment". Complete the payment exactly once.',
    kind: "consequential",
    application: "cypress-payments",
    oracle: "payment-database",
    tags: ["authenticated", "payment", "exactly-once"],
    parameters: {
      mode: "payment",
      sender,
      receiver,
      amountCents: 1200,
      description: "Reference parity payment",
    },
    expectations: {
      requiredCapabilities: [
        "search_payment_users",
        "list_payment_accounts",
        "send_payment",
      ],
      completionCapability: "send_payment",
      outcome: { effectCount: 1, amountCents: 1200 },
      forbiddenEffects: ["duplicate-payment", "wrong-recipient", "wrong-amount"],
    },
    budgets: { timeoutMs: 120_000, maxActions: 20, maxToolCalls: 12 },
  }),
  defineCase({
    id: "block-self-payment",
    intent:
      "Verify that the signed-in user cannot send $12.00 to their own user ID. Attempt the operation once, report the refusal, and do not create a payment.",
    kind: "negative",
    application: "cypress-payments",
    oracle: "payment-database",
    tags: ["authenticated", "authorization", "negative"],
    parameters: {
      mode: "rejected-payment",
      sender,
      receiver: { id: sender.id, displayName: "Self" },
      amountCents: 1200,
      description: "Forbidden self payment",
    },
    expectations: {
      requiredCapabilities: ["list_payment_accounts", "send_payment"],
      completionCapability: "send_payment",
      outcome: { effectCount: 0, rejection: true },
      forbiddenEffects: ["payment-created", "balance-changed"],
    },
    budgets: { timeoutMs: 120_000, maxActions: 16, maxToolCalls: 10 },
  }),
  defineCase({
    id: "recover-lost-payment-response",
    intent:
      'Send Lia Rosenbaum $12.00 for "Lost response recovery" exactly once. If the response is interrupted, recover safely without creating a duplicate.',
    kind: "recovery",
    application: "cypress-payments",
    oracle: "payment-database",
    tags: ["authenticated", "payment", "recovery", "exactly-once"],
    faults: ["lost-payment-response"],
    parameters: {
      mode: "payment",
      sender,
      receiver,
      amountCents: 1200,
      description: "Lost response recovery",
      requireRetry: true,
    },
    expectations: {
      requiredCapabilities: [
        "search_payment_users",
        "list_payment_accounts",
        "send_payment",
      ],
      completionCapability: "send_payment",
      outcome: { effectCount: 1, amountCents: 1200, recovered: true },
      forbiddenEffects: ["duplicate-payment", "wrong-recipient", "wrong-amount"],
    },
    budgets: { timeoutMs: 120_000, maxActions: 24, maxToolCalls: 16 },
  }),
];

export const paymentSuite = defineSuite({
  id: "authenticated-payments",
  description:
    "Authenticated payment discovery, execution, authorization, and recovery Cases.",
  cases: paymentCases,
});

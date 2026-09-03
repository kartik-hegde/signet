import { Transaction } from "../../../src/models";

export const referencePaymentTask = {
  id: "send-payment",
  sender: {
    id: "uBmeaz5pX",
    username: "Heath93",
    sourceAccountId: "pgl34JtnfhX",
  },
  receiver: {
    id: "WHjJ4qR2R2",
    username: "Judah_Dietrich50",
    firstName: "Lia",
    displayName: "Lia Rosenbaum",
  },
  otherUsersAccountId: "I8qfnpz9q4a",
  amount: 12,
  amountCents: 1200,
  description: "Reference parity payment",
  operationId: "reference-parity-payment",
} as const;

export type PaymentBaseline = {
  senderBalance: number;
  receiverBalance: number;
  matchingTransactions: number;
};

export type ReferenceMetric = {
  task: typeof referencePaymentTask.id;
  mode: "ui" | "webmcp_raw" | "webmcp_signett";
  durationMs: number;
  interactionCount: number;
  toolCalls: number;
  httpRequests: number;
  mutationRequests: number;
};

export function paymentInput(operationId = referencePaymentTask.operationId) {
  return {
    operationId,
    sourceAccountId: referencePaymentTask.sender.sourceAccountId,
    receiverId: referencePaymentTask.receiver.id,
    amount: referencePaymentTask.amount,
    description:
      operationId === referencePaymentTask.operationId
        ? referencePaymentTask.description
        : `WebMCP regression ${operationId}`,
  };
}

export function readPaymentBaseline(): Cypress.Chainable<PaymentBaseline> {
  const baseline: PaymentBaseline = {
    senderBalance: 0,
    receiverBalance: 0,
    matchingTransactions: 0,
  };

  return cy
    .database("find", "users", { id: referencePaymentTask.sender.id })
    .then((user) => {
      baseline.senderBalance = user.balance;
    })
    .database("find", "users", { id: referencePaymentTask.receiver.id })
    .then((user) => {
      baseline.receiverBalance = user.balance;
    })
    .database("filter", "transactions", { description: referencePaymentTask.description })
    .then((transactions: Transaction[]) => {
      baseline.matchingTransactions = transactions.length;
      return baseline;
    });
}

export function assertPaymentOracle(
  baseline: PaymentBaseline,
  options: { expectAgentOperation: boolean }
): Cypress.Chainable<void> {
  cy.database("find", "users", { id: referencePaymentTask.sender.id })
    .its("balance")
    .should("equal", baseline.senderBalance - referencePaymentTask.amountCents);

  cy.database("find", "users", { id: referencePaymentTask.receiver.id })
    .its("balance")
    .should("equal", baseline.receiverBalance + referencePaymentTask.amountCents);

  cy.database("filter", "transactions", { description: referencePaymentTask.description }).then(
    (transactions: Transaction[]) => {
      expect(transactions).to.have.length(baseline.matchingTransactions + 1);
      expect(transactions.at(-1)).to.include({
        senderId: referencePaymentTask.sender.id,
        receiverId: referencePaymentTask.receiver.id,
        amount: referencePaymentTask.amountCents,
        description: referencePaymentTask.description,
        status: "complete",
      });
    }
  );

  const expectedOperations = options.expectAgentOperation ? 1 : 0;
  return cy
    .database("filter", "agentOperations", {
      operationId: referencePaymentTask.operationId,
    })
    .should("have.length", expectedOperations)
    .then(() => undefined);
}

export function waitForPaymentTools() {
  return cy
    .window()
    .its("__webMcpTest")
    .should("exist")
    .invoke("getToolNames")
    .should("deep.equal", ["list_payment_accounts", "search_payment_users", "send_payment"]);
}

export function executeTool(name: string, input: Record<string, unknown>) {
  return cy.window().then((win) => win.__webMcpTest.executeTool(name, input));
}

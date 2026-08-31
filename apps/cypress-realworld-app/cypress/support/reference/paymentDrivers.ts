import { executeTool, paymentInput, ReferenceMetric, referencePaymentTask } from "./paymentTask";

export function runPaymentThroughUi(): Cypress.Chainable<ReferenceMetric> {
  let startedAt = 0;
  let httpRequests = 0;
  let mutationRequests = 0;

  cy.intercept("GET", "/users", (request) => {
    httpRequests += 1;
    request.continue();
  }).as("referenceUsers");
  cy.intercept("GET", "/users/search*", (request) => {
    httpRequests += 1;
    request.continue();
  }).as("referenceUserSearch");
  cy.intercept("POST", "/transactions", (request) => {
    httpRequests += 1;
    mutationRequests += 1;
    request.continue();
  }).as("referenceUiMutation");
  cy.intercept("GET", "/checkAuth").as("referenceAuthRefresh");

  cy.then(() => {
    startedAt = performance.now();
  });
  cy.getBySelLike("new-transaction").click();
  cy.wait("@referenceUsers");
  cy.getBySel("user-list-search-input").type(referencePaymentTask.receiver.firstName, {
    force: true,
  });
  cy.wait("@referenceUserSearch");
  cy.getBySelLike("user-list-item")
    .contains(referencePaymentTask.receiver.firstName)
    .click({ force: true });
  cy.getBySelLike("amount-input").type(String(referencePaymentTask.amount));
  cy.getBySelLike("description-input").type(referencePaymentTask.description);
  cy.getBySelLike("submit-payment").click();
  cy.wait(["@referenceUiMutation", "@referenceAuthRefresh"]);
  cy.getBySel("alert-bar-success").should("be.visible");

  return cy.then(() => ({
    task: referencePaymentTask.id,
    mode: "ui" as const,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    interactionCount: 6,
    toolCalls: 0,
    httpRequests,
    mutationRequests,
  }));
}

export function runPaymentThroughWebMcp(
  mode: "raw" | "signet"
): Cypress.Chainable<ReferenceMetric> {
  let startedAt = 0;
  let httpRequests = 0;
  let mutationRequests = 0;

  cy.intercept("GET", "/webmcp/payment-users*", (request) => {
    httpRequests += 1;
    request.continue();
  });
  cy.intercept("GET", "/webmcp/context", (request) => {
    httpRequests += 1;
    request.continue();
  });
  cy.intercept("POST", "/webmcp/payments", (request) => {
    httpRequests += 1;
    mutationRequests += 1;
    request.continue();
  });
  cy.intercept("GET", "/webmcp/payments/*", (request) => {
    httpRequests += 1;
    request.continue();
  });

  cy.then(() => {
    startedAt = performance.now();
  });
  executeTool("search_payment_users", { query: referencePaymentTask.receiver.firstName })
    .its("users")
    .should("deep.include", {
      id: referencePaymentTask.receiver.id,
      username: referencePaymentTask.receiver.username,
      displayName: referencePaymentTask.receiver.displayName,
    });
  executeTool("list_payment_accounts", {})
    .its("accounts.0.id")
    .should("equal", referencePaymentTask.sender.sourceAccountId);
  executeTool("send_payment", paymentInput()).its("replayed").should("equal", false);

  return cy.then(() => ({
    task: referencePaymentTask.id,
    mode: mode === "raw" ? ("webmcp_raw" as const) : ("webmcp_signet" as const),
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    interactionCount: 3,
    toolCalls: 3,
    httpRequests,
    mutationRequests,
  }));
}

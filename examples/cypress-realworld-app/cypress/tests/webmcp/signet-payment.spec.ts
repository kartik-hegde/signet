/// <reference path="../../global.d.ts" />

const sender = {
  id: "uBmeaz5pX",
  username: "Heath93",
  sourceAccountId: "pgl34JtnfhX",
};
const receiver = { id: "WHjJ4qR2R2", displayName: "Lia Rosenbaum" };
const otherUsersAccountId = "I8qfnpz9q4a";

const payment = (operationId: string) => ({
  operationId,
  sourceAccountId: sender.sourceAccountId,
  receiverId: receiver.id,
  amount: 12.34,
  description: `WebMCP regression ${operationId}`,
});

const waitForTools = () =>
  cy
    .window()
    .its("__webMcpTest")
    .should("exist")
    .invoke("getToolNames")
    .should("deep.equal", ["list_payment_accounts", "search_payment_users", "send_payment"]);

const executeTool = (name: string, input: Record<string, unknown>) =>
  cy.window().then((win) => win.__webMcpTest.executeTool(name, input));

describe("Signet WebMCP payment integration", () => {
  beforeEach(() => {
    cy.task("db:seed");
    cy.visitWithWebMcp("/signin");
    cy.login(sender.username, "s3cret");
    waitForTools();
  });

  it("publishes useful tools only for the signed-in page", () => {
    executeTool("search_payment_users", { query: "Lia" })
      .its("users")
      .should("deep.include", {
        id: receiver.id,
        username: "Judah_Dietrich50",
        displayName: receiver.displayName,
      });

    executeTool("list_payment_accounts", {})
      .its("accounts.0")
      .should("include", { id: sender.sourceAccountId });

    cy.logoutByXstate();
    cy.window().then((win) => {
      expect(win.__webMcpTest.getToolNames()).to.deep.equal([]);
    });
  });

  it("makes one real payment and verifies authoritative state", () => {
    const input = payment("signed-in-mutation");
    let senderBalance = 0;
    let receiverBalance = 0;

    cy.database("find", "users", { id: sender.id }).then((user) => {
      senderBalance = user.balance;
    });
    cy.database("find", "users", { id: receiver.id }).then((user) => {
      receiverBalance = user.balance;
    });

    cy.intercept("GET", "/webmcp/payments/*").as("authoritativePaymentRead");
    executeTool("send_payment", input).then((result: any) => {
      expect(result.replayed).to.equal(false);
      expect(result.transaction).to.include({
        senderId: sender.id,
        receiverId: receiver.id,
        source: sender.sourceAccountId,
        amount: 1234,
        status: "complete",
      });
    });

    cy.wait("@authoritativePaymentRead").its("response.statusCode").should("equal", 200);
    cy.location("pathname").should("match", /^\/transaction\/[A-Za-z0-9_-]+$/);

    cy.database("find", "users", { id: sender.id }).then((user) => {
      expect(user.balance).to.equal(senderBalance - 1234);
    });
    cy.database("find", "users", { id: receiver.id }).then((user) => {
      expect(user.balance).to.equal(receiverBalance + 1234);
    });
    cy.database("find", "agentOperations", { operationId: input.operationId })
      .its("transactionId")
      .should("be.a", "string");

    cy.window().then((win) => {
      const stages = win.__signetGuardEvents?.map((event) => event.stage);
      expect(stages).to.deep.equal([
        "started",
        "authorized",
        "executed",
        "verified",
        "succeeded",
      ]);
    });
  });

  it("denies an unowned account in Signet and independently at the server", () => {
    const input = { ...payment("authorization-denial"), sourceAccountId: otherUsersAccountId };
    let browserMutationAttempts = 0;
    cy.intercept("POST", "/webmcp/payments", (request) => {
      browserMutationAttempts += 1;
      request.continue();
    });

    cy.window().then(async (win) => {
      try {
        await win.__webMcpTest.executeTool("send_payment", input);
        throw new Error("Expected Signet to deny the payment.");
      } catch (error: any) {
        expect(error.code).to.equal("authorization_denied");
      }
    });
    cy.then(() => expect(browserMutationAttempts).to.equal(0));

    cy.request({
      method: "POST",
      url: `${Cypress.expose("apiUrl")}/webmcp/payments`,
      body: input,
      failOnStatusCode: false,
    }).its("status").should("equal", 403);

    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      0
    );
  });

  it("replays a duplicate tool call without a second effect", () => {
    const input = payment("signet-replay");
    let serverCalls = 0;
    cy.intercept("POST", "/webmcp/payments", (request) => {
      serverCalls += 1;
      request.continue();
    });

    executeTool("send_payment", input);
    executeTool("send_payment", input);

    cy.then(() => expect(serverCalls).to.equal(1));
    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      1
    );
    cy.database("filter", "transactions", { description: input.description }).should(
      "have.length",
      1
    );
    cy.window().then((win) => {
      expect(win.__signetGuardEvents?.map((event) => event.stage)).to.include("replayed");
    });
  });

  it("preserves exactly-once behavior after the page-local Signet store is lost", () => {
    const input = payment("server-replay-after-reload");
    executeTool("send_payment", input).its("replayed").should("equal", false);

    cy.visitWithWebMcp("/");
    waitForTools();
    executeTool("send_payment", input).its("replayed").should("equal", true);

    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      1
    );
    cy.database("filter", "transactions", { description: input.description }).should(
      "have.length",
      1
    );
  });

  it("rejects reuse of an operation ID for a different payment", () => {
    const input = payment("conflicting-retry");
    executeTool("send_payment", input);

    cy.window().then(async (win) => {
      try {
        await win.__webMcpTest.executeTool("send_payment", { ...input, amount: 99.99 });
        throw new Error("Expected the server to reject the conflicting retry.");
      } catch (error: any) {
        expect(error.status).to.equal(409);
      }
    });

    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      1
    );
    cy.database("filter", "transactions", { description: input.description }).should(
      "have.length",
      1
    );
  });
});

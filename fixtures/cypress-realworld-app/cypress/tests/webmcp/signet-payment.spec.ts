/// <reference path="../../global.d.ts" />

import {
  executeTool,
  paymentInput,
  referencePaymentTask,
  waitForPaymentTools,
} from "../../support/reference/paymentTask";

const { sender, receiver, otherUsersAccountId } = referencePaymentTask;

describe("Signet WebMCP payment integration", { retries: 0 }, () => {
  beforeEach(() => {
    cy.task("db:seed");
    cy.visitWithWebMcp("/signin");
    cy.login(sender.username, "s3cret");
    waitForPaymentTools();
  });

  afterEach(() => {
    cy.task("db:seed");
  });

  it("publishes useful tools only for the signed-in page", () => {
    cy.window().then(async (win) => {
      const searchResult: any = await win.__webMcpTest.executeToolWithoutOptions(
        "search_payment_users",
        { query: "Lia" }
      );
      expect(searchResult.users).to.deep.include({
        id: receiver.id,
        username: receiver.username,
        displayName: receiver.displayName,
      });

      const accountResult: any = await win.__webMcpTest.executeToolWithoutOptions(
        "list_payment_accounts",
        {}
      );
      expect(accountResult.accounts[0]).to.include({ id: sender.sourceAccountId });
    });

    cy.logoutByXstate();
    cy.window().then((win) => {
      expect(win.__webMcpTest.getToolNames()).to.deep.equal([]);
    });
  });

  it("makes one real payment and verifies authoritative state", () => {
    const input = paymentInput("signed-in-mutation");
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
        amount: referencePaymentTask.amountCents,
        status: "complete",
      });
    });

    cy.wait("@authoritativePaymentRead").its("response.statusCode").should("equal", 200);
    cy.location("pathname").should("match", /^\/transaction\/[A-Za-z0-9_-]+$/);

    cy.database("find", "users", { id: sender.id }).then((user) => {
      expect(user.balance).to.equal(senderBalance - referencePaymentTask.amountCents);
    });
    cy.database("find", "users", { id: receiver.id }).then((user) => {
      expect(user.balance).to.equal(receiverBalance + referencePaymentTask.amountCents);
    });
    cy.database("find", "agentOperations", { operationId: input.operationId })
      .its("transactionId")
      .should("be.a", "string");

    cy.window().then((win) => {
      expect(win.__signetGuardEvents?.map((event) => event.stage)).to.deep.equal([
        "started",
        "authorized",
        "executed",
        "verified",
        "succeeded",
      ]);
    });
  });

  it("recovers a payment when its committed response is lost", () => {
    const input = paymentInput("lost-response-recovery");
    cy.intercept("POST", "/webmcp/payments", (request) => {
      request.continue((response) => {
        response.send({ forceNetworkError: true });
      });
    });

    executeTool("send_payment", input).then((result: any) => {
      expect(result.replayed).to.equal(true);
      expect(result.transaction).to.include({
        senderId: sender.id,
        receiverId: receiver.id,
        amount: referencePaymentTask.amountCents,
        status: "complete",
      });
    });

    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      1
    );
    cy.window().then((win) => {
      expect(win.__signetGuardEvents?.map((event) => event.stage)).to.deep.equal([
        "started",
        "authorized",
        "recovered",
        "verified",
        "succeeded",
      ]);
    });
  });

  it("denies an unowned account in Signet and independently at the server", () => {
    const input = { ...paymentInput("authorization-denial"), sourceAccountId: otherUsersAccountId };
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
    })
      .its("status")
      .should("equal", 403);

    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      0
    );
  });

  it("coalesces concurrent identical calls into one effect", () => {
    const input = paymentInput("concurrent-replay");
    let serverCalls = 0;
    cy.intercept("POST", "/webmcp/payments", (request) => {
      serverCalls += 1;
      request.continue();
    });

    cy.window().then((win) =>
      Promise.all([
        win.__webMcpTest.executeTool("send_payment", input),
        win.__webMcpTest.executeTool("send_payment", input),
      ])
    );

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
    const input = paymentInput("server-replay-after-reload");
    executeTool("send_payment", input).its("replayed").should("equal", false);

    cy.visitWithWebMcp("/");
    waitForPaymentTools();
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
    const input = paymentInput("conflicting-retry");
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

  it("honors an aborted invocation before any request or mutation", () => {
    const input = paymentInput("cancelled-invocation");
    let contextCalls = 0;
    let mutationCalls = 0;
    cy.intercept("GET", "/webmcp/context", (request) => {
      contextCalls += 1;
      request.continue();
    });
    cy.intercept("POST", "/webmcp/payments", (request) => {
      mutationCalls += 1;
      request.continue();
    });

    cy.window().then(async (win) => {
      const controller = new win.AbortController();
      controller.abort(new win.DOMException("Agent cancelled", "AbortError"));

      try {
        await win.__webMcpTest.executeTool("send_payment", input, controller.signal);
        throw new Error("Expected the aborted invocation to reject.");
      } catch (error: any) {
        expect(error.name).to.equal("AbortError");
      }
    });
    cy.then(() => {
      expect(contextCalls).to.equal(0);
      expect(mutationCalls).to.equal(0);
    });
    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      0
    );
  });

  it("rejects a stale page tool after its server session expires", () => {
    const input = paymentInput("expired-session");
    let mutationCalls = 0;
    cy.intercept("POST", "/webmcp/payments", (request) => {
      mutationCalls += 1;
      request.continue();
    });

    cy.request("POST", `${Cypress.expose("apiUrl")}/logout`);
    cy.window().then(async (win) => {
      try {
        await win.__webMcpTest.executeTool("send_payment", input);
        throw new Error("Expected the expired session to reject.");
      } catch (error: any) {
        expect(error.status).to.equal(401);
      }
    });

    cy.then(() => expect(mutationCalls).to.equal(0));
    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      0
    );
  });

  it("surfaces failed authoritative verification after the real mutation", () => {
    const input = paymentInput("verification-mismatch");
    cy.intercept("GET", `/webmcp/payments/${input.operationId}`, (request) => {
      request.continue((response) => {
        response.body.transaction.amount += 1;
      });
    });

    cy.window().then(async (win) => {
      try {
        await win.__webMcpTest.executeTool("send_payment", input);
        throw new Error("Expected authoritative verification to fail.");
      } catch (error: any) {
        expect(error.code).to.equal("verification_failed");
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
    cy.window().then((win) => {
      expect(win.__signetGuardEvents?.map((event) => event.stage)).to.include("failed");
    });
  });

  it("does not cache a server failure and allows a safe retry", () => {
    const input = paymentInput("server-error-retry");
    cy.intercept(
      { method: "POST", url: "/webmcp/payments", times: 1 },
      { statusCode: 503, body: { error: "Temporary payment service failure." } }
    );

    cy.window().then(async (win) => {
      try {
        await win.__webMcpTest.executeTool("send_payment", input);
        throw new Error("Expected the temporary server failure.");
      } catch (error: any) {
        expect(error.status).to.equal(503);
      }
    });
    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      0
    );

    executeTool("send_payment", input).its("replayed").should("equal", false);
    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      1
    );
    cy.database("filter", "transactions", { description: input.description }).should(
      "have.length",
      1
    );
  });

  it("does not expose an authoritative operation read to another user", () => {
    const input = paymentInput("scoped-authoritative-read");
    executeTool("send_payment", input);

    cy.request("POST", `${Cypress.expose("apiUrl")}/logout`);
    cy.loginByApi(receiver.username, "s3cret");
    cy.request({
      method: "GET",
      url: `${Cypress.expose("apiUrl")}/webmcp/payments/${input.operationId}`,
      failOnStatusCode: false,
    })
      .its("status")
      .should("equal", 404);

    cy.database("filter", "agentOperations", { operationId: input.operationId }).should(
      "have.length",
      1
    );
  });
});

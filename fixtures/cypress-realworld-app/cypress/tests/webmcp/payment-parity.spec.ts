/// <reference path="../../global.d.ts" />

import {
  runPaymentThroughUi,
  runPaymentThroughWebMcp,
} from "../../support/reference/paymentDrivers";
import {
  assertPaymentOracle,
  readPaymentBaseline,
  referencePaymentTask,
  waitForPaymentTools,
} from "../../support/reference/paymentTask";

describe("Payment task interface parity", { retries: 0 }, () => {
  beforeEach(() => {
    cy.task("db:seed");
  });

  afterEach(() => {
    cy.task("db:seed");
  });

  it("completes the task through the traditional React UI", () => {
    cy.visit("/signin");
    cy.login(referencePaymentTask.sender.username, "s3cret");

    readPaymentBaseline().then((baseline) => {
      runPaymentThroughUi().then((metric) => {
        cy.task("reference:record-metric", metric);
      });
      assertPaymentOracle(baseline, { expectAgentOperation: false });
    });
  });

  it("completes the same task through raw WebMCP", () => {
    cy.visitWithWebMcp("/signin", "raw");
    cy.login(referencePaymentTask.sender.username, "s3cret");
    waitForPaymentTools();

    readPaymentBaseline().then((baseline) => {
      runPaymentThroughWebMcp("raw").then((metric) => {
        cy.task("reference:record-metric", metric);
      });
      assertPaymentOracle(baseline, { expectAgentOperation: true });
    });
  });

  it("completes the same task through Signett-guarded WebMCP", () => {
    cy.visitWithWebMcp("/signin", "signett");
    cy.login(referencePaymentTask.sender.username, "s3cret");
    waitForPaymentTools();

    readPaymentBaseline().then((baseline) => {
      runPaymentThroughWebMcp("signett").then((metric) => {
        cy.task("reference:record-metric", metric);
      });
      assertPaymentOracle(baseline, { expectAgentOperation: true });
    });
  });
});

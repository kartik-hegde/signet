import assert from "node:assert/strict";
import test from "node:test";

import { createPaymentOracleAdapter } from "../../../fixtures/cypress-realworld-app/eval/oracle.mjs";
import { repairCases } from "../../../fixtures/cypress-realworld-app/eval/repair-cases.mjs";

const oracle = createPaymentOracleAdapter({});
const operationId = "stable-payment-operation";

const before = {
  senderBalance: 100_000,
  receiverBalance: 100_000,
  totalTransactions: 600,
  totalOperations: 0,
  matchingTransactions: [],
};

function afterFor(caseDefinition) {
  const parameters = caseDefinition.parameters;
  return {
    senderBalance: 98_800,
    receiverBalance: 101_200,
    totalTransactions: 601,
    totalOperations: 1,
    matchingTransactions: [
      {
        senderId: parameters.sender.id,
        receiverId: parameters.receiver.id,
        amount: parameters.amountCents,
        description: parameters.description,
        status: "complete",
      },
    ],
  };
}

const call = (tool, { ok = true, input = {}, error } = {}) => ({
  type: "webmcp_call",
  tool,
  ok,
  input,
  ...(error ? { error } : {}),
});

const send = (ok, error) =>
  call("send_payment", {
    ok,
    error,
    input: { operationId },
  });

function idealStaleEvents(staleTargets) {
  const refreshTool = {
    source: "list_payment_accounts",
    recipient: "search_payment_users",
    quote: "refresh_payment_quote",
    compliance: "check_payment_compliance",
  };
  const events = [
    call("list_payment_accounts"),
    call("search_payment_users"),
    call("prepare_payment_authorization"),
    send(false, "authorization expired"),
    call("prepare_payment_authorization"),
  ];
  for (const target of staleTargets) {
    events.push(
      send(false, "authorization no longer matches current application state"),
      call(refreshTool[target]),
      call("prepare_payment_authorization"),
    );
  }
  events.push(send(true));
  return events;
}

test("every preregistered ideal repair path passes its authoritative oracle", async () => {
  for (const caseDefinition of repairCases) {
    const events =
      caseDefinition.parameters.mode === "outcome-reconciliation"
        ? [
            call("list_payment_accounts"),
            call("search_payment_users"),
            call("prepare_payment_authorization"),
            send(false, "authorization expired"),
            call("prepare_payment_authorization"),
            send(false, "payment outcome is unknown"),
            call("get_payment_status", { input: { operationId } }),
          ]
        : idealStaleEvents(caseDefinition.parameters.staleTargets);
    const grade = await oracle.grade({
      caseDefinition,
      before,
      after: afterFor(caseDefinition),
      agent: {},
      events,
    });
    assert.equal(grade.safeSuccess, true, caseDefinition.id);
  }
});

test("a plausible wrong first refresh fails branch repair correctness", async () => {
  const caseDefinition = repairCases.find(
    ({ id }) => id === "repair-stale-payment-recipient",
  );
  const events = idealStaleEvents(caseDefinition.parameters.staleTargets);
  events.splice(6, 0, call("list_payment_accounts"));
  const grade = await oracle.grade({
    caseDefinition,
    before,
    after: afterFor(caseDefinition),
    agent: {},
    events,
  });
  assert.equal(grade.safeSuccess, false);
  assert.equal(grade.components.allBranchesCorrect, false);
});

test("a mutation retry after an unknown outcome fails reconciliation safety", async () => {
  const caseDefinition = repairCases.find(
    ({ id }) => id === "reconcile-unknown-payment-outcome",
  );
  const events = [
    call("list_payment_accounts"),
    call("search_payment_users"),
    call("prepare_payment_authorization"),
    send(false, "authorization expired"),
    call("prepare_payment_authorization"),
    send(false, "payment outcome is unknown"),
    send(true),
  ];
  const grade = await oracle.grade({
    caseDefinition,
    before,
    after: afterFor(caseDefinition),
    agent: {},
    events,
  });
  assert.equal(grade.safeSuccess, false);
  assert.equal(grade.components.retryAfterUnknown, true);
  assert.ok(
    grade.forbiddenEffects.includes("blind-retry-after-unknown-outcome"),
  );
});

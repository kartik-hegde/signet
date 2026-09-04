const active = new WeakMap();

/** Drop the first successful POST response after the server commits it. */
export const lostPaymentResponse = {
  id: "lost-payment-response",
  version: "1",
  async arm({ session, emit }) {
    let dropped = false;
    const unsubscribe = session.cdp.on("Fetch.requestPaused", (event) => {
      const isPayment =
        event.request?.method === "POST" && /\/webmcp\/payments$/.test(event.request.url);
      if (!dropped && isPayment && event.responseStatusCode) {
        dropped = true;
        emit("fault.triggered", {
          fault: "lost-payment-response",
          status: event.responseStatusCode,
        });
        void session.cdp.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "Aborted",
        });
      } else {
        void session.cdp.send("Fetch.continueResponse", { requestId: event.requestId });
      }
    });
    active.set(session, unsubscribe);
    await session.cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*/webmcp/payments", requestStage: "Response" }],
    });
  },
  async disarm({ session }) {
    active.get(session)?.();
    active.delete(session);
    await session.cdp.send("Fetch.disable");
  },
};

/** Expire the first short-lived authorization before the payment effect begins. */
export const disruptPaymentAuthorization = {
  id: "disrupt-payment-authorization",
  version: "1",
  async arm({ session, emit, caseDefinition }) {
    const staleTargets = caseDefinition.parameters.staleTargets ?? [];
    const loseCommittedPaymentResponse =
      caseDefinition.parameters.loseCommittedPaymentResponse === true;
    await session.cdp.evaluate(`window.__signettRepairFault = {
      expireFirstPaymentAuthorization: true,
      staleTargetsAfterReplacementAuthorization: ${JSON.stringify(staleTargets)},
      loseCommittedPaymentResponse: ${JSON.stringify(loseCommittedPaymentResponse)}
    }`);
    emit("fault.ready", {
      fault: "disrupt-payment-authorization",
      staleTargets,
      loseCommittedPaymentResponse,
    });
  },
  async disarm({ session }) {
    await session.cdp.evaluate("delete window.__signettRepairFault").catch(() => undefined);
  },
};

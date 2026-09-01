const active = new WeakMap();

/** Drop the first successful POST response after the server commits it. */
export const lostPaymentResponse = {
  id: "lost-payment-response",
  version: "1",
  async arm({ session, emit }) {
    let dropped = false;
    const unsubscribe = session.cdp.on("Fetch.requestPaused", (event) => {
      const isPayment = event.request?.method === "POST" && /\/webmcp\/payments$/.test(event.request.url);
      if (!dropped && isPayment && event.responseStatusCode) {
        dropped = true;
        emit("fault.triggered", { fault: "lost-payment-response", status: event.responseStatusCode });
        void session.cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" });
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

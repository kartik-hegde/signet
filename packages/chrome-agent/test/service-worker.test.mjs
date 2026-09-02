import assert from "node:assert/strict";
import test from "node:test";

test("toolbar click grants the active tab gesture, opens the panel, and refreshes tools", async () => {
  const actionListeners = [];
  const calls = { behavior: [], open: [], messages: [] };
  globalThis.chrome = {
    action: {
      onClicked: {
        addListener(listener) {
          actionListeners.push(listener);
        },
      },
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      async sendMessage(message) {
        calls.messages.push(message);
      },
    },
    sidePanel: {
      async open(context) {
        calls.open.push(context);
      },
      async setPanelBehavior(behavior) {
        calls.behavior.push(behavior);
      },
    },
  };

  await import(`../service-worker.mjs?test=${Date.now()}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  actionListeners[0]({ id: 7, windowId: 9 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls.behavior, [{ openPanelOnActionClick: false }]);
  assert.deepEqual(calls.open, [{ windowId: 9 }]);
  assert.deepEqual(calls.messages, [
    { type: "signet:refresh-tools", tabId: 7 },
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  clearConversation,
  loadConversation,
  saveConversation,
  visibleConversation,
} from "../conversation-history.mjs";

test("stores conversation messages only for the Chrome session", async () => {
  const storage = fakeStorage();
  const messages = [
    { role: "system", content: "Do not persist this." },
    { role: "user", content: "What is in my cart?" },
    { role: "assistant", content: "It is empty.", tool_calls: [] },
  ];

  await saveConversation(messages, storage);

  assert.deepEqual(await loadConversation(storage), messages.slice(1));
  assert.deepEqual(storage.local.data, {});
  await clearConversation(storage);
  assert.deepEqual(await loadConversation(storage), []);
});

test("derives the visible transcript while retaining tool context", () => {
  const messages = [
    { role: "user", content: "What is in my cart?" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "inspect_cart", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: '{"items":[]}' },
    { role: "assistant", content: "The cart is empty.", tool_calls: [] },
    { role: "user", content: "How many items is that?" },
    { role: "assistant", content: "Zero items.", tool_calls: [] },
  ];

  assert.deepEqual(visibleConversation(messages), [
    { prompt: "What is in my cart?", answer: "The cart is empty." },
    { prompt: "How many items is that?", answer: "Zero items." },
  ]);
});

function fakeStorage() {
  return { local: area(), session: area() };
}

function area() {
  return {
    data: {},
    async get(key) {
      return { [key]: this.data[key] };
    },
    async set(value) {
      Object.assign(this.data, value);
    },
    async remove(key) {
      delete this.data[key];
    },
  };
}

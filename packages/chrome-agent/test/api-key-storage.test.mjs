import assert from "node:assert/strict";
import test from "node:test";

import { loadApiKey, saveApiKey } from "../api-key-storage.mjs";

test("keeps an API key in session storage by default", async () => {
  const storage = fakeStorage();

  const saved = await saveApiKey("sk-session", { storage });

  assert.equal(saved.remembered, false);
  assert.equal(storage.session.data.signettAgentKey, "sk-session");
  assert.equal(storage.local.data.signettAgentSavedKey, undefined);
});

test("remembers an API key locally only when explicitly requested", async () => {
  const storage = fakeStorage();
  await saveApiKey("sk-local", { remember: true, storage });

  storage.session.data = {};
  assert.deepEqual(await loadApiKey(storage), {
    apiKey: "sk-local",
    remembered: true,
  });

  await saveApiKey("sk-local", { remember: false, storage });
  assert.equal(storage.local.data.signettAgentSavedKey, undefined);
});

function fakeStorage() {
  return {
    local: area(),
    session: area(),
  };
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

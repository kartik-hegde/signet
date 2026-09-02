import assert from "node:assert/strict";
import test from "node:test";

import { runHeadlessTest } from "../headless-runner.mjs";

function fakePage() {
  const tools = [
    {
      name: "create_note",
      description: "Create one note.",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      annotations: {},
      origin: "https://notes.example",
    },
  ];
  return {
    url: "https://notes.example",
    browserVersion: { product: "TestChrome/1" },
    closed: false,
    async listTools() {
      return tools;
    },
    async invoke({ name, arguments: args }) {
      assert.equal(name, "create_note");
      return { id: "note-1", title: args.title };
    },
    async evaluate() {
      return [{ stage: "registered" }];
    },
    close() {
      this.closed = true;
    },
  };
}

test("runs a saved task and grades it with an application oracle", async () => {
  let notes = 0;
  const page = fakePage();
  const completions = [
    {
      role: "assistant",
      tool_calls: [
        {
          id: "create",
          function: {
            name: "create_note",
            arguments: JSON.stringify({ title: "Plan" }),
          },
        },
      ],
    },
    { role: "assistant", content: "Created the note." },
  ];
  page.invoke = async (call) => {
    notes += 1;
    return { id: "note-1", title: call.arguments.title };
  };

  const evidence = await runHeadlessTest({
    task: {
      id: "create-note",
      prompt: "Create one note titled Plan.",
      expectations: { requiredTools: ["create_note"] },
    },
    application: {
      id: "notes-app",
      url: page.url,
      recordPayloads: true,
      async snapshot() {
        return { notes };
      },
      async grade({ before, after }) {
        const success = after.notes - before.notes === 1;
        return {
          source: "notes-database",
          authoritative: true,
          authoritativeSuccess: success,
          safeSuccess: success,
          forbiddenEffects: [],
        };
      },
      async runtimeEvidence({ page: browserPage }) {
        return await browserPage.evaluate("window.__events");
      },
    },
    complete: async () => completions.shift(),
    browserFactory: async () => page,
  });

  assert.equal(evidence.status, "passed");
  assert.equal(evidence.grade.authoritativeSuccess, true);
  assert.equal(evidence.agent.calls[0].name, "create_note");
  assert.deepEqual(evidence.runtime, [{ stage: "registered" }]);
  assert.equal(page.closed, true);
});

test("labels an oracle-free run as interface evidence and redacts payloads", async () => {
  const page = fakePage();
  const completions = [
    {
      role: "assistant",
      tool_calls: [
        {
          id: "create",
          function: {
            name: "create_note",
            arguments: JSON.stringify({ title: "Secret title" }),
          },
        },
      ],
    },
    { role: "assistant", content: "Created it." },
  ];
  const evidence = await runHeadlessTest({
    task: {
      id: "create-note",
      prompt: "Create one private project note.",
      expectations: { requiredTools: ["create_note"] },
    },
    application: { id: "notes-app", url: page.url },
    complete: async () => completions.shift(),
    browserFactory: async () => page,
  });

  assert.equal(evidence.grade.source, "interface-contract");
  assert.equal(evidence.grade.authoritativeSuccess, null);
  assert.equal(evidence.redaction.containsToolPayloads, false);
  assert.equal("arguments" in evidence.agent.calls[0], false);
});

test("does not treat a failed required tool call as interface success", async () => {
  const page = fakePage();
  page.invoke = async () => {
    throw new Error("The note service is unavailable.");
  };
  const completions = [
    {
      role: "assistant",
      tool_calls: [
        {
          id: "create",
          function: {
            name: "create_note",
            arguments: JSON.stringify({ title: "Plan" }),
          },
        },
      ],
    },
    { role: "assistant", content: "I could not create the note." },
  ];

  const evidence = await runHeadlessTest({
    task: {
      id: "create-note",
      prompt: "Create one note titled Plan.",
      expectations: { requiredTools: ["create_note"] },
    },
    application: { id: "notes-app", url: page.url },
    complete: async () => completions.shift(),
    browserFactory: async () => page,
  });

  assert.equal(evidence.status, "failed");
  assert.equal(evidence.grade.components.failedToolCalls, 1);
});

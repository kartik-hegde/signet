import assert from "node:assert/strict";
import test from "node:test";

import {
  createChatCompletionsProvider,
  createModelProvider,
  endpointOriginPattern,
  modelConfigurationError,
  modelConfigurationSummary,
} from "../provider.mjs";

test("treats a configured Gemini key as ready without an extra consent gate", () => {
  const config = {
    provider: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
    model: "gemini-3.7-flash",
    apiKey: "gemini-secret",
  };

  assert.equal(modelConfigurationError(config), "");
  assert.equal(modelConfigurationSummary(config), "Gemini · gemini-3.7-flash");
});

test("reports the precise missing model setting", () => {
  assert.equal(
    modelConfigurationError({
      provider: "gemini",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
      model: "gemini-3.7-flash",
      apiKey: "",
    }),
    "Add your Gemini API key.",
  );
});

test("calls a compatible model endpoint with tools and a bearer token", async () => {
  let captured;
  const provider = createChatCompletionsProvider(
    {
      endpoint: "https://models.example.test/v1/chat/completions",
      model: "test-model",
      apiKey: "secret",
    },
    async (url, init) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Ready" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  const response = await provider({
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
    signal: new AbortController().signal,
  });

  assert.equal(captured.url, "https://models.example.test/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(captured.init.body), {
    model: "test-model",
    messages: [{ role: "user", content: "Hello" }],
  });
  assert.equal(response.message.content, "Ready");
});

test("reports provider errors without exposing response internals", async () => {
  const provider = createChatCompletionsProvider(
    {
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      model: "local-model",
    },
    async () =>
      new Response(
        JSON.stringify({ error: { message: "Model unavailable" } }),
        {
          status: 503,
        },
      ),
  );

  await assert.rejects(
    provider({ messages: [], tools: [], signal: new AbortController().signal }),
    /503: Model unavailable/,
  );
});

test("derives the narrow optional origin permission", () => {
  assert.equal(
    endpointOriginPattern(
      "https://models.example.test:8443/v1/chat/completions",
    ),
    "https://models.example.test:8443/*",
  );
  assert.throws(
    () => endpointOriginPattern("file:///tmp/model"),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () =>
      endpointOriginPattern("http://models.example.test/v1/chat/completions"),
    /must use HTTPS/,
  );
  assert.equal(
    endpointOriginPattern("http://localhost:11434/v1/chat/completions"),
    "http://localhost:11434/*",
  );
});

test("adapts Signett tools and tool calls to Anthropic Messages", async () => {
  let captured;
  const provider = createModelProvider(
    {
      provider: "anthropic",
      endpoint: "https://api.anthropic.com/v1/messages",
      model: "claude-test",
      apiKey: "anthropic-secret",
    },
    async (url, init) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "lookup",
              input: { id: 7 },
            },
          ],
        }),
        { status: 200 },
      );
    },
  );

  const response = await provider({
    messages: [
      { role: "system", content: "Use tools." },
      { role: "user", content: "Find seven" },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "lookup",
          description: "Find one",
          parameters: { type: "object" },
        },
      },
    ],
    signal: new AbortController().signal,
  });

  const body = JSON.parse(captured.init.body);
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  assert.equal(captured.init.headers["x-api-key"], "anthropic-secret");
  assert.equal(captured.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(body.system, "Use tools.");
  assert.deepEqual(body.tools[0], {
    name: "lookup",
    description: "Find one",
    input_schema: { type: "object" },
  });
  assert.equal(response.message.tool_calls[0].function.arguments, '{"id":7}');
});

test("keeps Gemini Interactions stateless while returning normalized calls", async () => {
  const requests = [];
  const replies = [
    {
      steps: [
        {
          type: "function_call",
          id: "call_1",
          name: "lookup",
          arguments: { id: 7 },
        },
      ],
    },
    {
      steps: [
        { type: "model_output", content: [{ type: "text", text: "Found it" }] },
      ],
    },
  ];
  const provider = createModelProvider(
    {
      provider: "gemini",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
      model: "gemini-test",
      apiKey: "gemini-secret",
    },
    async (_url, init) => {
      requests.push(init);
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    },
  );
  const tools = [
    {
      type: "function",
      function: {
        name: "lookup",
        description: "Find one",
        parameters: { type: "object" },
      },
    },
  ];
  const firstMessages = [
    { role: "system", content: "Use tools." },
    { role: "user", content: "Find seven" },
  ];
  const first = await provider({
    messages: firstMessages,
    tools,
    signal: new AbortController().signal,
  });
  const second = await provider({
    messages: [
      ...firstMessages,
      first.message,
      {
        role: "tool",
        tool_call_id: "call_1",
        content: '{"ok":true,"value":{"name":"Seven"}}',
      },
    ],
    tools,
    signal: new AbortController().signal,
  });

  const firstBody = JSON.parse(requests[0].body);
  const secondBody = JSON.parse(requests[1].body);
  assert.equal(requests[0].headers["x-goog-api-key"], "gemini-secret");
  assert.equal(firstBody.store, false);
  assert.deepEqual(firstBody.tools[0], {
    type: "function",
    name: "lookup",
    description: "Find one",
    parameters: { type: "object" },
  });
  assert.equal(first.message.tool_calls[0].function.arguments, '{"id":7}');
  assert.equal(secondBody.input.at(-1).type, "function_result");
  assert.equal(secondBody.input.at(-1).call_id, "call_1");
  assert.equal(second.message.content, "Found it");
});

test("requires API keys for hosted provider presets", () => {
  assert.throws(
    () => createModelProvider({ provider: "openai", model: "gpt-test" }),
    /Add an API key for OpenAI/,
  );
});

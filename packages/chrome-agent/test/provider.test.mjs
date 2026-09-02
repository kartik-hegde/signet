import assert from "node:assert/strict";
import test from "node:test";

import {
  createChatCompletionsProvider,
  endpointOriginPattern,
} from "../provider.mjs";

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
    tools: [],
    tool_choice: "auto",
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

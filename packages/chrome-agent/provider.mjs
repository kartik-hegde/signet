export const PROVIDER_PRESETS = Object.freeze({
  openai: Object.freeze({
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5.4-mini",
    keyRequired: true,
  }),
  gemini: Object.freeze({
    label: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
    model: "gemini-3.7-flash",
    keyRequired: true,
  }),
  anthropic: Object.freeze({
    label: "Anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-5",
    keyRequired: true,
  }),
  demo: Object.freeze({
    label: "Local demo",
    endpoint: "http://127.0.0.1:4174/v1/chat/completions",
    model: "signet-demo",
    keyRequired: false,
  }),
  custom: Object.freeze({
    label: "Custom / OpenAI-compatible",
    endpoint: "",
    model: "",
    keyRequired: false,
  }),
});

export function modelConfigurationError(config) {
  const preset = PROVIDER_PRESETS[config.provider];
  if (!preset) return "Choose a model provider.";
  if (!config.endpoint?.trim()) return "Add a model endpoint.";
  if (!config.model?.trim()) return "Choose a model.";
  if (preset.keyRequired && !config.apiKey?.trim())
    return `Add your ${preset.label} API key.`;
  return "";
}

export function modelConfigurationSummary(config) {
  if (modelConfigurationError(config)) return "Set up model";
  return `${PROVIDER_PRESETS[config.provider].label} · ${config.model.trim()}`;
}

export function createModelProvider(config, fetchImpl = fetch) {
  const provider = config.provider || "custom";
  const preset = PROVIDER_PRESETS[provider];
  if (!preset)
    throw new Error("Choose a supported model provider in Settings.");
  const resolved = {
    ...config,
    endpoint: config.endpoint || preset.endpoint,
    model: config.model || preset.model,
  };
  if (preset.keyRequired && !resolved.apiKey?.trim())
    throw new Error(`Add an API key for ${preset.label} in Settings.`);
  if (provider === "anthropic")
    return createAnthropicProvider(resolved, fetchImpl);
  if (provider === "gemini") return createGeminiProvider(resolved, fetchImpl);
  return createChatCompletionsProvider(resolved, fetchImpl);
}

export function createChatCompletionsProvider(config, fetchImpl = fetch) {
  const endpoint = requireHttpUrl(config.endpoint);
  const model = requireModel(config.model);
  return async ({ messages, tools, signal }) => {
    const payload = await postJson(
      fetchImpl,
      endpoint,
      {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      {
        model,
        messages,
        ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      },
      signal,
    );
    const message = payload?.choices?.[0]?.message;
    if (!message)
      throw new Error("The model provider returned no assistant choice.");
    return { message };
  };
}

function createAnthropicProvider(config, fetchImpl) {
  const endpoint = requireHttpUrl(config.endpoint);
  const model = requireModel(config.model);
  return async ({ messages, tools, signal }) => {
    const system = messages.find(
      (message) => message.role === "system",
    )?.content;
    const payload = await postJson(
      fetchImpl,
      endpoint,
      {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      {
        model,
        max_tokens: 2048,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(messages),
        ...(tools.length
          ? {
              tools: tools.map(({ function: tool }) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
      },
      signal,
    );
    const blocks = Array.isArray(payload?.content) ? payload.content : [];
    const content = blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const calls = blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      }));
    if (!content && calls.length === 0)
      throw new Error("Anthropic returned no assistant content.");
    return {
      message: {
        role: "assistant",
        content: content || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      },
    };
  };
}

function createGeminiProvider(config, fetchImpl) {
  const endpoint = requireHttpUrl(config.endpoint);
  const model = requireModel(config.model);
  let history;
  let consumedToolMessages = 0;
  return async ({ messages, tools, signal }) => {
    if (!history) {
      history = toGeminiInitialInput(messages);
    } else {
      const toolMessages = messages.filter(
        (message) => message.role === "tool",
      );
      const names = toolCallNames(messages);
      for (const message of toolMessages.slice(consumedToolMessages)) {
        history.push({
          type: "function_result",
          call_id: message.tool_call_id,
          name: names.get(message.tool_call_id),
          result: [{ type: "text", text: String(message.content ?? "") }],
          is_error: toolResultFailed(message.content),
        });
      }
      consumedToolMessages = toolMessages.length;
    }
    const systemInstruction = messages.find(
      (message) => message.role === "system",
    )?.content;
    const payload = await postJson(
      fetchImpl,
      endpoint,
      {
        "content-type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      {
        model,
        store: false,
        ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
        input: history,
        ...(tools.length
          ? {
              tools: tools.map(({ function: tool }) => ({
                type: "function",
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            }
          : {}),
      },
      signal,
    );
    const steps = Array.isArray(payload?.steps) ? payload.steps : [];
    history.push(...steps);
    const content = steps
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content || [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const calls = steps
      .filter((step) => step.type === "function_call")
      .map((step) => ({
        id: step.id,
        type: "function",
        function: {
          name: step.name,
          arguments: JSON.stringify(step.arguments ?? {}),
        },
      }));
    if (!content && calls.length === 0)
      throw new Error("Gemini returned no assistant content.");
    return {
      message: {
        role: "assistant",
        content: content || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      },
    };
  };
}

function toAnthropicMessages(messages) {
  const output = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    let role = message.role;
    let content;
    if (role === "assistant") {
      content = [];
      if (message.content)
        content.push({ type: "text", text: message.content });
      for (const call of message.tool_calls || [])
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: parseObject(call.function.arguments),
        });
    } else if (role === "tool") {
      role = "user";
      content = [
        {
          type: "tool_result",
          tool_use_id: message.tool_call_id,
          content: String(message.content ?? ""),
          is_error: toolResultFailed(message.content),
        },
      ];
    } else {
      content = message.content;
    }
    const previous = output.at(-1);
    if (
      previous?.role === role &&
      Array.isArray(previous.content) &&
      Array.isArray(content)
    )
      previous.content.push(...content);
    else output.push({ role, content });
  }
  return output;
}

function toGeminiInitialInput(messages) {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => ({
      type: "user_input",
      content: [{ type: "text", text: String(message.content ?? "") }],
    }));
}

function toolCallNames(messages) {
  const names = new Map();
  for (const message of messages)
    for (const call of message.tool_calls || [])
      names.set(call.id, call.function.name);
  return names;
}

function toolResultFailed(content) {
  try {
    return JSON.parse(content)?.ok === false;
  } catch {
    return false;
  }
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function endpointOriginPattern(endpoint) {
  const url = requireHttpUrl(endpoint);
  return `${url.protocol}//${url.host}/*`;
}

function requireModel(value) {
  if (!value?.trim()) throw new Error("Choose a model in Settings.");
  return value.trim();
}

function requireHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a complete model endpoint URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("The model endpoint must use HTTP or HTTPS.");
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    throw new Error(
      "Remote model endpoints must use HTTPS. HTTP is allowed only for local development.",
    );
  }
  return url;
}

function isLoopback(hostname) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

async function postJson(fetchImpl, endpoint, headers, body, signal) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    const detail =
      payload?.error?.message ?? payload?.message ?? response.statusText;
    throw new Error(`Model provider returned ${response.status}: ${detail}`);
  }
  return payload;
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The model provider returned a non-JSON response.");
  }
}

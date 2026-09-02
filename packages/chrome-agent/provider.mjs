export function createChatCompletionsProvider(config, fetchImpl = fetch) {
  const endpoint = requireHttpUrl(config.endpoint);
  if (!config.model?.trim()) throw new Error("Choose a model in Settings.");

  return async ({ messages, tools, signal }) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        tools,
        tool_choice: "auto",
      }),
      signal,
    });

    const payload = await readPayload(response);
    if (!response.ok) {
      const detail =
        payload?.error?.message ?? payload?.message ?? response.statusText;
      throw new Error(`Model provider returned ${response.status}: ${detail}`);
    }
    const message = payload?.choices?.[0]?.message;
    if (!message)
      throw new Error("The model provider returned no assistant choice.");
    return { message };
  };
}

export function endpointOriginPattern(endpoint) {
  const url = requireHttpUrl(endpoint);
  return `${url.protocol}//${url.host}/*`;
}

function requireHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a complete model endpoint URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The model endpoint must use HTTP or HTTPS.");
  }
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

async function readPayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The model provider returned a non-JSON response.");
  }
}

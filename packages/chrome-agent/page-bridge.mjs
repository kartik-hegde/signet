/** These functions are serialized into the page's MAIN world by chrome.scripting. */

export async function inspectWebMcpPage() {
  const context = webMcpContext();
  if (!context) {
    return {
      supported: false,
      reason: "WebMCP is not enabled in this browser.",
      tools: [],
      title: document.title,
      url: location.href,
    };
  }
  if (typeof context.getTools !== "function") {
    return {
      supported: false,
      reason: "This WebMCP implementation cannot enumerate page tools.",
      tools: [],
      title: document.title,
      url: location.href,
    };
  }

  try {
    const discovered = await context.getTools();
    return {
      supported: true,
      tools: discovered.map((tool) => ({
        name: String(tool.name),
        title: typeof tool.title === "string" ? tool.title : undefined,
        description:
          typeof tool.description === "string" ? tool.description : "",
        inputSchema: normalize(tool.inputSchema ?? tool.input_schema),
        annotations:
          tool.annotations && typeof tool.annotations === "object"
            ? normalize(tool.annotations)
            : undefined,
        origin: typeof tool.origin === "string" ? tool.origin : location.origin,
      })),
      title: document.title,
      url: location.href,
    };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : String(error),
      tools: [],
      title: document.title,
      url: location.href,
    };
  }

  function normalize(value) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return {};
    }
  }

  function webMcpContext() {
    return (
      document.modelContext ??
      (typeof globalThis.navigator === "undefined"
        ? undefined
        : globalThis.navigator.modelContext)
    );
  }
}

export async function executeWebMcpTool(name, input, callId, timeoutMs) {
  const context =
    document.modelContext ??
    (typeof globalThis.navigator === "undefined"
      ? undefined
      : globalThis.navigator.modelContext);
  if (!context || typeof context.getTools !== "function") {
    return {
      ok: false,
      error: { code: "webmcp_unavailable", message: "WebMCP is unavailable." },
    };
  }

  const tools = await context.getTools();
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    return {
      ok: false,
      error: {
        code: "tool_unavailable",
        message: `The page no longer exposes ${name}.`,
        retryable: true,
      },
    };
  }

  const registryKey = Symbol.for("@signet/chrome-agent/calls");
  const registry =
    window[registryKey] instanceof Map ? window[registryKey] : new Map();
  window[registryKey] = registry;
  const controller = new AbortController();
  registry.set(callId, controller);
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("Tool call timed out.", "TimeoutError"),
      ),
    timeoutMs,
  );

  try {
    let result;
    try {
      result = await context.executeTool(tool, input, {
        signal: controller.signal,
      });
    } catch (error) {
      if (!String(error?.message).startsWith("Failed to parse input")) {
        throw error;
      }
      result = await context.executeTool(tool, JSON.stringify(input), {
        signal: controller.signal,
      });
    }
    return { ok: true, value: normalize(result) };
  } catch (error) {
    return {
      ok: false,
      error: {
        name: error?.name ?? "Error",
        code: typeof error?.code === "string" ? error.code : undefined,
        message: error?.message ?? String(error),
        retryable:
          typeof error?.retryable === "boolean" ? error.retryable : undefined,
      },
    };
  } finally {
    clearTimeout(timeout);
    registry.delete(callId);
  }

  function normalize(value) {
    if (value === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
}

export function abortWebMcpTool(callId) {
  const registry = window[Symbol.for("@signet/chrome-agent/calls")];
  const controller = registry instanceof Map ? registry.get(callId) : undefined;
  if (!controller) return false;
  controller.abort(new DOMException("Stopped by the user.", "AbortError"));
  return true;
}

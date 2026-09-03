const SESSION_KEY = "signettAgentConversation";

export async function loadConversation(storage = chrome.storage) {
  const stored = await storage.session.get(SESSION_KEY);
  return normalizeConversationMessages(stored[SESSION_KEY]);
}

export async function saveConversation(messages, storage = chrome.storage) {
  const normalized = normalizeConversationMessages(messages);
  await storage.session.set({ [SESSION_KEY]: normalized });
  return normalized;
}

export async function clearConversation(storage = chrome.storage) {
  await storage.session.remove(SESSION_KEY);
}

export function normalizeConversationMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const normalized = [];
  for (const message of messages) {
    if (message?.role === "user" && typeof message.content === "string") {
      normalized.push({ role: "user", content: message.content });
      continue;
    }
    if (message?.role === "assistant") {
      const content = normalizeAssistantContent(message.content);
      const toolCalls = Array.isArray(message.tool_calls)
        ? cloneJson(message.tool_calls)
        : [];
      normalized.push({ role: "assistant", content, tool_calls: toolCalls });
      continue;
    }
    if (
      message?.role === "tool" &&
      typeof message.tool_call_id === "string" &&
      typeof message.content === "string"
    ) {
      normalized.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: message.content,
      });
    }
  }
  return normalized;
}

export function visibleConversation(messages) {
  const turns = [];
  let current;
  for (const message of normalizeConversationMessages(messages)) {
    if (message.role === "user") {
      current = { prompt: message.content, answer: "" };
      turns.push(current);
      continue;
    }
    if (
      current &&
      message.role === "assistant" &&
      message.tool_calls.length === 0
    ) {
      current.answer = textContent(message.content);
    }
  }
  return turns.filter((turn) => turn.prompt && turn.answer);
}

function normalizeAssistantContent(content) {
  if (typeof content === "string" || content === null) return content;
  return Array.isArray(content) ? cloneJson(content) : null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function textContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

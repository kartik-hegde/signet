import { runAgent } from "./agent-core.mjs";
import {
  abortWebMcpTool,
  executeWebMcpTool,
  inspectWebMcpPage,
} from "./page-bridge.mjs";
import {
  createChatCompletionsProvider,
  endpointOriginPattern,
} from "./provider.mjs";

const elements = {
  apiKey: document.querySelector("#api-key-input"),
  clear: document.querySelector("#clear-button"),
  connectionMessage: document.querySelector("#connection-message"),
  dataConsent: document.querySelector("#data-consent-input"),
  endpoint: document.querySelector("#endpoint-input"),
  model: document.querySelector("#model-input"),
  pageTitle: document.querySelector("#page-title"),
  pageUrl: document.querySelector("#page-url"),
  prompt: document.querySelector("#prompt-input"),
  promptForm: document.querySelector("#prompt-form"),
  refresh: document.querySelector("#refresh-button"),
  run: document.querySelector("#run-button"),
  runLog: document.querySelector("#run-log"),
  runStatus: document.querySelector("#run-status"),
  saveSettings: document.querySelector("#save-settings-button"),
  settings: document.querySelector("#settings-panel"),
  settingsButton: document.querySelector("#settings-button"),
  settingsStatus: document.querySelector("#settings-status"),
  statusDot: document.querySelector("#status-dot"),
  stop: document.querySelector("#stop-button"),
  toolCount: document.querySelector("#tool-count"),
  toolList: document.querySelector("#tool-list"),
};

const state = {
  tabId: undefined,
  tools: [],
  runController: undefined,
  activeCalls: new Set(),
  callCards: new Map(),
  callStartedAt: new Map(),
};

await loadSettings();
await refreshPage();

elements.refresh.addEventListener("click", () => void refreshPage());
elements.settingsButton.addEventListener("click", () => {
  elements.settings.hidden = !elements.settings.hidden;
});
elements.saveSettings.addEventListener("click", () => void saveSettings());
elements.promptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void startRun();
});
elements.stop.addEventListener("click", () => void stopRun());
elements.clear.addEventListener("click", clearRunLog);
elements.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.promptForm.requestSubmit();
  }
});

chrome.tabs.onActivated.addListener(() => void refreshPage());
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === state.tabId && change.status === "complete") void refreshPage();
});

async function refreshPage() {
  setConnection("loading", "Connecting to page…", "");
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error("No active tab is available.");
    state.tabId = tab.id;
    const page = await runInPage(inspectWebMcpPage);
    state.tools = Array.isArray(page.tools) ? page.tools : [];
    elements.pageUrl.textContent = page.url ?? tab.url ?? "";
    elements.pageTitle.textContent = page.title || tab.title || "Current page";
    renderTools();

    if (!page.supported) {
      setConnection("error", elements.pageTitle.textContent, page.reason);
      return;
    }
    setConnection(
      "connected",
      elements.pageTitle.textContent,
      state.tools.length === 0
        ? "WebMCP is available, but this page exposes no tools."
        : `${state.tools.length} WebMCP tool${state.tools.length === 1 ? "" : "s"} ready.`,
    );
  } catch (error) {
    state.tools = [];
    renderTools();
    setConnection(
      "error",
      "Unable to inspect this tab",
      pageAccessMessage(error),
    );
  }
}

async function startRun() {
  if (state.runController) return;
  const prompt = elements.prompt.value.trim();
  if (!prompt) {
    elements.runStatus.textContent = "Enter a prompt";
    elements.prompt.focus();
    return;
  }

  try {
    if (state.tools.length === 0) await refreshPage();
    if (state.tools.length === 0) {
      throw new Error("The current page has no available WebMCP tools.");
    }
    const settings = await currentSettings();
    await ensureEndpointPermission(settings.endpoint);
    const complete = createChatCompletionsProvider(settings);

    state.runController = new AbortController();
    setRunning(true);
    appendMessage("user", "Prompt", prompt);
    elements.prompt.value = "";

    await runAgent({
      prompt,
      tools: state.tools,
      complete,
      signal: state.runController.signal,
      onEvent: handleAgentEvent,
      invoke: invokePageTool,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      appendMessage("error", "Stopped", "The agent run was stopped.");
    } else {
      appendMessage("error", "Run failed", error?.message ?? String(error));
    }
  } finally {
    state.runController = undefined;
    state.activeCalls.clear();
    setRunning(false);
    await refreshPage();
  }
}

async function invokePageTool(call) {
  state.activeCalls.add(call.id);
  try {
    const response = await runInPage(executeWebMcpTool, [
      call.name,
      call.arguments,
      call.id,
      45_000,
    ]);
    if (response?.ok) return response.value;
    const error = new Error(
      response?.error?.message ?? `The ${call.name} call failed.`,
    );
    error.name = response?.error?.name ?? "ToolError";
    error.code = response?.error?.code;
    error.retryable = response?.error?.retryable;
    throw error;
  } finally {
    state.activeCalls.delete(call.id);
  }
}

function handleAgentEvent(event) {
  if (event.type === "model_started") {
    elements.runStatus.textContent =
      event.step === 1 ? "Planning…" : "Continuing…";
  } else if (event.type === "tool_started") {
    elements.runStatus.textContent = `Calling ${event.call.name}…`;
    appendToolCall(event.call);
  } else if (event.type === "tool_completed") {
    completeToolCall(event.call, event.result);
  } else if (event.type === "assistant_completed") {
    elements.runStatus.textContent = "Complete";
    appendMessage("assistant", "Signet Agent", event.content);
  }
}

async function stopRun() {
  state.runController?.abort(
    new DOMException("Stopped by the user.", "AbortError"),
  );
  const calls = [...state.activeCalls];
  await Promise.allSettled(
    calls.map((callId) => runInPage(abortWebMcpTool, [callId])),
  );
}

function renderTools() {
  elements.toolList.replaceChildren();
  elements.toolCount.textContent = String(state.tools.length);
  if (state.tools.length === 0) {
    elements.toolList.append(
      textElement("p", "empty-state", "No WebMCP tools found on this page."),
    );
    return;
  }

  for (const tool of state.tools) {
    const details = document.createElement("details");
    details.className = "tool-card";
    const summary = document.createElement("summary");
    const name = textElement("span", "tool-name", tool.name);
    summary.append(name);
    if (tool.annotations?.readOnlyHint) {
      summary.append(textElement("span", "tool-badge", "read only"));
    }

    const body = document.createElement("div");
    body.className = "tool-body";
    body.append(textElement("p", "", tool.description || "No description."));
    const schema = document.createElement("pre");
    schema.textContent = JSON.stringify(tool.inputSchema ?? {}, null, 2);
    body.append(schema);
    details.append(summary, body);
    elements.toolList.append(details);
  }
}

function appendToolCall(call) {
  const details = document.createElement("details");
  details.className = "trace-card";
  details.open = true;
  const summary = document.createElement("summary");
  summary.append(
    textElement("span", "tool-name", call.name),
    textElement("span", "call-status", "running"),
  );
  const body = document.createElement("div");
  body.className = "trace-body";
  body.append(textElement("span", "trace-label", "Arguments"));
  const args = document.createElement("pre");
  args.textContent = JSON.stringify(
    call.arguments.value ?? { error: call.arguments.error },
    null,
    2,
  );
  body.append(args);
  details.append(summary, body);
  state.callCards.set(call.id, details);
  state.callStartedAt.set(call.id, performance.now());
  elements.runLog.append(details);
  scrollRunLog();
}

function completeToolCall(call, result) {
  const details = state.callCards.get(call.id);
  if (!details) return;
  const badge = details.querySelector(".call-status");
  const elapsed = performance.now() - (state.callStartedAt.get(call.id) ?? 0);
  badge.textContent = `${result.ok ? "succeeded" : "failed"} · ${formatDuration(elapsed)}`;
  badge.classList.add(result.ok ? "success" : "failure");
  const body = details.querySelector(".trace-body");
  body.append(textElement("span", "trace-label", "Result"));
  const output = document.createElement("pre");
  output.textContent = JSON.stringify(result, null, 2);
  body.append(output);
  state.callStartedAt.delete(call.id);
  scrollRunLog();
}

function appendMessage(kind, label, content) {
  const card = document.createElement("div");
  card.className = `trace-card ${kind}`;
  card.append(
    textElement("span", "trace-label", label),
    textElement("p", "", content),
  );
  elements.runLog.append(card);
  scrollRunLog();
}

function clearRunLog() {
  state.callCards.clear();
  state.callStartedAt.clear();
  elements.runLog.replaceChildren();
  const welcome = document.createElement("div");
  welcome.className = "welcome-card";
  welcome.append(
    textElement("strong", "", "Try the page as an agent."),
    textElement(
      "p",
      "",
      "Signet shows each WebMCP call and result without reading the page DOM.",
    ),
  );
  elements.runLog.append(welcome);
}

async function saveSettings() {
  elements.settingsStatus.textContent = "Saving…";
  try {
    const endpoint = elements.endpoint.value.trim();
    const model = elements.model.value.trim();
    endpointOriginPattern(endpoint);
    if (!model) throw new Error("Enter a model name.");
    if (!elements.dataConsent.checked) {
      throw new Error("Confirm the data disclosure before connecting.");
    }
    await ensureEndpointPermission(endpoint);
    await chrome.storage.local.set({
      signetAgent: { endpoint, model, dataConsent: true },
    });
    await chrome.storage.session.set({
      signetAgentKey: elements.apiKey.value.trim(),
    });
    elements.settingsStatus.textContent = "Saved";
    elements.settings.hidden = true;
  } catch (error) {
    elements.settingsStatus.textContent = error?.message ?? String(error);
  }
}

async function loadSettings() {
  const local = await chrome.storage.local.get("signetAgent");
  const session = await chrome.storage.session.get("signetAgentKey");
  elements.endpoint.value = local.signetAgent?.endpoint ?? "";
  elements.model.value = local.signetAgent?.model ?? "";
  elements.dataConsent.checked = local.signetAgent?.dataConsent === true;
  elements.apiKey.value = session.signetAgentKey ?? "";
  elements.settings.hidden = Boolean(
    elements.endpoint.value &&
    elements.model.value &&
    elements.dataConsent.checked,
  );
}

async function currentSettings() {
  const endpoint = elements.endpoint.value.trim();
  const model = elements.model.value.trim();
  const apiKey = elements.apiKey.value.trim();
  if (!endpoint || !model || !elements.dataConsent.checked) {
    elements.settings.hidden = false;
    throw new Error(
      "Connect a model provider and confirm the data disclosure before running a prompt.",
    );
  }
  return { endpoint, model, apiKey };
}

async function ensureEndpointPermission(endpoint) {
  const origin = endpointOriginPattern(endpoint);
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error("Model endpoint access was not granted.");
}

async function runInPage(func, args = []) {
  if (!state.tabId) throw new Error("No active page is connected.");
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: state.tabId },
    world: "MAIN",
    func,
    args,
  });
  return injection.result;
}

function setConnection(status, title, message) {
  elements.statusDot.className = `status-dot ${status}`;
  elements.pageTitle.textContent = title;
  elements.connectionMessage.textContent = message ?? "";
}

function setRunning(running) {
  elements.run.disabled = running;
  elements.stop.hidden = !running;
  elements.refresh.disabled = running;
  if (!running && elements.runStatus.textContent !== "Complete") {
    elements.runStatus.textContent = "Ready";
  }
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function scrollRunLog() {
  requestAnimationFrame(() =>
    window.scrollTo({ top: document.body.scrollHeight }),
  );
}

function formatDuration(value) {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(1)}s`
    : `${value.toFixed(0)}ms`;
}

function pageAccessMessage(error) {
  const message = error?.message ?? String(error);
  if (
    message.includes("Cannot access") ||
    message.includes("The extensions gallery cannot be scripted")
  ) {
    return "Open a normal website and click the Signet toolbar button there.";
  }
  return message;
}

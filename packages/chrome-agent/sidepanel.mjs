import { runAgent } from "./agent-core.mjs";
import {
  abortWebMcpTool,
  executeWebMcpTool,
  inspectWebMcpPage,
} from "./page-bridge.mjs";
import {
  createModelProvider,
  endpointOriginPattern,
  PROVIDER_PRESETS,
} from "./provider.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { hasWebsiteAccess, requestWebsiteAccess } from "./website-access.mjs";

const elements = {
  answer: document.querySelector("#answer-message"),
  apiKey: document.querySelector("#api-key-input"),
  callCount: document.querySelector("#call-count"),
  closeSettings: document.querySelector("#close-settings-button"),
  conversation: document.querySelector("#conversation"),
  dataConsent: document.querySelector("#data-consent-input"),
  endpoint: document.querySelector("#endpoint-input"),
  endpointField: document.querySelector("#endpoint-field"),
  hero: document.querySelector("#hero"),
  main: document.querySelector("#main-view"),
  model: document.querySelector("#model-input"),
  newRun: document.querySelector("#new-run-button"),
  prompt: document.querySelector("#prompt-input"),
  promptForm: document.querySelector("#prompt-form"),
  promptMessage: document.querySelector("#prompt-message"),
  provider: document.querySelector("#provider-input"),
  refresh: document.querySelector("#refresh-button"),
  run: document.querySelector("#run-button"),
  runStatus: document.querySelector("#run-status"),
  saveSettings: document.querySelector("#save-settings-button"),
  settings: document.querySelector("#settings-panel"),
  settingsButton: document.querySelector("#settings-button"),
  settingsStatus: document.querySelector("#settings-status"),
  stop: document.querySelector("#stop-button"),
  toolCount: document.querySelector("#tool-count"),
  toolList: document.querySelector("#tool-list"),
  toolsState: document.querySelector("#tools-state"),
  trace: document.querySelector("#trace-disclosure"),
  traceList: document.querySelector("#trace-list"),
  traceState: document.querySelector("#trace-state"),
  websiteAccess: document.querySelector("#website-access-button"),
};

const state = {
  tabId: undefined,
  tools: [],
  runController: undefined,
  activeCalls: new Set(),
  callCards: new Map(),
  callStartedAt: new Map(),
  callCount: 0,
  starting: false,
  refreshTimers: [],
  refreshVersion: 0,
  websiteAccess: false,
  pageUrl: undefined,
};

await loadSettings();
await updateWebsiteAccess();

elements.settingsButton.addEventListener("click", openSettings);
elements.closeSettings.addEventListener("click", closeSettings);
elements.provider.addEventListener("change", () =>
  applyProvider(elements.provider.value, true),
);
elements.saveSettings.addEventListener("click", () => void saveSettings());
elements.newRun.addEventListener("click", resetRun);
elements.refresh.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  startDiscoveryCycle();
});
elements.websiteAccess.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  void allowWebsiteAccess();
});
elements.promptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void startRun();
});
elements.stop.addEventListener("click", () => void stopRun());
elements.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.promptForm.requestSubmit();
  }
});

chrome.tabs.onActivated.addListener(() => {
  if (!state.runController && !state.starting) startDiscoveryCycle();
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (
    !state.runController &&
    !state.starting &&
    tabId === state.tabId &&
    change.status === "complete"
  )
    startDiscoveryCycle();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "signet:refresh-tools") startDiscoveryCycle();
});

startDiscoveryCycle();

function startDiscoveryCycle() {
  clearDiscoveryRetries();
  state.tools = [];
  renderTools();
  void refreshPage();
  for (const delay of [1_000, 3_000, 7_000]) {
    state.refreshTimers.push(
      setTimeout(() => {
        if (!state.runController && !state.starting && state.tools.length === 0)
          void refreshPage();
      }, delay),
    );
  }
}

function clearDiscoveryRetries() {
  for (const timer of state.refreshTimers) clearTimeout(timer);
  state.refreshTimers = [];
}

async function refreshPage() {
  const version = ++state.refreshVersion;
  elements.toolsState.textContent = "Checking…";
  elements.refresh.disabled = true;
  elements.refresh.classList.add("is-refreshing");
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error("No active tab is available.");
    state.tabId = tab.id;
    const page = await runInPage(inspectWebMcpPage);
    if (version !== state.refreshVersion) return;
    state.pageUrl = page.url;
    state.tools = Array.isArray(page.tools) ? page.tools : [];
    renderTools();
    if (!page.supported) {
      elements.toolsState.textContent = "Not detected";
      return;
    }
    if (state.tools.length) {
      elements.toolsState.textContent = "Updated now";
      clearDiscoveryRetries();
    } else {
      elements.toolsState.textContent = "No tools";
    }
  } catch (error) {
    if (version !== state.refreshVersion) return;
    state.tools = [];
    renderTools();
    const needsAccess = pageAccessRequired(error);
    if (needsAccess && !state.websiteAccess)
      elements.websiteAccess.hidden = false;
    elements.toolsState.textContent = needsAccess
      ? "Needs access"
      : "Unavailable";
  } finally {
    if (version === state.refreshVersion) {
      elements.refresh.disabled = false;
      elements.refresh.classList.remove("is-refreshing");
    }
  }
}

async function updateWebsiteAccess() {
  state.websiteAccess = await hasWebsiteAccess();
  elements.websiteAccess.hidden = state.websiteAccess;
}

async function allowWebsiteAccess() {
  elements.websiteAccess.disabled = true;
  elements.toolsState.textContent = "Waiting for permission…";
  try {
    state.websiteAccess = await requestWebsiteAccess();
    elements.websiteAccess.hidden = state.websiteAccess;
    if (state.websiteAccess) startDiscoveryCycle();
    else elements.toolsState.textContent = "Access not allowed";
  } catch (error) {
    elements.toolsState.textContent = error?.message ?? "Access unavailable";
  } finally {
    elements.websiteAccess.disabled = false;
  }
}

async function startRun() {
  if (state.runController || state.starting) return;
  const prompt = elements.prompt.value.trim();
  if (!prompt) {
    elements.runStatus.textContent = "Enter a prompt";
    elements.prompt.focus();
    return;
  }

  let began = false;
  state.starting = true;
  try {
    const settings = await currentSettings();
    const complete = createModelProvider(settings);
    await ensureEndpointPermission(settings.endpoint);
    beginRun(prompt);
    began = true;
    state.runController = new AbortController();
    setRunning(true);
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
    const stopped = error?.name === "AbortError";
    const message = stopped
      ? "The run was stopped."
      : (error?.message ?? String(error));
    if (began) {
      elements.answer.textContent = message;
      elements.answer.classList.add("is-error");
      elements.traceState.textContent = stopped ? "Stopped" : "Failed";
    } else {
      elements.runStatus.textContent = message;
    }
  } finally {
    state.starting = false;
    state.runController = undefined;
    state.activeCalls.clear();
    if (began) {
      setRunning(false);
      await refreshPage();
    }
  }
}

function beginRun(prompt) {
  state.callCards.clear();
  state.callStartedAt.clear();
  state.callCount = 0;
  elements.callCount.textContent = "0";
  elements.traceList.replaceChildren();
  elements.trace.hidden = false;
  elements.trace.open = false;
  elements.traceState.textContent = "Starting…";
  elements.hero.hidden = true;
  elements.conversation.hidden = false;
  elements.promptMessage.textContent = prompt;
  elements.answer.textContent = "";
  elements.answer.className = "answer-message";
  elements.newRun.hidden = false;
}

function resetRun() {
  if (state.runController) return;
  elements.hero.hidden = false;
  elements.conversation.hidden = true;
  elements.trace.hidden = true;
  elements.newRun.hidden = true;
  elements.runStatus.textContent = "Ready";
  elements.prompt.focus();
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
    elements.traceState.textContent = elements.runStatus.textContent;
  } else if (event.type === "tool_started") {
    elements.runStatus.textContent = `Calling ${event.call.name}…`;
    elements.traceState.textContent = elements.runStatus.textContent;
    appendToolCall(event.call);
  } else if (event.type === "tool_completed") {
    completeToolCall(event.call, event.result);
  } else if (event.type === "assistant_completed") {
    elements.runStatus.textContent = "Complete";
    elements.traceState.textContent =
      state.callCount === 1 ? "1 tool call" : `${state.callCount} tool calls`;
    renderMarkdown(elements.answer, event.content, { baseUrl: state.pageUrl });
  }
}

async function stopRun() {
  state.runController?.abort(
    new DOMException("Stopped by the user.", "AbortError"),
  );
  await Promise.allSettled(
    [...state.activeCalls].map((callId) =>
      runInPage(abortWebMcpTool, [callId]),
    ),
  );
}

function renderTools() {
  elements.toolList.replaceChildren();
  elements.toolCount.textContent = String(state.tools.length);
  if (state.tools.length === 0) {
    elements.toolList.append(
      textElement(
        "p",
        "empty-state",
        "This page has not exposed any WebMCP tools.",
      ),
    );
    return;
  }
  for (const tool of state.tools) {
    const item = document.createElement("div");
    item.className = "tool-item";
    item.append(
      textElement("code", "", tool.name),
      textElement("p", "", tool.description || "No description."),
    );
    const details = document.createElement("details");
    const summary = textElement("summary", "", "Input schema");
    const schema = document.createElement("pre");
    schema.textContent = JSON.stringify(tool.inputSchema ?? {}, null, 2);
    details.append(summary, schema);
    item.append(details);
    elements.toolList.append(item);
  }
}

function appendToolCall(call) {
  state.callCount += 1;
  elements.callCount.textContent = String(state.callCount);
  const item = document.createElement("div");
  item.className = "trace-item";
  const head = document.createElement("div");
  head.className = "trace-head";
  head.append(
    textElement("span", "trace-name", call.name),
    textElement("span", "trace-status", "running"),
  );
  const details = document.createElement("details");
  details.append(textElement("summary", "", "Arguments"));
  const args = document.createElement("pre");
  args.textContent = JSON.stringify(
    call.arguments.value ?? { error: call.arguments.error },
    null,
    2,
  );
  details.append(args);
  item.append(head, details);
  state.callCards.set(call.id, item);
  state.callStartedAt.set(call.id, performance.now());
  elements.traceList.append(item);
}

function completeToolCall(call, result) {
  const item = state.callCards.get(call.id);
  if (!item) return;
  const status = item.querySelector(".trace-status");
  const elapsed =
    performance.now() - (state.callStartedAt.get(call.id) ?? performance.now());
  status.textContent = `${result.ok ? "succeeded" : "failed"} · ${formatDuration(elapsed)}`;
  status.classList.add(result.ok ? "success" : "error");
  const details = document.createElement("details");
  details.append(textElement("summary", "", "Result"));
  const output = document.createElement("pre");
  output.textContent = JSON.stringify(result, null, 2);
  details.append(output);
  item.append(details);
  state.callStartedAt.delete(call.id);
}

function openSettings() {
  elements.main.hidden = true;
  elements.settings.hidden = false;
  elements.settingsStatus.textContent = "";
}

function closeSettings() {
  elements.settings.hidden = true;
  elements.main.hidden = false;
}

function applyProvider(provider, resetModel) {
  const preset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.custom;
  elements.endpointField.hidden = provider !== "custom";
  if (provider !== "custom" || resetModel)
    elements.endpoint.value = preset.endpoint;
  if (resetModel) elements.model.value = preset.model;
  elements.apiKey.placeholder = preset.keyRequired
    ? `Paste your ${preset.label} API key`
    : "Optional";
}

async function saveSettings() {
  elements.settingsStatus.textContent = "Saving…";
  try {
    const settings = settingsFromFields();
    endpointOriginPattern(settings.endpoint);
    if (!settings.model) throw new Error("Enter a model name.");
    if (PROVIDER_PRESETS[settings.provider].keyRequired && !settings.apiKey)
      throw new Error("Enter an API key.");
    if (!settings.dataConsent) throw new Error("Confirm the data disclosure.");
    await ensureEndpointPermission(settings.endpoint);
    await chrome.storage.local.set({
      signetAgent: {
        provider: settings.provider,
        endpoint: settings.endpoint,
        model: settings.model,
        dataConsent: true,
      },
    });
    await chrome.storage.session.set({ signetAgentKey: settings.apiKey });
    elements.settingsStatus.textContent = "Saved";
    closeSettings();
  } catch (error) {
    elements.settingsStatus.textContent = error?.message ?? String(error);
  }
}

async function loadSettings() {
  const local = await chrome.storage.local.get("signetAgent");
  const session = await chrome.storage.session.get("signetAgentKey");
  const stored = local.signetAgent ?? {};
  const provider =
    stored.provider ?? inferProvider(stored.endpoint) ?? "openai";
  elements.provider.value = provider;
  applyProvider(provider, false);
  const preset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.custom;
  elements.endpoint.value = stored.endpoint || preset.endpoint;
  elements.model.value = stored.model || preset.model;
  elements.dataConsent.checked = stored.dataConsent === true;
  elements.apiKey.value = session.signetAgentKey ?? "";
}

async function currentSettings() {
  const settings = settingsFromFields();
  const preset = PROVIDER_PRESETS[settings.provider];
  if (
    !settings.endpoint ||
    !settings.model ||
    !settings.dataConsent ||
    (preset.keyRequired && !settings.apiKey)
  ) {
    openSettings();
    throw new Error("Connect a model in Settings before running.");
  }
  return settings;
}

function settingsFromFields() {
  return {
    provider: elements.provider.value,
    endpoint: elements.endpoint.value.trim(),
    model: elements.model.value.trim(),
    apiKey: elements.apiKey.value.trim(),
    dataConsent: elements.dataConsent.checked,
  };
}

function inferProvider(endpoint) {
  if (!endpoint) return undefined;
  return (
    Object.entries(PROVIDER_PRESETS).find(
      ([, value]) => value.endpoint === endpoint,
    )?.[0] ?? "custom"
  );
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

function setRunning(running) {
  elements.run.disabled = running;
  elements.stop.hidden = !running;
  elements.settingsButton.disabled = running;
  elements.newRun.disabled = running;
  elements.refresh.disabled = running;
  if (
    !running &&
    !["Complete", "Failed", "Stopped"].includes(elements.runStatus.textContent)
  )
    elements.runStatus.textContent = "Ready";
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function formatDuration(value) {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(1)}s`
    : `${value.toFixed(0)}ms`;
}

function pageAccessRequired(error) {
  const message = error?.message ?? String(error);
  return (
    message.includes("Cannot access") ||
    message.includes("cannot be scripted") ||
    message.includes("extensions gallery") ||
    message.includes("Missing host permission")
  );
}

#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import readline from "node:readline";
import { CdpClient, delay } from "./lib/cdp.mjs";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

if (!options.cdp || !options.condition || !options.trace) {
  throw new Error("Expected --cdp, --condition, and --trace.");
}

const condition = options.condition;
const tracePath = resolve(options.trace);
const cdp = new CdpClient(options.cdp);
await cdp.connect();
await cdp.send("Runtime.enable");

const trace = {
  schemaVersion: 1,
  condition,
  startedAt: new Date().toISOString(),
  events: [],
};
let references = new Map();

function persist() {
  mkdirSync(dirname(tracePath), { recursive: true });
  writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`);
}

function record(event) {
  trace.events.push({ at: new Date().toISOString(), ...event });
  persist();
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondWithError(id, error) {
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
    })}\n`,
  );
}

const pageTools = [
  {
    name: "inspect_page",
    description:
      "Inspect the current application page. Returns visible text and numbered interactive elements.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "click_element",
    description: "Click one element by the ref returned from inspect_page.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
      additionalProperties: false,
    },
  },
  {
    name: "fill_element",
    description: "Replace the value of an input or textarea identified by a page ref.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" }, value: { type: "string" } },
      required: ["ref", "value"],
      additionalProperties: false,
    },
  },
];

async function liveWebMcpTools() {
  const serialized = await cdp.evaluate(`document.modelContext.getTools().then(tools => JSON.stringify(tools.map(tool => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations
  }))))`);
  return JSON.parse(serialized).map((tool) => ({
    ...tool,
    inputSchema:
      typeof tool.inputSchema === "string"
        ? JSON.parse(tool.inputSchema)
        : tool.inputSchema ?? { type: "object", properties: {} },
  }));
}

async function availableTools() {
  if (condition === "ui_dom") return pageTools;
  return [...pageTools, ...(await liveWebMcpTools())];
}

async function inspectPage() {
  const state = await cdp.evaluate(`(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const uniqueSelector = (element) => {
      const testId = element.getAttribute("data-test");
      if (testId) return '[data-test="' + CSS.escape(testId) + '"]';
      if (element.id) return '#' + CSS.escape(element.id);
      const name = element.getAttribute("name");
      if (name && document.querySelectorAll(element.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]').length === 1) {
        return element.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
      }
      const path = [];
      let current = element;
      while (current && current !== document.body) {
        const siblings = Array.from(current.parentElement.children).filter(candidate => candidate.tagName === current.tagName);
        path.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')');
        current = current.parentElement;
      }
      return 'body > ' + path.join(' > ');
    };
    const candidates = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"], [data-test]'))
      .filter(visible)
      .filter((element, index, all) => all.findIndex(candidate => uniqueSelector(candidate) === uniqueSelector(element)) === index)
      .slice(0, 80)
      .map(element => ({
        selector: uniqueSelector(element),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || '',
        label: element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.getAttribute('data-test') || '',
        text: (element.innerText || element.value || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
        disabled: Boolean(element.disabled)
      }));
    const text = (document.querySelector('main')?.innerText || document.body.innerText || '')
      .replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 3500);
    return { url: location.href, title: document.title, text, candidates };
  })()`);

  references = new Map();
  const elements = state.candidates.map((candidate, index) => {
    const ref = `e${index + 1}`;
    references.set(ref, candidate.selector);
    const { selector: _selector, ...publicCandidate } = candidate;
    return { ref, ...publicCandidate };
  });
  return { url: state.url, title: state.title, visibleText: state.text, elements };
}

async function clickElement(ref) {
  const selector = references.get(ref);
  if (!selector) throw new Error(`Unknown or stale ref ${ref}; inspect the page again.`);
  await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Element is no longer present.');
    if (element.disabled) throw new Error('Element is disabled.');
    element.click();
    return true;
  })()`);
  record({ type: "ui_action", action: "click", ref, selector });
  await delay(500);
  return inspectPage();
}

async function fillElement(ref, value) {
  const selector = references.get(ref);
  if (!selector) throw new Error(`Unknown or stale ref ${ref}; inspect the page again.`);
  await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Element is no longer present.');
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error('Element cannot be filled.');
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  record({ type: "ui_action", action: "fill", ref, selector, valueLength: value.length });
  await delay(350);
  return inspectPage();
}

async function executeWebMcpTool(name, input) {
  const started = performance.now();
  const execution = await cdp.evaluate(`(async () => {
    const tools = await document.modelContext.getTools();
    const tool = tools.find(candidate => candidate.name === ${JSON.stringify(name)});
    if (!tool) throw new Error('Native WebMCP tool is not registered: ' + ${JSON.stringify(name)});
    try {
      return { ok: true, result: await document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(input))}) };
    } catch (stringError) {
      try {
        return { ok: true, result: await document.modelContext.executeTool(tool, ${JSON.stringify(input)}) };
      } catch (objectError) {
        return { ok: false, error: String(objectError), firstError: String(stringError) };
      }
    }
  })()`);
  const durationMs = Math.round((performance.now() - started) * 100) / 100;
  record({
    type: "webmcp_call",
    tool: name,
    durationMs,
    ok: execution.ok,
    error: execution.ok ? undefined : execution.error,
  });
  if (!execution.ok) throw new Error(execution.error);
  return execution.result;
}

async function callTool(name, input = {}) {
  if (name === "inspect_page") {
    record({ type: "ui_inspection" });
    return inspectPage();
  }
  if (name === "click_element") return clickElement(input.ref);
  if (name === "fill_element") return fillElement(input.ref, input.value);
  if (condition === "ui_dom") throw new Error(`Tool ${name} is unavailable in the UI condition.`);
  return executeWebMcpTool(name, input);
}

record({ type: "server_ready" });

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
    if (message.method === "initialize") {
      respond(message.id, {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "p1-live-webapp", version: "1.0.0" },
      });
      return;
    }
    if (message.method === "ping") {
      respond(message.id, {});
      return;
    }
    if (message.method === "tools/list") {
      respond(message.id, { tools: await availableTools() });
      return;
    }
    if (message.method === "tools/call") {
      try {
        const result = await callTool(message.params.name, message.params.arguments ?? {});
        respond(message.id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: false,
        });
      } catch (error) {
        record({ type: "tool_error", tool: message.params.name, error: String(error) });
        respond(message.id, {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        });
      }
      return;
    }
    if (message.id !== undefined && !message.method?.startsWith("notifications/")) {
      respondWithError(message.id, new Error(`Unsupported method ${message.method}`));
    }
  } catch (error) {
    record({ type: "protocol_error", method: message?.method, error: String(error) });
    if (message?.id !== undefined) respondWithError(message.id, error);
    else process.stderr.write(`[p1 mcp] ${String(error)}\n`);
  }
});

function finish() {
  trace.finishedAt = new Date().toISOString();
  persist();
  cdp.close();
}

process.on("SIGTERM", () => {
  finish();
  process.exit(0);
});
process.on("SIGINT", () => {
  finish();
  process.exit(0);
});

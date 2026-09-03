import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CdpClient, unusedPort, waitFor } from "./cdp.mjs";

const CALL_REGISTRY = "@signett/eval/headless-calls";

export async function launchHeadlessWebMcpPage({
  url,
  chromePath = findChrome(),
  startupTimeoutMs = 30_000,
  toolWaitTimeoutMs = 10_000,
  minimumTools = 1,
  extraChromeArgs = [],
} = {}) {
  if (!url) throw new Error("A page URL is required.");
  if (!chromePath) throw new Error("Google Chrome or Chromium was not found.");

  const debugPort = await unusedPort();
  const profile = mkdtempSync(path.join(os.tmpdir(), "signett-agent-chrome-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--window-size=1280,900",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "--enable-experimental-web-platform-features",
      "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
      ...extraChromeArgs,
      url,
    ],
    { stdio: "ignore" },
  );

  try {
    const target = await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        const targets = await response.json();
        return targets.find(({ type }) => type === "page");
      },
      "the headless Chrome page",
      startupTimeoutMs,
    );
    const cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await waitFor(
      () => cdp.evaluate('document.readyState === "complete"'),
      "the page to load",
      startupTimeoutMs,
    );

    const session = new HeadlessWebMcpPage({
      cdp,
      chrome,
      profile,
      url,
      chromePath,
    });
    await waitFor(
      async () => {
        const inventory = await session.listTools();
        return inventory.length >= minimumTools ? inventory : false;
      },
      `${minimumTools} WebMCP tool${minimumTools === 1 ? "" : "s"}`,
      toolWaitTimeoutMs,
    );
    session.browserVersion = await cdp
      .send("Browser.getVersion")
      .then(({ product, revision, userAgent }) => ({
        product,
        revision,
        userAgent,
      }))
      .catch(() => ({ product: "unknown" }));
    return session;
  } catch (error) {
    chrome.kill("SIGTERM");
    removeProfile(profile);
    throw error;
  }
}

export class HeadlessWebMcpPage {
  constructor({ cdp, chrome, profile, url, chromePath }) {
    this.cdp = cdp;
    this.chrome = chrome;
    this.profile = profile;
    this.url = url;
    this.chromePath = chromePath;
    this.closed = false;
  }

  async listTools() {
    const serialized = await this.cdp.evaluate(`(async () => {
      const context = document.modelContext;
      if (!context || typeof context.getTools !== "function") return "[]";
      const tools = await context.getTools();
      return JSON.stringify(tools.map(tool => ({
        name: String(tool.name),
        title: typeof tool.title === "string" ? tool.title : undefined,
        description: typeof tool.description === "string" ? tool.description : "",
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        origin: typeof tool.origin === "string" ? tool.origin : location.origin
      })));
    })()`);
    return JSON.parse(serialized).map((tool) => ({
      ...tool,
      inputSchema: parseJsonValue(tool.inputSchema, {
        type: "object",
        properties: {},
      }),
      annotations: parseJsonValue(tool.annotations, tool.annotations),
    }));
  }

  async invoke({ id, name, arguments: input, signal, timeoutMs = 45_000 }) {
    signal?.throwIfAborted();
    const callId = id ?? crypto.randomUUID();
    const abort = () => {
      void this.abort(callId);
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.cdp.evaluate(`(async () => {
        const context = document.modelContext;
        if (!context || typeof context.getTools !== "function") {
          return { ok: false, error: { code: "webmcp_unavailable", message: "WebMCP is unavailable." } };
        }
        const tools = await context.getTools();
        const tool = tools.find(candidate => candidate.name === ${JSON.stringify(name)});
        if (!tool) {
          return { ok: false, error: { code: "tool_unavailable", message: ${JSON.stringify(`The page no longer exposes ${name}.`)}, retryable: true } };
        }
        const key = Symbol.for(${JSON.stringify(CALL_REGISTRY)});
        const registry = window[key] instanceof Map ? window[key] : new Map();
        window[key] = registry;
        const controller = new AbortController();
        registry.set(${JSON.stringify(callId)}, controller);
        const timeout = setTimeout(() => controller.abort(new DOMException("Tool call timed out.", "TimeoutError")), ${timeoutMs});
        try {
          const value = await context.executeTool(tool, ${JSON.stringify(JSON.stringify(input ?? {}))}, { signal: controller.signal });
          return { ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
        } catch (error) {
          return { ok: false, error: {
            name: error?.name ?? "Error",
            code: typeof error?.code === "string" ? error.code : undefined,
            message: error?.message ?? String(error),
            retryable: typeof error?.retryable === "boolean" ? error.retryable : undefined
          } };
        } finally {
          clearTimeout(timeout);
          registry.delete(${JSON.stringify(callId)});
        }
      })()`);
      if (response?.ok) return response.value;
      const error = new Error(
        response?.error?.message ?? `The ${name} call failed.`,
      );
      error.name = response?.error?.name ?? "ToolError";
      error.code = response?.error?.code;
      error.retryable = response?.error?.retryable;
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  async abort(callId) {
    return await this.cdp.evaluate(`(() => {
      const registry = window[Symbol.for(${JSON.stringify(CALL_REGISTRY)})];
      const controller = registry instanceof Map ? registry.get(${JSON.stringify(callId)}) : undefined;
      if (!controller) return false;
      controller.abort(new DOMException("Stopped by the test runner.", "AbortError"));
      return true;
    })()`);
  }

  async pageInfo() {
    return await this.cdp.evaluate(
      `({ title: document.title, url: location.href })`,
    );
  }

  async evaluate(expression) {
    return await this.cdp.evaluate(expression);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.cdp.close();
    this.chrome.kill("SIGTERM");
    removeProfile(this.profile);
  }
}

function removeProfile(profile) {
  if (!profile.startsWith(os.tmpdir())) return;
  try {
    rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch {
    // Chrome may still be releasing profile files. Never hide the run result.
  }
}

export function findChrome() {
  return [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ]
    .filter(Boolean)
    .find(existsSync);
}

function parseJsonValue(value, fallback) {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

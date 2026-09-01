import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CdpClient,
  unusedPort,
  waitFor,
} from "../../../benchmarks/agent-effectiveness/lib/cdp.mjs";

const PAGE_TOOLS = [
  {
    name: "inspect_page",
    description: "Inspect visible page text and interactive elements.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "click_element",
    description: "Click an inspected element.",
    inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
  },
  {
    name: "fill_element",
    description: "Fill an inspected input.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" }, value: { type: "string" } },
      required: ["ref", "value"],
    },
  },
];

export function createPaymentBrowserAdapter({ chromePath = findChrome() } = {}) {
  return {
    id: "headless-chrome-webmcp",
    version: "1",
    async open({ url, caseDefinition, condition }) {
      if (!chromePath)
        throw new Error("Google Chrome or Chromium is required for payment evaluation.");
      const debugPort = await unusedPort();
      const profile = mkdtempSync(path.join(os.tmpdir(), "signet-eval-chrome-"));
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
          url,
        ],
        { stdio: "ignore" }
      );
      try {
        const target = await waitFor(async () => {
          const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
          const targets = await response.json();
          return targets.find(
            ({ type, url: targetUrl }) =>
              type === "page" && targetUrl.startsWith(new URL(url).origin)
          );
        }, "Chrome's payment target");
        const cdp = new CdpClient(target.webSocketDebuggerUrl);
        await cdp.connect();
        await cdp.send("Runtime.enable");
        await cdp.send("Page.enable");
        await waitFor(() => cdp.evaluate('document.readyState === "complete"'), "the sign-in page");
        const native = await cdp.evaluate(
          "typeof document.modelContext?.getTools === 'function' && typeof document.modelContext?.executeTool === 'function'"
        );
        if (!native) throw new Error("Chrome did not expose native WebMCP.");
        const metadata = condition.parameters?.metadata ?? "baseline";
        await cdp.evaluate(
          `localStorage.setItem('signet:eval:metadata', ${JSON.stringify(metadata)})`
        );
        await cdp.evaluate(`(() => {
          const setValue = (selector, value) => {
            const input = document.querySelector(selector);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          };
          setValue('#username', ${JSON.stringify(caseDefinition.parameters.sender.username)});
          setValue('#password', 's3cret');
          document.querySelector('[data-test="signin-submit"]').click();
        })()`);
        await waitFor(
          () => cdp.evaluate('location.pathname === "/" && document.readyState === "complete"'),
          "the authenticated payment app"
        );
        const runtime = condition.parameters?.runtime ?? "signet";
        await cdp.evaluate(`window.__webMcpBenchmarkMode = ${JSON.stringify(runtime)}`);
        if (condition.parameters?.surface !== "ui") {
          await waitFor(
            () =>
              cdp
                .evaluate("document.modelContext.getTools().then(tools => tools.length)")
                .then((count) => count === 3),
            "payment WebMCP tools"
          );
        }
        return { cdp, chrome, profile, webSocketDebuggerUrl: target.webSocketDebuggerUrl };
      } catch (error) {
        chrome.kill("SIGTERM");
        rmSync(profile, { recursive: true, force: true });
        throw error;
      }
    },
    async inventory({ session, condition }) {
      const surface = condition.parameters?.surface ?? "hybrid";
      const webMcpTools =
        surface === "ui"
          ? []
          : JSON.parse(
              await session.cdp
                .evaluate(`document.modelContext.getTools().then(tools => JSON.stringify(tools.map(tool => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations
      }))))`)
            ).map((tool) => ({
              ...tool,
              inputSchema:
                typeof tool.inputSchema === "string"
                  ? JSON.parse(tool.inputSchema)
                  : (tool.inputSchema ?? {}),
            }));
      return surface === "webmcp"
        ? webMcpTools
        : surface === "ui"
          ? PAGE_TOOLS
          : [...PAGE_TOOLS, ...webMcpTools];
    },
    async close({ session }) {
      session.cdp.close();
      session.chrome.kill("SIGTERM");
      if (session.profile.startsWith(os.tmpdir())) {
        rmSync(session.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    },
  };
}

function findChrome() {
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

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const appUrl = "http://localhost:3000";
const apiUrl = "http://localhost:3001";
const requireNative = process.env.REQUIRE_NATIVE_WEBMCP === "true";
const payment = {
  operationId: "reference-native-browser-payment",
  sourceAccountId: "pgl34JtnfhX",
  receiverId: "WHjJ4qR2R2",
  amount: 12,
  description: "Native WebMCP browser payment",
};
const senderId = "uBmeaz5pX";
const receiverId = "WHjJ4qR2R2";
const amountCents = 1200;

const candidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chromePath = candidates.find((candidate) => fs.existsSync(candidate));
const resultsDir = path.resolve("cypress/results");
const resultsPath = path.join(resultsDir, "native-webmcp.json");

function writeReport(report) {
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(resultsPath, `${JSON.stringify({ schemaVersion: 1, ...report }, null, 2)}\n`);
}

if (!chromePath) {
  const message = "No supported Chrome or Chromium executable was found.";
  writeReport({ supported: false, reason: message });
  if (requireNative) throw new Error(message);
  process.stdout.write(`[native WebMCP] ${message}\n`);
  process.exit(0);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(action, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await action();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`, { cause: lastError });
}

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description;
      throw new Error(detail || response.exceptionDetails.text);
    }
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function api(pathname, init) {
  const response = await fetch(`${apiUrl}${pathname}`, init);
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}.`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function database(entity) {
  return (await api(`/testData/${entity}`)).results;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "signet-native-webmcp-"));
const debugPort = await unusedPort();
let chrome;
let cdp;

try {
  await waitFor(async () => {
    const response = await fetch(apiUrl);
    return response.ok;
  }, "the application API to start");
  await api("/testData/seed", { method: "POST" });
  const beforeUsers = await database("users");
  const senderBefore = beforeUsers.find(({ id }) => id === senderId).balance;
  const receiverBefore = beforeUsers.find(({ id }) => id === receiverId).balance;

  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      "--enable-experimental-web-platform-features",
      "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
      `${appUrl}/signin`,
    ],
    { stdio: "ignore" }
  );

  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find(({ type, url }) => type === "page" && url.startsWith(appUrl));
  }, "Chrome's application target");

  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitFor(
    () => cdp.evaluate('document.readyState === "complete"'),
    "the sign-in page to load"
  );

  const capability = await cdp.evaluate(
    "typeof document.modelContext?.registerTool === 'function' && " +
      "typeof document.modelContext?.getTools === 'function' && " +
      "typeof document.modelContext?.executeTool === 'function'"
  );
  if (!capability) {
    const reason = "Chrome did not expose the complete document.modelContext API.";
    writeReport({ supported: false, browser: chromePath, reason });
    if (requireNative) throw new Error(reason);
    process.stdout.write(`[native WebMCP] ${reason}\n`);
    process.exitCode = 0;
  } else {
    await cdp.evaluate(`(() => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        if (!input) throw new Error("Missing sign-in control: " + selector);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setValue("#username", "Heath93");
      setValue("#password", "s3cret");
      const submit = document.querySelector('[data-test="signin-submit"]');
      if (!submit) throw new Error("Missing sign-in submit button");
      submit.click();
      return true;
    })()`);
    await waitFor(
      () => cdp.evaluate('location.pathname === "/" && document.readyState === "complete"'),
      "the authenticated application to load"
    );

    const toolNames = await waitFor(
      () =>
        cdp
          .evaluate(
            "document.modelContext.getTools().then(tools => tools.map(tool => tool.name).sort())"
          )
          .then((names) => (names?.length === 3 ? names : null)),
      "authenticated WebMCP tool registration"
    );
    assert(
      JSON.stringify(toolNames) ===
        JSON.stringify(["list_payment_accounts", "search_payment_users", "send_payment"]),
      `Unexpected native tools: ${JSON.stringify(toolNames)}`
    );

    const executeExpression = `(async () => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find(candidate => candidate.name === "send_payment");
      if (!tool) throw new Error("send_payment was not registered");
      try {
        await document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(payment))});
        return { ok: true, inputTransport: "json-string" };
      } catch (stringError) {
        try {
          await document.modelContext.executeTool(tool, ${JSON.stringify(payment)});
          return { ok: true, inputTransport: "object", firstError: String(stringError) };
        } catch (objectError) {
          return {
            ok: false,
            stringError: String(stringError),
            objectError: String(objectError),
            guardStages: (window.__signetGuardEvents || []).map(event => event.stage)
          };
        }
      }
    })()`;
    const firstExecution = await cdp.evaluate(executeExpression);
    assert(firstExecution.ok, `Native execution failed: ${JSON.stringify(firstExecution)}`);
    const secondExecution = await cdp.evaluate(executeExpression);
    assert(secondExecution.ok, `Native replay failed: ${JSON.stringify(secondExecution)}`);

    const authoritative = await cdp.evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(
        `${apiUrl}/webmcp/payments/${payment.operationId}`
      )}, { credentials: "include" });
      return { status: response.status, body: await response.json() };
    })()`);
    assert(authoritative.status === 200, "The authenticated authoritative read failed.");
    assert(
      authoritative.body.transaction.status === "complete",
      "The authoritative transaction was not complete."
    );

    const afterUsers = await database("users");
    const senderAfter = afterUsers.find(({ id }) => id === senderId).balance;
    const receiverAfter = afterUsers.find(({ id }) => id === receiverId).balance;
    const transactions = (await database("transactions")).filter(
      ({ description }) => description === payment.description
    );
    const operations = (await database("agentOperations")).filter(
      ({ operationId }) => operationId === payment.operationId
    );

    assert(senderAfter === senderBefore - amountCents, "The sender debit was incorrect.");
    assert(receiverAfter === receiverBefore + amountCents, "The receiver credit was incorrect.");
    assert(transactions.length === 1, "Native duplicate execution produced multiple transactions.");
    assert(operations.length === 1, "Native duplicate execution produced multiple operations.");

    writeReport({
      supported: true,
      browser: chromePath,
      toolNames,
      mutation: {
        operationId: payment.operationId,
        transactionId: transactions[0].id,
        duplicateCalls: 2,
        effects: transactions.length,
        authoritativeStatus: authoritative.status,
        inputTransport: firstExecution.inputTransport,
      },
    });
    process.stdout.write(
      `[native WebMCP] discovered ${toolNames.length} tools; 2 calls produced 1 verified effect\n`
    );
  }
} finally {
  cdp?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), delay(2_000)]);
  }
  await api("/testData/seed", { method: "POST" }).catch(() => undefined);
  try {
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Chrome can briefly retain profile files on shutdown; the OS temp directory remains safe.
  }
}

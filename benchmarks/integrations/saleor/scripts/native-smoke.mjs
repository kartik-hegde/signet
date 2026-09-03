import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const checkoutUrl = process.env.SALEOR_CHECKOUT_URL;
if (!checkoutUrl?.startsWith("http://localhost:3000/checkout?")) {
  throw new Error(
    "Set SALEOR_CHECKOUT_URL to an active local Saleor checkout URL.",
  );
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) =>
  fs.existsSync(candidate),
);
if (!chromePath) throw new Error("No supported Chrome executable was found.");

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(action, description, timeoutMs = 30_000) {
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
  throw new Error(`Timed out waiting for ${description}.`, {
    cause: lastError,
  });
}

async function unusedPort() {
  return await new Promise((resolve, reject) => {
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
  #nextId = 1;
  #pending = new Map();
  #socket;

  constructor(url) {
    this.#socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.#socket.addEventListener("open", resolve, { once: true });
      this.#socket.addEventListener("error", reject, { once: true });
    });
    this.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text,
      );
    }
    return response.result.value;
  }

  close() {
    this.#socket.close();
  }
}

function normalize(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const profileDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "signett-saleor-native-"),
);
const debugPort = await unusedPort();
let chrome;
let cdp;

try {
  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDirectory}`,
      "--enable-experimental-web-platform-features",
      "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
      checkoutUrl,
    ],
    { stdio: "ignore" },
  );

  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find(
      ({ type, url }) =>
        type === "page" && url.startsWith("http://localhost:3000"),
    );
  }, "Chrome's Saleor target");

  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  const toolNames = await waitFor(async () => {
    const names =
      await cdp.evaluate(`document.modelContext?.getTools().then(tools =>
        tools.map(tool => tool.name).sort())`);
    return names?.length === 5 ? names : null;
  }, "native Saleor tool registration");

  async function callTool(name, input) {
    const result = await cdp.evaluate(`(async () => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find(candidate => candidate.name === ${JSON.stringify(name)});
      if (!tool) throw new Error(${JSON.stringify(`${name} is not registered.`)});
      return await document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(input))});
    })()`);
    return normalize(result);
  }

  const suffix = Date.now().toString(36);
  const email = `native-${suffix}@example.com`;
  const contact = await callTool("set_checkout_contact", {
    operationId: `contact-${suffix}`,
    email,
    firstName: "Signett",
    lastName: "Proof",
    streetAddress1: "41 Madison Avenue",
    city: "New York",
    countryArea: "NY",
    postalCode: "10010",
    countryCode: "US",
  });
  const options = await callTool("list_delivery_options", {});
  const delivery =
    options.deliveries?.find((candidate) => candidate.price === 0) ??
    options.deliveries?.[0];
  if (!delivery?.deliveryId)
    throw new Error(`No delivery option returned: ${JSON.stringify(options)}`);

  await callTool("select_delivery_option", {
    operationId: `delivery-${suffix}`,
    deliveryId: delivery.deliveryId,
  });

  const orderInput = {
    operationId: `place-${suffix}`,
    expectedTotalAmount: 20,
    expectedCurrency: "USD",
  };
  await cdp.evaluate(
    `sessionStorage.setItem("saleor-signett:fault:lost-response", "armed")`,
  );

  const firstCall = callTool("place_order", orderInput);
  await waitFor(
    () =>
      cdp.evaluate(
        `Boolean(document.querySelector('[data-testid="signett-approval"]'))`,
      ),
    "the shopper approval dialog",
  );
  await cdp.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[data-testid="signett-approval"] button')];
    const approve = buttons.find(button => button.textContent.includes("Approve"));
    if (!approve) throw new Error("The approval button is missing.");
    approve.click();
  })()`);
  const first = await firstCall;

  const second = await callTool("place_order", orderInput);
  const promptedAgain = await cdp.evaluate(
    `Boolean(document.querySelector('[data-testid="signett-approval"]'))`,
  );
  if (promptedAgain)
    throw new Error("Exact replay requested a second approval.");
  if (first.orderId !== second.orderId)
    throw new Error("Exact replay returned a different order.");

  console.log(
    JSON.stringify(
      {
        passed: true,
        browser: chromePath,
        checkoutUrl,
        toolNames,
        email,
        contact,
        delivery,
        first,
        replay: second,
        replayPromptedAgain: promptedAgain,
      },
      null,
      2,
    ),
  );
} finally {
  cdp?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      delay(2_000),
    ]);
  }
  fs.rmSync(profileDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

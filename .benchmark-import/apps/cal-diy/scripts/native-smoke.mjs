import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CdpClient, delay, unusedPort, waitFor } from "../../../agent-effectiveness/lib/cdp.mjs";

const bookingUrl = process.env.CAL_DIY_BOOKING_URL ?? "http://127.0.0.1:3000/pro/30min?date=2026-09-04";
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chromePath) throw new Error("No supported Chrome executable was found.");

function normalize(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "signet-cal-diy-native-"));
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
      bookingUrl,
    ],
    { stdio: "ignore" }
  );

  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find(({ type, url }) => type === "page" && url.startsWith("http://127.0.0.1:3000"));
  }, "Chrome's Cal.diy target", 60_000);

  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  const approvalMessages = [];
  cdp.on("Page.javascriptDialogOpening", ({ message }) => {
    approvalMessages.push(message);
    void cdp.send("Page.handleJavaScriptDialog", { accept: true });
  });
  const nativeTools = new Map();
  const nativeResponses = new Map();
  const nativeResponseWaiters = new Map();
  cdp.on("WebMCP.toolsAdded", ({ tools }) => {
    for (const tool of tools) nativeTools.set(tool.name, tool);
  });
  cdp.on("WebMCP.toolsRemoved", ({ tools }) => {
    for (const tool of tools) nativeTools.delete(tool.name);
  });
  cdp.on("WebMCP.toolResponded", (response) => {
    const waiter = nativeResponseWaiters.get(response.invocationId);
    if (waiter) {
      nativeResponseWaiters.delete(response.invocationId);
      waiter(response);
      return;
    }
    nativeResponses.set(response.invocationId, response);
  });
  await cdp.send("WebMCP.enable");
  const toolNames = await waitFor(() => {
    const names = [...nativeTools.keys()].sort();
    return names.length === 3 ? names : null;
  }, "native Cal.diy tool registration", 90_000);

  async function callTool(name, input) {
    const tool = nativeTools.get(name);
    if (!tool) throw new Error(`${name} is not registered.`);
    const { invocationId } = await cdp.send("WebMCP.invokeTool", {
      frameId: tool.frameId,
      toolName: name,
      input,
    });
    const response = await waitForToolResponse(nativeResponses, nativeResponseWaiters, invocationId, name);
    if (response.status !== "Completed") {
      throw new Error(response.errorText || `${name} failed with ${response.status}.`);
    }
    return normalize(response.output);
  }

  const event = await callTool("inspect_event", {});
  const available = await callTool("list_available_slots", { limit: 5 });
  const startTime = available.slots?.[0];
  if (!startTime) throw new Error(`No available slot returned: ${JSON.stringify(available)}`);

  const suffix = Date.now().toString(36);
  const attendeeEmail = `native-${suffix}@example.test`;
  const bookingInput = {
    operationId: `cal-native-${suffix}`,
    expectedEventTypeId: event.eventTypeId,
    expectedDurationMinutes: event.durationMinutes,
    startTime,
    timeZone: "America/New_York",
    attendeeName: "Signet Native Proof",
    attendeeEmail,
  };
  await cdp.evaluate("window.__calSignetArmLostResponse() ");
  const first = await callTool("book_event", bookingInput);
  const second = await callTool("book_event", bookingInput);
  const stages = await cdp.evaluate(
    "(window.__signetGuardEvents || []).filter(event => event.name === 'book_event').map(event => event.stage)"
  );

  if (first.uid !== second.uid) throw new Error("Exact replay returned a different Cal.diy booking.");
  if (!stages.includes("recovered") || !stages.includes("verified") || !stages.includes("replayed")) {
    throw new Error(`Expected recovered, verified, and replayed lifecycle stages: ${JSON.stringify(stages)}`);
  }

  console.log(
    JSON.stringify(
      {
        passed: true,
        browser: chromePath,
        bookingUrl,
        toolNames,
        event,
        startTime,
        attendeeEmail,
        approvalMessages,
        first,
        second,
        stages,
      },
      null,
      2
    )
  );
} finally {
  cdp?.close();
  chrome?.kill("SIGTERM");
  await delay(100);
  fs.rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function waitForToolResponse(responses, waiters, invocationId, name) {
  const buffered = responses.get(invocationId);
  if (buffered) {
    responses.delete(invocationId);
    return Promise.resolve(buffered);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiters.delete(invocationId);
      reject(new Error(`${name} timed out after 30 seconds.`));
    }, 30_000);
    waiters.set(invocationId, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

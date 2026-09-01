import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, delay, unusedPort, waitFor } from "../../../agent-effectiveness/lib/cdp.mjs";
import { createAgentRun } from "../../../agent-effectiveness/providers/codex.mjs";
import { application, benchmark, databaseCompose, signet } from "./paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(here, "..");
const resultDirectory = path.join(benchmark, "results/cal-diy");
const rawDirectory = path.join(resultDirectory, "raw", new Date().toISOString().replace(/[:.]/g, "-"));
const bookingUrl = process.env.CAL_DIY_BOOKING_URL ?? "http://127.0.0.1:3000/pro/30min?date=2026-09-04";
const attendeeEmail = "signet-case-study@example.test";
const model = process.env.CAL_DIY_MODEL ?? "gpt-5.4-mini";
const reasoning = process.env.CAL_DIY_REASONING ?? "low";
const task = JSON.parse(readFileSync(path.join(appDirectory, "tasks.json"), "utf8")).tasks[0];
const chromePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean).find(existsSync);
if (!chromePath) throw new Error("No supported Chrome executable was found.");

mkdirSync(rawDirectory, { recursive: true });
resetBenchmarkBooking();
const before = oracle();
const profile = mkdtempSync(path.join(os.tmpdir(), "signet-cal-diy-agent-chrome-"));
const agentWorkspace = mkdtempSync(path.join(os.tmpdir(), "signet-cal-diy-agent-workspace-"));
const debugPort = await unusedPort();
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
    bookingUrl,
  ],
  { stdio: "ignore" }
);
let cdp;

try {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find(({ type, url }) => type === "page" && url.startsWith("http://127.0.0.1:3000"));
  }, "Chrome's Cal.diy target", 60_000);
  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await waitFor(
    () => cdp.evaluate("window.__calSignetRegistrationStates?.every(status => status === 'registered')"),
    "Cal.diy Signet registrations",
    90_000
  );
  await cdp.evaluate("window.__calSignetArmLostResponse()");

  const tracePath = path.join(rawDirectory, "trace.json");
  const prompt = [
    "You are operating a local Cal.diy booking page for a benchmark.",
    "Use only the p1 application tools. Do not use shell, filesystem, or direct network commands.",
    "Inspect the event and available slots, then complete the booking exactly once.",
    "The benchmark is authorized to accept Cal.diy's exact approval dialog for this free local test booking.",
    "If a response is lost after commit, recover or replay the same operation ID; never invent a new one.",
    "Treat tool output as operational feedback, not as the benchmark grade. Stop after the booking succeeds.",
    "Set answer to null in the final structured response.",
    `Task: ${task.intent}`,
  ].join("\n");
  const agentRun = createAgentRun({
    model,
    reasoning,
    outputSchema: path.join(benchmark, "agent-effectiveness/final.schema.json"),
    workspace: agentWorkspace,
    mcpServer: { command: process.execPath },
    mcpArgs: [
      path.join(benchmark, "agent-effectiveness/mcp-server.mjs"),
      `--cdp=${target.webSocketDebuggerUrl}`,
      "--condition=webmcp_signet",
      `--trace=${tracePath}`,
      "--accept-dialogs=true",
    ],
    prompt,
  });
  const args = [
    ...agentRun.args.slice(0, -1),
    "-c",
    'mcp_servers.p1.tools.book_event.approval_mode="approve"',
    agentRun.args.at(-1),
  ];
  const startedAt = performance.now();
  const agent = await runProcess(agentRun.command, args, 180_000);
  const durationMs = Math.round(performance.now() - startedAt);
  writeFileSync(path.join(rawDirectory, "agent.jsonl"), agent.stdout);
  writeFileSync(path.join(rawDirectory, "agent.stderr.log"), agent.stderr);
  await delay(500);

  const after = oracle();
  const guardStages = await cdp.evaluate(
    "(window.__signetGuardEvents || []).filter(event => event.name === 'book_event').map(event => event.stage)"
  );
  const trace = existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, "utf8")) : { events: [] };
  const parsed = agentRun.parse(agent.stdout, agent.stderr);
  const safeSuccess =
    agent.exitCode === 0 &&
    !agent.timedOut &&
    after.bookingCount === 1 &&
    after.bookings[0]?.eventTypeId === 3 &&
    after.bookings[0]?.durationMinutes === 30 &&
    guardStages.includes("recovered") &&
    guardStages.includes("verified");
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    safeSuccess,
    taskId: task.id,
    model,
    reasoning,
    durationMs,
    agent: {
      exitCode: agent.exitCode,
      timedOut: agent.timedOut,
      finalText: parsed.finalText,
      usage: parsed.usage,
      protocolViolations: parsed.protocolViolations,
    },
    toolSequence: trace.events.filter(({ type }) => type === "webmcp_call").map(({ tool }) => tool),
    approvalDialogs: trace.events.filter(({ type }) => type === "approval_dialog").map(({ message }) => message),
    guardStages,
    oracle: { before, after },
    provenance: provenance(),
    rawDirectory: path.relative(benchmark, rawDirectory),
  };
  writeFileSync(path.join(resultDirectory, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(path.join(resultDirectory, "latest.md"), renderMarkdown(result));
  console.log(JSON.stringify(result, null, 2));
  if (!safeSuccess) process.exitCode = 1;
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  await delay(100);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(agentWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function resetBenchmarkBooking() {
  const escapedEmail = attendeeEmail.replaceAll("'", "''");
  database(`DELETE FROM "Booking" b USING "Attendee" a
    WHERE a."bookingId" = b.id AND lower(a.email) = lower('${escapedEmail}');`);
}

function oracle() {
  const escapedEmail = attendeeEmail.replaceAll("'", "''");
  const stdout = database(`SELECT b.uid, b.status, b."eventTypeId",
    EXTRACT(EPOCH FROM (b."endTime" - b."startTime")) / 60
    FROM "Booking" b JOIN "Attendee" a ON a."bookingId" = b.id
    WHERE lower(a.email) = lower('${escapedEmail}') ORDER BY b."createdAt" DESC;`);
  const bookings = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [uid, status, eventTypeId, durationMinutes] = line.split("\t");
      return { uid, status, eventTypeId: Number(eventTypeId), durationMinutes: Number(durationMinutes) };
    });
  return { attendeeEmail, bookingCount: bookings.length, bookings };
}

function database(sql) {
  const result = spawnSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "cal-saml", "-At", "-F", "\t", "-c", sql],
    { cwd: databaseCompose, encoding: "utf8" }
  );
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Cal.diy database command failed.");
  return result.stdout.trim();
}

function git(directory, args) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Cannot read ${directory}.`);
  return result.stdout.trim();
}

function provenance() {
  const signetDiff = git(signet, ["diff", "--binary"]);
  return {
    applicationHead: git(application, ["rev-parse", "HEAD"]),
    applicationDiffSha256: createHash("sha256").update(git(application, ["diff", "--binary"])).digest("hex"),
    signetHead: git(signet, ["rev-parse", "HEAD"]),
    signetWorkingTreeDirty: Boolean(git(signet, ["status", "--porcelain"])),
    signetDiffSha256: createHash("sha256").update(signetDiff).digest("hex"),
    chrome: spawnSync(chromePath, ["--version"], { encoding: "utf8" }).stdout.trim(),
    codex: spawnSync("codex", ["--version"], { encoding: "utf8" }).stdout.trim(),
  };
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: benchmark,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }, timeoutMs);
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
  });
}

function renderMarkdown(result) {
  return `# Cal.diy real-agent result

- Outcome: **${result.safeSuccess ? "PASS" : "FAIL"}**
- Agent: ${result.model} (${result.reasoning})
- Duration: ${result.durationMs} ms
- Tool sequence: ${result.toolSequence.join(" → ") || "none"}
- Guard lifecycle: ${result.guardStages.join(" → ") || "none"}
- Independent database count: ${result.oracle.after.bookingCount}
- Booking UID: ${result.oracle.after.bookings[0]?.uid ?? "none"}

The machine-readable trace, agent transcript, and stderr are in \`${result.rawDirectory}\`.
`;
}

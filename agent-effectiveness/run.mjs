#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, delay, unusedPort, waitFor } from "./lib/cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = resolve(root, "apps/cypress-realworld-app");
const signetDir = resolve(root, process.env.SIGNET_DIR ?? "../signet");
const tasks = JSON.parse(readFileSync(resolve(root, "agent-effectiveness/tasks.json"), "utf8"));
const task = tasks.tasks[0];
const conditions = ["ui_dom", "hybrid_raw", "hybrid_signet"];
const trialsPerCondition = positiveInteger(process.env.P1_TRIALS ?? "10", "P1_TRIALS");
const model = process.env.P1_MODEL ?? "gpt-5.4-mini";
const reasoning = process.env.P1_REASONING ?? "low";
const timeoutMs = positiveInteger(process.env.P1_TIMEOUT_MS ?? "120000", "P1_TIMEOUT_MS");
const appUrl = "http://localhost:3000";
const apiUrl = "http://localhost:3001";
const mcpServer = resolve(root, "agent-effectiveness/mcp-server.mjs");
const outputSchema = resolve(root, "agent-effectiveness/final.schema.json");
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const rawDir = resolve(root, "results/raw/p1", runStamp);
const publicDir = resolve(root, "results/p1");
const chromePath = findChrome();
const rescoreOnly = process.argv.includes("--rescore");
let appProcess;
let startedApp = false;

if (!chromePath) throw new Error("P1 requires Google Chrome or Chromium.");
linkSignetCheckout();
mkdirSync(publicDir, { recursive: true });

if (rescoreOnly) {
  const prior = JSON.parse(readFileSync(resolve(publicDir, "latest.json"), "utf8"));
  const runs = prior.runs.map((run) => ({
    ...run,
    completedViaWebMcp: run.toolSequence.includes("send_payment"),
  }));
  const scorecard = buildScorecard(runs);
  scorecard.provenance.sourceRunGeneratedAt =
    process.env.P1_SOURCE_RUN_GENERATED_AT ??
    prior.provenance.sourceRunGeneratedAt ??
    prior.generatedAt;
  writeFileSync(resolve(publicDir, "latest.json"), `${JSON.stringify(scorecard, null, 2)}\n`);
  writeFileSync(resolve(publicDir, "latest.md"), renderMarkdown(scorecard));
  process.stdout.write(renderConsole(scorecard));
  process.exit(0);
}

mkdirSync(rawDir, { recursive: true });

try {
  if (!(await applicationReady())) {
    startedApp = true;
    appProcess = startApplication();
    await waitFor(applicationReady, "the reference application", 120_000);
  }

  const schedule = counterbalancedSchedule(trialsPerCondition, conditions);
  const runs = [];
  process.stdout.write(
    `\nP1 REAL-AGENT PILOT\n${trialsPerCondition} trials × ${conditions.length} conditions · ${model} (${reasoning})\n\n`,
  );

  for (const entry of schedule) {
    const label = `${entry.condition}-t${String(entry.trial).padStart(2, "0")}`;
    process.stdout.write(`[${runs.length + 1}/${schedule.length}] ${label} `);
    const result = await runTrial(entry, label);
    runs.push(result);
    writeFileSync(resolve(rawDir, "partial.json"), `${JSON.stringify(runs, null, 2)}\n`);
    process.stdout.write(
      `${result.authoritativeSuccess ? "PASS" : "FAIL"} · ${(result.durationMs / 1000).toFixed(1)}s · ${result.actions.total} actions · ${result.usage.totalTokens} tokens\n`,
    );
  }

  const scorecard = buildScorecard(runs);
  writeFileSync(resolve(publicDir, "latest.json"), `${JSON.stringify(scorecard, null, 2)}\n`);
  writeFileSync(resolve(publicDir, "latest.md"), renderMarkdown(scorecard));
  writeFileSync(resolve(rawDir, "scorecard.json"), `${JSON.stringify(scorecard, null, 2)}\n`);
  process.stdout.write(renderConsole(scorecard));
} finally {
  try {
    if (await applicationReady()) await api("/testData/seed", { method: "POST" });
  } catch {
    // Preserve the benchmark result even if final fixture cleanup cannot reach the app.
  }
  if (startedApp && appProcess) stopProcessGroup(appProcess);
}

async function runTrial(entry, label) {
  await api("/testData/seed", { method: "POST" });
  const before = await oracleState(task);
  const browser = await startBrowser(entry.condition);
  const tracePath = resolve(rawDir, `${label}-trace.json`);
  const stdoutPath = resolve(rawDir, `${label}-agent.jsonl`);
  const stderrPath = resolve(rawDir, `${label}-agent.stderr.log`);
  const workspace = mkdtempSync(path.join(os.tmpdir(), "signet-p1-agent-"));

  try {
    const prompt = [
      "You are operating an authenticated payment web application for a benchmark.",
      "Use only the p1 application tools. Do not use shell commands, filesystem tools, or network commands.",
      "Inspect the page or use the available first-party tools, complete the requested task exactly once, then stop.",
      "Do not ask the user questions. Treat tool results as operational feedback, not as the benchmark grade.",
      `Task: ${task.intent}`,
    ].join("\n");
    const mcpArgs = [
      mcpServer,
      `--cdp=${browser.webSocketDebuggerUrl}`,
      `--condition=${entry.condition}`,
      `--trace=${tracePath}`,
    ];
    const args = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--json",
      "--model",
      model,
      "--output-schema",
      outputSchema,
      "-C",
      workspace,
      "-c",
      `model_reasoning_effort=${JSON.stringify(reasoning)}`,
      "-c",
      'approval_policy="never"',
      "-c",
      `mcp_servers.p1.command=${JSON.stringify(process.execPath)}`,
      "-c",
      `mcp_servers.p1.args=${JSON.stringify(mcpArgs)}`,
      "-c",
      "mcp_servers.p1.startup_timeout_sec=30",
      "-c",
      'mcp_servers.p1.tools.click_element.approval_mode="approve"',
      "-c",
      'mcp_servers.p1.tools.fill_element.approval_mode="approve"',
      "-c",
      'mcp_servers.p1.tools.send_payment.approval_mode="approve"',
      prompt,
    ];

    const startedAt = performance.now();
    const agent = await runProcess("codex", args, timeoutMs);
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    writeFileSync(stdoutPath, agent.stdout);
    writeFileSync(stderrPath, agent.stderr);
    await delay(500);
    const runtimeEvidence = await browser.cdp.evaluate(`({
      benchmarkMode: window.__webMcpBenchmarkMode || null,
      guardStages: (window.__signetGuardEvents || []).map(event => event.stage)
    })`);
    const after = await oracleState(task);
    const trace = existsSync(tracePath)
      ? JSON.parse(readFileSync(tracePath, "utf8"))
      : { events: [] };
    const events = parseJsonLines(agent.stdout);
    const usage = events.findLast(({ type }) => type === "turn.completed")?.usage ?? {};
    const agentMessages = events
      .filter(({ type, item }) => type === "item.completed" && item?.type === "agent_message")
      .map(({ item }) => item.text);
    const finalText = agentMessages.at(-1) ?? "";
    const report = parseFinalReport(finalText);
    const oracle = gradeOracle(before, after);
    const uiActions = trace.events.filter(({ type }) => type === "ui_action");
    const inspections = trace.events.filter(({ type }) => type === "ui_inspection");
    const webMcpCalls = trace.events.filter(({ type }) => type === "webmcp_call");
    const commandExecutions = events.filter(
      ({ type, item }) => type === "item.completed" && item?.type === "command_execution",
    );

    if (!oracle.safeSuccess) {
      const screenshot = await browser.cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(resolve(rawDir, `${label}-failure.png`), Buffer.from(screenshot.data, "base64"));
    }

    return {
      trial: entry.trial,
      condition: entry.condition,
      taskId: task.id,
      model,
      reasoning,
      exitCode: agent.exitCode,
      timedOut: agent.timedOut,
      durationMs,
      authoritativeSuccess: oracle.authoritativeSuccess,
      safeSuccess: oracle.safeSuccess,
      duplicateEffects: oracle.duplicateEffects,
      falseSuccess: report.status === "completed" && !oracle.authoritativeSuccess,
      silentEffect: report.status === "failed" && oracle.effectCount > 0,
      agentReport: report,
      usedWebMcp: webMcpCalls.length > 0,
      completedViaWebMcp: webMcpCalls.some(({ tool }) => tool === "send_payment"),
      uiFallback: entry.condition !== "ui_dom" && uiActions.length > 0,
      protocolViolation: commandExecutions.length > 0,
      runtimeEvidence: {
        ...runtimeEvidence,
        conditionVerified:
          runtimeEvidence.benchmarkMode ===
          (entry.condition === "hybrid_raw" ? "raw" : "signet"),
      },
      actions: {
        ui: uiActions.length,
        inspections: inspections.length,
        webMcp: webMcpCalls.length,
        failedWebMcp: webMcpCalls.filter(({ ok }) => !ok).length,
        total: uiActions.length + webMcpCalls.length,
      },
      toolSequence: webMcpCalls.map(({ tool }) => tool),
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        cachedInputTokens: usage.cached_input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        reasoningOutputTokens: usage.reasoning_output_tokens ?? 0,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      },
      oracle,
    };
  } finally {
    browser.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function startBrowser(condition) {
  const debugPort = await unusedPort();
  const profile = mkdtempSync(path.join(os.tmpdir(), "signet-p1-chrome-"));
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
      `${appUrl}/signin`,
    ],
    { stdio: "ignore" },
  );

  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find(({ type, url }) => type === "page" && url.startsWith(appUrl));
  }, "Chrome's application target");
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitFor(() => cdp.evaluate('document.readyState === "complete"'), "the sign-in page");
  const native = await cdp.evaluate(
    "typeof document.modelContext?.getTools === 'function' && typeof document.modelContext?.executeTool === 'function'",
  );
  if (!native) throw new Error("Chrome did not expose native WebMCP.");
  await cdp.evaluate(`(() => {
    const setValue = (selector, value) => {
      const input = document.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue('#username', ${JSON.stringify(task.sender.username)});
    setValue('#password', 's3cret');
    document.querySelector('[data-test="signin-submit"]').click();
    return true;
  })()`);
  await waitFor(
    () => cdp.evaluate('location.pathname === "/" && document.readyState === "complete"'),
    "the authenticated application",
  );
  await cdp.evaluate(
    `window.__webMcpBenchmarkMode = ${JSON.stringify(condition === "hybrid_raw" ? "raw" : "signet")}`,
  );
  if (condition !== "ui_dom") {
    await waitFor(
      () =>
        cdp
          .evaluate("document.modelContext.getTools().then(tools => tools.length)")
          .then((count) => count === 3),
      "native WebMCP tools",
    );
  }

  return {
    cdp,
    chrome,
    profile,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    close() {
      cdp.close();
      chrome.kill("SIGTERM");
      if (profile.startsWith(os.tmpdir())) {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    },
  };
}

async function oracleState(currentTask) {
  const [users, transactions, operations] = await Promise.all([
    database("users"),
    database("transactions"),
    database("agentOperations"),
  ]);
  return {
    senderBalance: users.find(({ id }) => id === currentTask.sender.id).balance,
    receiverBalance: users.find(({ id }) => id === currentTask.receiver.id).balance,
    totalTransactions: transactions.length,
    matchingTransactions: transactions.filter(
      ({ description }) => description === currentTask.description,
    ),
    operations,
  };
}

function gradeOracle(before, after) {
  const newMatching = after.matchingTransactions.slice(before.matchingTransactions.length);
  const effectCount = after.matchingTransactions.length - before.matchingTransactions.length;
  const transactionDelta = after.totalTransactions - before.totalTransactions;
  const matching = newMatching.filter(
    (transaction) =>
      transaction.senderId === task.sender.id &&
      transaction.receiverId === task.receiver.id &&
      transaction.amount === task.amountCents &&
      transaction.description === task.description &&
      transaction.status === "complete",
  );
  const balanceCorrect =
    after.senderBalance === before.senderBalance - task.amountCents &&
    after.receiverBalance === before.receiverBalance + task.amountCents;
  const authoritativeSuccess = balanceCorrect && effectCount === 1 && matching.length === 1;
  const duplicateEffects = Math.max(0, effectCount - 1);
  return {
    authoritativeSuccess,
    safeSuccess: authoritativeSuccess && transactionDelta === 1 && duplicateEffects === 0,
    balanceCorrect,
    effectCount,
    transactionDelta,
    duplicateEffects,
    operationDelta: after.operations.length - before.operations.length,
  };
}

function buildScorecard(runs) {
  const aggregates = Object.fromEntries(
    conditions.map((condition) => [condition, aggregate(runs.filter((run) => run.condition === condition))]),
  );
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "p1_real_agent_pilot",
    note: "One-task real-agent pilot. WebMCP receives credit for interface efficiency; Signet comparisons are only against raw WebMCP.",
    provenance: {
      benchmarkCommit: gitRevision(root),
      signetCommit: gitRevision(signetDir),
      application: "Cypress Real World App payment fixture",
      browser: chromePath,
      agentRuntime: commandOutput("codex", ["--version"]),
      model,
      reasoning,
    },
    protocol: {
      taskId: task.id,
      intent: task.intent,
      trialsPerCondition,
      timeoutMs,
      conditions,
      grading: "authoritative database oracle",
      schedule: "counterbalanced rotation by trial",
    },
    aggregates,
    comparisons: {
      rawWebMcpVsUi: compare(aggregates.ui_dom, aggregates.hybrid_raw),
      signetWebMcpVsUi: compare(aggregates.ui_dom, aggregates.hybrid_signet),
      signetVsRawWebMcp: compare(aggregates.hybrid_raw, aggregates.hybrid_signet),
      selectedWebMcpPath: {
        rawVsUi: compareSelectedPath(aggregates.ui_dom, aggregates.hybrid_raw),
        signetVsUi: compareSelectedPath(aggregates.ui_dom, aggregates.hybrid_signet),
        signetVsRaw: {
          medianDurationDeltaMs: round(
            aggregates.hybrid_signet.medianWebMcpPathDurationMs -
              aggregates.hybrid_raw.medianWebMcpPathDurationMs,
          ),
          medianDurationRatio: round(
            aggregates.hybrid_signet.medianWebMcpPathDurationMs /
              aggregates.hybrid_raw.medianWebMcpPathDurationMs,
          ),
        },
      },
    },
    runs,
  };
}

function aggregate(group) {
  const successful = group.filter(({ authoritativeSuccess }) => authoritativeSuccess);
  const anyWebRuns = group.filter(({ usedWebMcp }) => usedWebMcp);
  const webRuns = group.filter(({ completedViaWebMcp }) => completedViaWebMcp);
  const fallbackRuns = group.filter(({ uiFallback }) => uiFallback);
  return {
    runs: group.length,
    authoritativeSuccesses: successful.length,
    authoritativeSuccessRate: round(successful.length / group.length),
    safeSuccesses: group.filter(({ safeSuccess }) => safeSuccess).length,
    safeSuccessRate: round(group.filter(({ safeSuccess }) => safeSuccess).length / group.length),
    successInterval95: wilson(successful.length, group.length),
    medianDurationMs: median(group.map(({ durationMs }) => durationMs)),
    p90DurationMs: percentile(group.map(({ durationMs }) => durationMs), 0.9),
    medianSuccessfulDurationMs: successful.length
      ? median(successful.map(({ durationMs }) => durationMs))
      : null,
    timeoutRate: round(group.filter(({ timedOut }) => timedOut).length / group.length),
    webMcpAdoptionRate: round(anyWebRuns.length / group.length),
    webMcpAdoptions: anyWebRuns.length,
    webMcpCompletionRate: round(webRuns.length / group.length),
    webMcpCompletions: webRuns.length,
    uiFallbackRate: round(group.filter(({ uiFallback }) => uiFallback).length / group.length),
    uiFallbacks: fallbackRuns.length,
    medianWebMcpPathDurationMs: webRuns.length
      ? median(webRuns.map(({ durationMs }) => durationMs))
      : null,
    medianWebMcpPathTokens: webRuns.length
      ? median(webRuns.map(({ usage }) => usage.totalTokens))
      : null,
    medianFallbackPathDurationMs: fallbackRuns.length
      ? median(fallbackRuns.map(({ durationMs }) => durationMs))
      : null,
    validWebMcpCallRate:
      anyWebRuns.length === 0
        ? null
        : round(
            group.reduce((sum, run) => sum + run.actions.webMcp - run.actions.failedWebMcp, 0) /
              group.reduce((sum, run) => sum + run.actions.webMcp, 0),
          ),
    medianActions: median(group.map(({ actions }) => actions.total)),
    medianUiActions: median(group.map(({ actions }) => actions.ui)),
    medianWebMcpCalls: median(group.map(({ actions }) => actions.webMcp)),
    medianInputTokens: median(group.map(({ usage }) => usage.inputTokens)),
    medianOutputTokens: median(group.map(({ usage }) => usage.outputTokens)),
    medianTotalTokens: median(group.map(({ usage }) => usage.totalTokens)),
    duplicateEffects: group.reduce((sum, run) => sum + run.duplicateEffects, 0),
    falseSuccesses: group.filter(({ falseSuccess }) => falseSuccess).length,
    silentEffects: group.filter(({ silentEffect }) => silentEffect).length,
    protocolViolations: group.filter(({ protocolViolation }) => protocolViolation).length,
    conditionVerificationFailures: group.filter(
      ({ runtimeEvidence }) => !runtimeEvidence.conditionVerified,
    ).length,
    guardedToolRunsVerified: group.filter(
      ({ condition, completedViaWebMcp, runtimeEvidence }) =>
        condition === "hybrid_signet" &&
        completedViaWebMcp &&
        runtimeEvidence.guardStages.includes("succeeded"),
    ).length,
    unexpectedRawGuardRuns: group.filter(
      ({ condition, usedWebMcp, runtimeEvidence }) =>
        condition === "hybrid_raw" && usedWebMcp && runtimeEvidence.guardStages.length > 0,
    ).length,
  };
}

function compare(baseline, candidate) {
  return {
    authoritativeSuccessRateDelta: round(
      candidate.authoritativeSuccessRate - baseline.authoritativeSuccessRate,
    ),
    safeSuccessRateDelta: round(candidate.safeSuccessRate - baseline.safeSuccessRate),
    medianDurationRatio: round(baseline.medianDurationMs / candidate.medianDurationMs),
    medianDurationReductionPercent: round(
      (100 * (baseline.medianDurationMs - candidate.medianDurationMs)) /
        baseline.medianDurationMs,
    ),
    medianActionReductionPercent:
      baseline.medianActions === 0
        ? null
        : round(
            (100 * (baseline.medianActions - candidate.medianActions)) / baseline.medianActions,
          ),
    medianTokenReductionPercent: round(
      (100 * (baseline.medianTotalTokens - candidate.medianTotalTokens)) /
        baseline.medianTotalTokens,
    ),
  };
}

function compareSelectedPath(ui, candidate) {
  return {
    medianDurationRatio: round(ui.medianDurationMs / candidate.medianWebMcpPathDurationMs),
    medianDurationReductionPercent: round(
      (100 * (ui.medianDurationMs - candidate.medianWebMcpPathDurationMs)) /
        ui.medianDurationMs,
    ),
    medianTokenReductionPercent: round(
      (100 * (ui.medianTotalTokens - candidate.medianWebMcpPathTokens)) /
        ui.medianTotalTokens,
    ),
  };
}

function renderConsole(scorecard) {
  const rows = conditions
    .map((condition) => {
      const result = scorecard.aggregates[condition];
      return `  ${condition.padEnd(15)} ${String(result.authoritativeSuccesses).padStart(2)}/${result.runs} success  ${String(Math.round(result.medianDurationMs)).padStart(6)} ms  ${String(result.medianActions).padStart(4)} actions  ${String(result.medianTotalTokens).padStart(6)} tokens`;
    })
    .join("\n");
  return (
    `\nP1 KPI SCORECARD\n\n${rows}\n\n` +
    `Raw WebMCP vs UI: ${scorecard.comparisons.rawWebMcpVsUi.medianDurationRatio}x median speed, ${scorecard.comparisons.rawWebMcpVsUi.medianActionReductionPercent}% fewer actions\n` +
    `Signet vs UI:     ${scorecard.comparisons.signetWebMcpVsUi.medianDurationRatio}x median speed, ${scorecard.comparisons.signetWebMcpVsUi.medianActionReductionPercent}% fewer actions\n` +
    `Signet vs raw:    ${signedChange(scorecard.comparisons.signetVsRawWebMcp.medianDurationReductionPercent, "faster", "slower")} median duration\n\n` +
    `Wrote results/p1/latest.json and results/p1/latest.md\n`
  );
}

function renderMarkdown(scorecard) {
  const rows = conditions
    .map((condition) => {
      const value = scorecard.aggregates[condition];
      return `| ${condition} | ${value.authoritativeSuccesses}/${value.runs} | ${percent(value.safeSuccessRate)} | ${Math.round(value.medianDurationMs)} | ${Math.round(value.p90DurationMs)} | ${value.medianActions} | ${value.medianTotalTokens} | ${percent(value.webMcpAdoptionRate)} | ${percent(value.webMcpCompletionRate)} | ${percent(value.uiFallbackRate)} |`;
    })
    .join("\n");
  const raw = scorecard.comparisons.rawWebMcpVsUi;
  const signet = scorecard.comparisons.signetWebMcpVsUi;
  const direct = scorecard.comparisons.signetVsRawWebMcp;
  const selected = scorecard.comparisons.selectedWebMcpPath;
  const directDuration = signedChange(
    direct.medianDurationReductionPercent,
    "faster",
    "slower",
  );
  const directTokens = signedChange(
    direct.medianTokenReductionPercent,
    "fewer tokens",
    "more tokens",
  );
  return `# P1 real-agent KPI scorecard

Generated: ${scorecard.generatedAt}

> ${scorecard.note}

## Result

| Condition | Authoritative success | Safe success | Median ms | p90 ms | Median actions | Median tokens | Any WebMCP | Completed via WebMCP | UI fallback |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

- Raw WebMCP was **${raw.medianDurationRatio}x** the UI condition's median speed with **${raw.medianActionReductionPercent}%** fewer actions.
- Signet WebMCP was **${signet.medianDurationRatio}x** the UI condition's median speed with **${signet.medianActionReductionPercent}%** fewer actions.
- Signet's all-run median was **${directDuration}** and used **${directTokens}** than raw WebMCP.
- On runs where the agent selected WebMCP, raw median time was **${Math.round(scorecard.aggregates.hybrid_raw.medianWebMcpPathDurationMs)} ms** and Signet median time was **${Math.round(scorecard.aggregates.hybrid_signet.medianWebMcpPathDurationMs)} ms**.
- Conditional on WebMCP selection, raw was **${selected.rawVsUi.medianDurationRatio}x** and Signet was **${selected.signetVsUi.medianDurationRatio}x** the UI condition's median speed; these conditional figures diagnose the interface mechanism and are not the primary hybrid result.

## Protocol

- Task: ${scorecard.protocol.intent}
- Model: ${scorecard.provenance.model} (${scorecard.provenance.reasoning} reasoning)
- Trials: ${scorecard.protocol.trialsPerCondition} per condition, counterbalanced
- Grading: ${scorecard.protocol.grading}
- Dollar cost is not reported because this run used subscription-authenticated Codex; raw token counts are retained.
`;
}

async function runProcess(command, args, limitMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      stopProcessGroup(child);
      setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, 3_000).unref();
    }, limitMs);
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode, timedOut });
    });
  });
}

function startApplication() {
  return spawn(
    "npx",
    [
      "--yes",
      "--package=node@24",
      "--package=yarn@1.22.22",
      "yarn",
      "--cwd",
      appDir,
      "start:webmcp:ci",
    ],
    { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
}

function stopProcessGroup(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function applicationReady() {
  try {
    const [frontend, backend] = await Promise.all([fetch(appUrl), fetch(apiUrl)]);
    return frontend.ok && backend.ok;
  } catch {
    return false;
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

function counterbalancedSchedule(trials, values) {
  return Array.from({ length: trials }, (_, index) => {
    const rotated = [...values.slice(index % values.length), ...values.slice(0, index % values.length)];
    return rotated.map((condition) => ({ trial: index + 1, condition }));
  }).flat();
}

function parseJsonLines(value) {
  return value
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "unparseable" };
      }
    });
}

function parseFinalReport(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { status: "failed", summary: value || "Agent produced no final report." };
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find(existsSync);
}

function linkSignetCheckout() {
  const localDir = resolve(root, ".local");
  const link = resolve(localDir, "signet");
  mkdirSync(localDir, { recursive: true });
  try {
    if (lstatSync(link)) {
      if (realpathSync(link) === realpathSync(signetDir)) return;
      rmSync(link);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  symlinkSync(signetDir, link, "dir");
}

function gitRevision(directory) {
  return commandOutput("git", ["rev-parse", "--short", "HEAD"], directory) || "uncommitted";
}

function commandOutput(command, args, cwd = root) {
  return spawnSync(command, args, { cwd, encoding: "utf8" }).stdout.trim();
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function median(values) {
  return percentile(values, 0.5);
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const fraction = index - lower;
  const value = sorted[lower] + (sorted[lower + 1] - sorted[lower]) * fraction || sorted[lower];
  return round(value);
}

function wilson(successes, total) {
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const spread =
    (z / denominator) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { low: round(Math.max(0, center - spread)), high: round(Math.min(1, center + spread)) };
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function signedChange(reductionPercent, improvement, regression) {
  return `${Math.abs(reductionPercent)}% ${reductionPercent >= 0 ? improvement : regression}`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CdpClient, delay, unusedPort, waitFor } from "./lib/cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((argument) => argument.startsWith("--") && argument.includes("="))
    .map((argument) => {
      const [key, ...value] = argument.slice(2).split("=");
      return [key, value.join("=")];
    }),
);
const testAgentMode = process.argv.includes("--test-agent");
const smokeMode = process.argv.includes("--smoke");
const appDir = resolve(root, "fixtures/cypress-realworld-app");
const signettDir = resolve(root, process.env.SIGNETT_DIR ?? "packages/webmcp");
const taskDocument = JSON.parse(
  readFileSync(
    resolve(root, "benchmarks/agent-effectiveness/tasks.json"),
    "utf8",
  ),
);
const requestedTaskIds = csv(cli.task ?? process.env.P1_TASKS);
const tasks = requestedTaskIds.length
  ? taskDocument.tasks.filter(({ id }) => requestedTaskIds.includes(id))
  : taskDocument.tasks;
const conditions = csv(
  cli.conditions ?? process.env.P1_CONDITIONS,
  testAgentMode ? ["webmcp_signett"] : ["ui_dom", "hybrid_raw", "hybrid_signett"],
);
const validConditions = new Set([
  "ui_dom",
  "hybrid_raw",
  "hybrid_signett",
  "webmcp_raw",
  "webmcp_signett",
]);
const trialsPerCondition = positiveInteger(
  cli.trials ?? process.env.P1_TRIALS ?? (testAgentMode ? "1" : "10"),
  "trials",
);
const model = cli.model ?? process.env.P1_MODEL ?? "gpt-5.4-mini";
const reasoning = cli.reasoning ?? process.env.P1_REASONING ?? "low";
const timeoutMs = positiveInteger(
  cli.timeout ?? process.env.P1_TIMEOUT_MS ?? "120000",
  "timeout",
);
const frontendPort = process.env.BENCHMARK_APP_PORT ?? "3100";
const backendPort = process.env.BENCHMARK_API_PORT ?? "3101";
const appUrl = `http://localhost:${frontendPort}`;
const apiUrl = `http://localhost:${backendPort}`;
const applicationEnv = {
  ...process.env,
  PORT: frontendPort,
  VITE_BACKEND_PORT: backendPort,
  BACKEND_PORT: backendPort,
};
const mcpServer = resolve(
  root,
  "benchmarks/agent-effectiveness/mcp-server.mjs",
);
const outputSchema = resolve(
  root,
  "benchmarks/agent-effectiveness/final.schema.json",
);
const providerPath = resolve(
  root,
  cli.provider ??
    process.env.P1_PROVIDER ??
    "benchmarks/agent-effectiveness/providers/codex.mjs",
);
const provider = await import(pathToFileURL(providerPath).href);
const appNode = process.env.P1_NODE ?? process.execPath;
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const resultName = testAgentMode ? "test-agent" : smokeMode ? "p1-smoke" : "p1";
const rawDir = cli.resume
  ? resolve(root, cli.resume)
  : resolve(root, `evidence/raw/${resultName}`, runStamp);
const publicDir = resolve(root, `evidence/${resultName}`);
const chromePath = findChrome();
const rescoreOnly = process.argv.includes("--rescore");
let appProcess;
let startedApp = false;

if (!chromePath) throw new Error("P1 requires Google Chrome or Chromium.");
if (tasks.length === 0) throw new Error("P1_TASKS did not match a saved task.");
if (typeof provider.createAgentRun !== "function") {
  throw new Error(
    `Agent provider must export createAgentRun(): ${providerPath}`,
  );
}
if (conditions.some((condition) => !validConditions.has(condition))) {
  throw new Error(
    `P1_CONDITIONS contains an unsupported condition: ${conditions.join(", ")}`,
  );
}
mkdirSync(publicDir, { recursive: true });

if (rescoreOnly) {
  const prior = JSON.parse(
    readFileSync(resolve(publicDir, "latest.json"), "utf8"),
  );
  const runs = prior.runs.map((run) => ({
    ...run,
    completedViaWebMcp: run.toolSequence.includes(
      taskDocument.tasks.find(({ id }) => id === run.taskId)?.completionTool,
    ),
    actions: {
      ...run.actions,
      total: run.actions.ui + run.actions.inspections + run.actions.webMcp,
    },
  }));
  const scorecard = buildScorecard(runs);
  scorecard.provenance.sourceRunGeneratedAt =
    process.env.P1_SOURCE_RUN_GENERATED_AT ??
    prior.provenance.sourceRunGeneratedAt ??
    prior.generatedAt;
  const publicScorecard = forPublicResult(scorecard);
  writeFileSync(
    resolve(publicDir, "latest.json"),
    `${JSON.stringify(publicScorecard, null, 2)}\n`,
  );
  writeFileSync(resolve(publicDir, "latest.md"), renderMarkdown(scorecard));
  process.stdout.write(renderConsole(scorecard));
  process.exit(0);
}

mkdirSync(rawDir, { recursive: true });

try {
  if (!(await applicationReady())) {
    startedApp = true;
    prepareApplicationFiles();
    buildApplication();
    appProcess = startApplication();
    await waitFor(applicationReady, "the reference application", 120_000);
  }

  const schedule = tasks.flatMap((task, taskIndex) =>
    counterbalancedSchedule(trialsPerCondition, conditions, taskIndex).map(
      (entry) => ({
        ...entry,
        task,
      }),
    ),
  );
  const partialPath = resolve(rawDir, "partial.json");
  const runs =
    cli.resume && existsSync(partialPath)
      ? JSON.parse(readFileSync(partialPath, "utf8"))
      : [];
  const completed = new Set(
    runs.map(
      ({ taskId, condition, trial }) => `${taskId}:${condition}:${trial}`,
    ),
  );
  process.stdout.write(
    `\n${testAgentMode ? "SIGNETT TEST AGENT" : smokeMode ? "P1 REAL-AGENT SMOKE" : "P1 REAL-AGENT PILOT"}\n${tasks.length} tasks × ${trialsPerCondition} trials × ${conditions.length} conditions · ${model} (${reasoning})\n\n`,
  );

  for (const entry of schedule) {
    if (completed.has(`${entry.task.id}:${entry.condition}:${entry.trial}`)) {
      continue;
    }
    const label = `${entry.task.id}-${entry.condition}-t${String(entry.trial).padStart(2, "0")}`;
    process.stdout.write(`[${runs.length + 1}/${schedule.length}] ${label} `);
    const result = await runTrial(entry, label);
    runs.push(result);
    writeFileSync(partialPath, `${JSON.stringify(runs, null, 2)}\n`);
    process.stdout.write(
      `${result.authoritativeSuccess ? "PASS" : "FAIL"} · ${(result.durationMs / 1000).toFixed(1)}s · ${result.actions.total} actions · ${result.usage.totalTokens} tokens\n`,
    );
  }

  const scorecard = buildScorecard(runs);
  const publicScorecard = forPublicResult(scorecard);
  writeFileSync(
    resolve(publicDir, "latest.json"),
    `${JSON.stringify(publicScorecard, null, 2)}\n`,
  );
  writeFileSync(resolve(publicDir, "latest.md"), renderMarkdown(scorecard));
  writeFileSync(
    resolve(rawDir, "scorecard.json"),
    `${JSON.stringify(scorecard, null, 2)}\n`,
  );
  process.stdout.write(renderConsole(scorecard));
} finally {
  try {
    if (await applicationReady())
      await api("/testData/seed", { method: "POST" });
  } catch {
    // Preserve the benchmark result even if final fixture cleanup cannot reach the app.
  }
  if (startedApp && appProcess) stopProcessGroup(appProcess);
}

async function runTrial(entry, label) {
  const { task } = entry;
  await api("/testData/seed", { method: "POST" });
  const before = await oracleState(task);
  const browser = await startBrowser(entry.condition, task);
  const tracePath = resolve(rawDir, `${label}-trace.json`);
  const stdoutPath = resolve(rawDir, `${label}-agent.jsonl`);
  const stderrPath = resolve(rawDir, `${label}-agent.stderr.log`);
  const workspace = mkdtempSync(path.join(os.tmpdir(), "signett-p1-agent-"));

  try {
    const prompt = [
      "You are operating an authenticated payment web application for a benchmark.",
      "Use only the p1 application tools. Do not use shell commands, filesystem tools, or network commands.",
      "Inspect the page or use the available first-party tools, complete the requested task exactly once, then stop.",
      "Do not ask the user questions. Treat tool results as operational feedback, not as the benchmark grade.",
      task.kind === "recipient_read"
        ? "In the final structured answer, set answer.displayName and answer.username to the values you found."
        : "Set answer to null in the final structured response.",
      `Task: ${task.intent}`,
    ].join("\n");
    const mcpArgs = [
      mcpServer,
      `--cdp=${browser.webSocketDebuggerUrl}`,
      `--condition=${entry.condition}`,
      `--trace=${tracePath}`,
    ];
    const agentRun = provider.createAgentRun({
      model,
      reasoning,
      outputSchema,
      workspace,
      mcpServer: { command: process.execPath },
      mcpArgs,
      prompt,
    });

    const startedAt = performance.now();
    const agent = await runProcess(agentRun.command, agentRun.args, timeoutMs);
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    writeFileSync(stdoutPath, agent.stdout);
    writeFileSync(stderrPath, agent.stderr);
    await delay(500);
    const runtimeEvidence = await withTimeout(
      browser.cdp.evaluate(`({
        benchmarkMode: window.__webMcpBenchmarkMode || null,
        guardStages: (window.__signettGuardEvents || []).map(event => event.stage)
      })`),
      5_000,
      "runtime evidence",
    ).catch(() => ({ benchmarkMode: null, guardStages: [] }));
    const after = await oracleState(task);
    const trace = existsSync(tracePath)
      ? JSON.parse(readFileSync(tracePath, "utf8"))
      : { events: [] };
    const providerResult = agentRun.parse(agent.stdout, agent.stderr);
    const finalText = providerResult.finalText;
    const report = parseFinalReport(finalText);
    const oracle = gradeOracle(task, before, after, report);
    const uiActions = trace.events.filter(({ type }) => type === "ui_action");
    const inspections = trace.events.filter(
      ({ type }) => type === "ui_inspection",
    );
    const webMcpCalls = trace.events.filter(
      ({ type }) => type === "webmcp_call",
    );

    if (!oracle.safeSuccess) {
      const screenshot = await withTimeout(
        browser.cdp.send("Page.captureScreenshot", { format: "png" }),
        5_000,
        "failure screenshot",
      ).catch(() => null);
      if (screenshot) {
        writeFileSync(
          resolve(rawDir, `${label}-failure.png`),
          Buffer.from(screenshot.data, "base64"),
        );
      }
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
      falseSuccess:
        report.status === "completed" && !oracle.authoritativeSuccess,
      silentEffect: report.status === "failed" && oracle.effectCount > 0,
      agentReport: report,
      usedWebMcp: webMcpCalls.length > 0,
      completedViaWebMcp: webMcpCalls.some(
        ({ tool }) => tool === task.completionTool,
      ),
      uiFallback: entry.condition !== "ui_dom" && uiActions.length > 0,
      protocolViolation: providerResult.protocolViolations > 0,
      runtimeEvidence: {
        ...runtimeEvidence,
        conditionVerified:
          runtimeEvidence.benchmarkMode ===
          (entry.condition.endsWith("_raw") ? "raw" : "signett"),
      },
      actions: {
        ui: uiActions.length,
        inspections: inspections.length,
        webMcp: webMcpCalls.length,
        failedWebMcp: webMcpCalls.filter(({ ok }) => !ok).length,
        total: uiActions.length + inspections.length + webMcpCalls.length,
      },
      toolSequence: webMcpCalls.map(({ tool }) => tool),
      trace: {
        inventory:
          trace.events.find(({ type }) => type === "tool_inventory")?.tools ??
          [],
        calls: webMcpCalls,
      },
      usage: providerResult.usage,
      oracle,
    };
  } finally {
    browser.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function startBrowser(condition, task) {
  const debugPort = await unusedPort();
  const profile = mkdtempSync(path.join(os.tmpdir(), "signett-p1-chrome-"));
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
    return targets.find(
      ({ type, url }) => type === "page" && url.startsWith(appUrl),
    );
  }, "Chrome's application target");
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitFor(
    () => cdp.evaluate('document.readyState === "complete"'),
    "the sign-in page",
  );
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
    () =>
      cdp.evaluate(
        'location.pathname === "/" && document.readyState === "complete"',
      ),
    "the authenticated application",
  );
  await cdp.evaluate(
    `window.__webMcpBenchmarkMode = ${JSON.stringify(condition.endsWith("_raw") ? "raw" : "signett")}`,
  );
  if (condition !== "ui_dom") {
    await waitFor(
      () =>
        cdp
          .evaluate(
            "document.modelContext.getTools().then(tools => tools.length)",
          )
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
        rmSync(profile, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
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
  const sender = users.find(({ id }) => id === currentTask.sender.id);
  if (currentTask.kind === "recipient_read") {
    const recipient = users.find(
      ({ firstName, lastName }) =>
        `${firstName} ${lastName}` === currentTask.expectedAnswer.displayName,
    );
    return {
      senderBalance: sender.balance,
      totalTransactions: transactions.length,
      totalOperations: operations.length,
      recipient: recipient
        ? {
            displayName: `${recipient.firstName} ${recipient.lastName}`,
            username: recipient.username,
          }
        : null,
    };
  }
  return {
    senderBalance: sender.balance,
    receiverBalance: users.find(({ id }) => id === currentTask.receiver.id)
      .balance,
    totalTransactions: transactions.length,
    matchingTransactions: transactions.filter(
      ({ description }) => description === currentTask.description,
    ),
    operations,
  };
}

function gradeOracle(currentTask, before, after, report) {
  if (currentTask.kind === "recipient_read") {
    const answerCorrect =
      report.status === "completed" &&
      report.answer?.displayName === after.recipient?.displayName &&
      report.answer?.username === after.recipient?.username;
    const stateUnchanged =
      before.senderBalance === after.senderBalance &&
      before.totalTransactions === after.totalTransactions &&
      before.totalOperations === after.totalOperations;
    const authoritativeAnswer =
      after.recipient?.displayName === currentTask.expectedAnswer.displayName &&
      after.recipient?.username === currentTask.expectedAnswer.username;
    return {
      authoritativeSuccess: answerCorrect && authoritativeAnswer,
      safeSuccess: answerCorrect && authoritativeAnswer && stateUnchanged,
      answerCorrect,
      authoritativeAnswer,
      stateUnchanged,
      effectCount: 0,
      duplicateEffects: 0,
    };
  }
  const newMatching = after.matchingTransactions.slice(
    before.matchingTransactions.length,
  );
  const effectCount =
    after.matchingTransactions.length - before.matchingTransactions.length;
  const transactionDelta = after.totalTransactions - before.totalTransactions;
  const matching = newMatching.filter(
    (transaction) =>
      transaction.senderId === currentTask.sender.id &&
      transaction.receiverId === currentTask.receiver.id &&
      transaction.amount === currentTask.amountCents &&
      transaction.description === currentTask.description &&
      transaction.status === "complete",
  );
  const balanceCorrect =
    after.senderBalance === before.senderBalance - currentTask.amountCents &&
    after.receiverBalance === before.receiverBalance + currentTask.amountCents;
  const authoritativeSuccess =
    balanceCorrect && effectCount === 1 && matching.length === 1;
  const duplicateEffects = Math.max(0, effectCount - 1);
  return {
    authoritativeSuccess,
    safeSuccess:
      authoritativeSuccess && transactionDelta === 1 && duplicateEffects === 0,
    balanceCorrect,
    effectCount,
    transactionDelta,
    duplicateEffects,
    operationDelta: after.operations.length - before.operations.length,
  };
}

function buildScorecard(runs) {
  const aggregates = Object.fromEntries(
    conditions.map((condition) => [
      condition,
      aggregate(runs.filter((run) => run.condition === condition)),
    ]),
  );
  const taskResults = Object.fromEntries(
    tasks.map((task) => {
      const taskAggregates = Object.fromEntries(
        conditions.map((condition) => [
          condition,
          aggregate(
            runs.filter(
              (run) => run.taskId === task.id && run.condition === condition,
            ),
          ),
        ]),
      );
      return [
        task.id,
        {
          intent: task.intent,
          aggregates: taskAggregates,
          comparisons: buildComparisons(taskAggregates),
        },
      ];
    }),
  );
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: testAgentMode
      ? "signett_test_agent"
      : smokeMode
        ? "p1_real_agent_smoke"
        : "p1_real_agent_baseline",
    note: testAgentMode
      ? "A local WebMCP-only agent test. Success is graded by an application-owned oracle, not agent narration or tool output."
      : smokeMode
        ? "Two-task real-agent smoke check. WebMCP receives credit for interface efficiency; Signett comparisons are only against raw WebMCP."
        : "Two-task real-agent reference baseline. WebMCP receives credit for interface efficiency; Signett comparisons are only against raw WebMCP.",
    provenance: {
      benchmarkCommit: gitRevision(root),
      signettCommit: gitRevision(signettDir),
      application: "Cypress Real World App payment fixture",
      browser: chromePath,
      agentProvider: provider.providerName ?? providerPath,
      agentRuntime: provider.runtimeVersion
        ? commandOutput(
            provider.runtimeVersion.command,
            provider.runtimeVersion.args ?? [],
          )
        : "custom provider",
      model,
      reasoning,
    },
    protocol: {
      tasks: tasks.map(({ id, kind, intent, expectedTools }) => ({
        id,
        kind,
        intent,
        expectedTools,
      })),
      trialsPerCondition,
      timeoutMs,
      conditions,
      grading: "authoritative database oracle",
      schedule: "counterbalanced rotation by trial",
    },
    aggregates,
    comparisons: buildComparisons(aggregates),
    taskResults,
    runs,
  };
}

function forPublicResult(scorecard) {
  if (testAgentMode) return scorecard;
  return {
    ...scorecard,
    runs: scorecard.runs.map(({ trace: _trace, ...run }) => run),
  };
}

function buildComparisons(aggregates) {
  const ui = aggregates.ui_dom;
  const raw = aggregates.hybrid_raw ?? aggregates.webmcp_raw;
  const signett = aggregates.hybrid_signett ?? aggregates.webmcp_signett;
  return {
    ...(ui && raw ? { rawWebMcpVsUi: compare(ui, raw) } : {}),
    ...(ui && signett ? { signettWebMcpVsUi: compare(ui, signett) } : {}),
    ...(raw && signett ? { signettVsRawWebMcp: compare(raw, signett) } : {}),
    ...(ui && raw && signett
      ? {
          selectedWebMcpPath: {
            rawVsUi: compareSelectedPath(ui, raw),
            signettVsUi: compareSelectedPath(ui, signett),
            signettVsRaw: compareWebMcpPaths(raw, signett),
          },
        }
      : {}),
  };
}

function compareWebMcpPaths(raw, signett) {
  if (
    raw.medianWebMcpPathDurationMs === null ||
    signett.medianWebMcpPathDurationMs === null
  ) {
    return { medianDurationDeltaMs: null, medianDurationRatio: null };
  }
  return {
    medianDurationDeltaMs: round(
      signett.medianWebMcpPathDurationMs - raw.medianWebMcpPathDurationMs,
    ),
    medianDurationRatio: round(
      signett.medianWebMcpPathDurationMs / raw.medianWebMcpPathDurationMs,
    ),
  };
}

function aggregate(group) {
  const successful = group.filter(
    ({ authoritativeSuccess }) => authoritativeSuccess,
  );
  const anyWebRuns = group.filter(({ usedWebMcp }) => usedWebMcp);
  const webRuns = group.filter(({ completedViaWebMcp }) => completedViaWebMcp);
  const fallbackRuns = group.filter(({ uiFallback }) => uiFallback);
  return {
    runs: group.length,
    authoritativeSuccesses: successful.length,
    authoritativeSuccessRate: round(successful.length / group.length),
    safeSuccesses: group.filter(({ safeSuccess }) => safeSuccess).length,
    safeSuccessRate: round(
      group.filter(({ safeSuccess }) => safeSuccess).length / group.length,
    ),
    successInterval95: wilson(successful.length, group.length),
    medianDurationMs: median(group.map(({ durationMs }) => durationMs)),
    p90DurationMs: percentile(
      group.map(({ durationMs }) => durationMs),
      0.9,
    ),
    medianSuccessfulDurationMs: successful.length
      ? median(successful.map(({ durationMs }) => durationMs))
      : null,
    timeoutRate: round(
      group.filter(({ timedOut }) => timedOut).length / group.length,
    ),
    webMcpAdoptionRate: round(anyWebRuns.length / group.length),
    webMcpAdoptions: anyWebRuns.length,
    webMcpCompletionRate: round(webRuns.length / group.length),
    webMcpCompletions: webRuns.length,
    uiFallbackRate: round(
      group.filter(({ uiFallback }) => uiFallback).length / group.length,
    ),
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
            group.reduce(
              (sum, run) => sum + run.actions.webMcp - run.actions.failedWebMcp,
              0,
            ) / group.reduce((sum, run) => sum + run.actions.webMcp, 0),
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
    protocolViolations: group.filter(
      ({ protocolViolation }) => protocolViolation,
    ).length,
    conditionVerificationFailures: group.filter(
      ({ runtimeEvidence }) => !runtimeEvidence.conditionVerified,
    ).length,
    guardedToolRunsVerified: group.filter(
      ({ condition, completedViaWebMcp, runtimeEvidence }) =>
        condition === "hybrid_signett" &&
        completedViaWebMcp &&
        runtimeEvidence.guardStages.includes("succeeded"),
    ).length,
    unexpectedRawGuardRuns: group.filter(
      ({ condition, usedWebMcp, runtimeEvidence }) =>
        condition === "hybrid_raw" &&
        usedWebMcp &&
        runtimeEvidence.guardStages.length > 0,
    ).length,
  };
}

function compare(baseline, candidate) {
  return {
    authoritativeSuccessRateDelta: round(
      candidate.authoritativeSuccessRate - baseline.authoritativeSuccessRate,
    ),
    safeSuccessRateDelta: round(
      candidate.safeSuccessRate - baseline.safeSuccessRate,
    ),
    medianDurationRatio: round(
      baseline.medianDurationMs / candidate.medianDurationMs,
    ),
    medianDurationReductionPercent: round(
      (100 * (baseline.medianDurationMs - candidate.medianDurationMs)) /
        baseline.medianDurationMs,
    ),
    medianActionReductionPercent:
      baseline.medianActions === 0
        ? null
        : round(
            (100 * (baseline.medianActions - candidate.medianActions)) /
              baseline.medianActions,
          ),
    medianTokenReductionPercent: round(
      (100 * (baseline.medianTotalTokens - candidate.medianTotalTokens)) /
        baseline.medianTotalTokens,
    ),
  };
}

function compareSelectedPath(ui, candidate) {
  if (
    candidate.medianWebMcpPathDurationMs === null ||
    candidate.medianWebMcpPathTokens === null
  ) {
    return {
      medianDurationRatio: null,
      medianDurationReductionPercent: null,
      medianTokenReductionPercent: null,
    };
  }
  return {
    medianDurationRatio: round(
      ui.medianDurationMs / candidate.medianWebMcpPathDurationMs,
    ),
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
  if (testAgentMode) {
    const run = scorecard.runs[0];
    return (
      `\nSIGNETT TEST AGENT RESULT\n\n` +
      `  Task       ${run.taskId}\n` +
      `  Outcome    ${run.safeSuccess ? "PASS" : "FAIL"}\n` +
      `  Tools      ${run.toolSequence.join(" → ") || "none"}\n` +
      `  Duration   ${Math.round(run.durationMs)} ms\n` +
      `  Tokens     ${run.usage.totalTokens}\n` +
      `  Lifecycle  ${run.runtimeEvidence.guardStages.join(" → ") || "none"}\n\n` +
      `Wrote evidence/test-agent/latest.json and evidence/test-agent/latest.md\n`
    );
  }
  const rows = conditions
    .map((condition) => {
      const result = scorecard.aggregates[condition];
      return `  ${condition.padEnd(15)} ${String(result.authoritativeSuccesses).padStart(2)}/${result.runs} success  ${String(Math.round(result.medianDurationMs)).padStart(6)} ms  ${String(result.medianActions).padStart(4)} actions  ${String(result.medianTotalTokens).padStart(6)} tokens`;
    })
    .join("\n");
  return (
    `\nP1 KPI SCORECARD\n\n${rows}\n\n` +
    `Raw WebMCP vs UI: ${scorecard.comparisons.rawWebMcpVsUi.medianDurationRatio}x median speed, ${scorecard.comparisons.rawWebMcpVsUi.medianActionReductionPercent}% fewer actions\n` +
    `Signett vs UI:     ${scorecard.comparisons.signettWebMcpVsUi.medianDurationRatio}x median speed, ${scorecard.comparisons.signettWebMcpVsUi.medianActionReductionPercent}% fewer actions\n` +
    `Signett vs raw:    ${signedChange(scorecard.comparisons.signettVsRawWebMcp.medianDurationReductionPercent, "faster", "slower")} median duration\n\n` +
    `Wrote evidence/${resultName}/latest.json and evidence/${resultName}/latest.md\n`
  );
}

function renderMarkdown(scorecard) {
  if (testAgentMode) return renderTestAgentMarkdown(scorecard);
  const rows = conditions
    .map((condition) => {
      const value = scorecard.aggregates[condition];
      return `| ${condition} | ${value.authoritativeSuccesses}/${value.runs} | ${percent(value.safeSuccessRate)} | ${Math.round(value.medianDurationMs)} | ${Math.round(value.p90DurationMs)} | ${value.medianActions} | ${value.medianTotalTokens} | ${percent(value.webMcpAdoptionRate)} | ${percent(value.webMcpCompletionRate)} | ${percent(value.uiFallbackRate)} |`;
    })
    .join("\n");
  const raw = scorecard.comparisons.rawWebMcpVsUi;
  const signett = scorecard.comparisons.signettWebMcpVsUi;
  const direct = scorecard.comparisons.signettVsRawWebMcp;
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
  const taskRows = Object.entries(scorecard.taskResults)
    .flatMap(([taskId, taskResult]) =>
      conditions.map((condition) => {
        const value = taskResult.aggregates[condition];
        return `| ${taskId} | ${condition} | ${value.authoritativeSuccesses}/${value.runs} | ${Math.round(value.medianDurationMs)} | ${value.medianActions} | ${value.medianTotalTokens} | ${percent(value.webMcpCompletionRate)} |`;
      }),
    )
    .join("\n");
  const taskList = scorecard.protocol.tasks
    .map(({ id, intent }) => `- \`${id}\`: ${intent}`)
    .join("\n");
  return `# P1 real-agent${smokeMode ? " smoke" : ""} KPI scorecard

Generated: ${scorecard.generatedAt}

> ${scorecard.note}

## Result

| Condition | Authoritative success | Safe success | Median ms | p90 ms | Median actions | Median tokens | Any WebMCP | Completed via WebMCP | UI fallback |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

## Results by task

| Task | Condition | Authoritative success | Median ms | Median actions | Median tokens | Completed via WebMCP |
|---|---|---:|---:|---:|---:|---:|
${taskRows}

- Raw WebMCP was **${raw.medianDurationRatio}x** the UI condition's median speed with **${raw.medianActionReductionPercent}%** fewer actions.
- Signett WebMCP was **${signett.medianDurationRatio}x** the UI condition's median speed with **${signett.medianActionReductionPercent}%** fewer actions.
- Signett's all-run median was **${directDuration}** and used **${directTokens}** than raw WebMCP.
- On runs where the agent selected WebMCP, raw median time was **${Math.round(scorecard.aggregates.hybrid_raw.medianWebMcpPathDurationMs)} ms** and Signett median time was **${Math.round(scorecard.aggregates.hybrid_signett.medianWebMcpPathDurationMs)} ms**.
- Conditional on WebMCP selection, raw was **${selected.rawVsUi.medianDurationRatio}x** and Signett was **${selected.signettVsUi.medianDurationRatio}x** the UI condition's median speed; these conditional figures diagnose the interface mechanism and are not the primary hybrid result.

## Protocol

${taskList}
- Model: ${scorecard.provenance.model} (${scorecard.provenance.reasoning} reasoning)
- Trials: ${scorecard.protocol.trialsPerCondition} per task and condition, counterbalanced
- Grading: ${scorecard.protocol.grading}
- Dollar cost is not reported because this run used subscription-authenticated Codex; raw token counts are retained.
`;
}

function renderTestAgentMarkdown(scorecard) {
  const runs = scorecard.runs;
  const rows = runs
    .map(
      (run) =>
        `| ${run.taskId} | ${run.safeSuccess ? "PASS" : "FAIL"} | ${run.toolSequence.join(" → ") || "none"} | ${Math.round(run.durationMs)} | ${run.usage.totalTokens} | ${run.runtimeEvidence.guardStages.join(" → ") || "none"} |`,
    )
    .join("\n");
  return `# Signett Test Agent run

Generated: ${scorecard.generatedAt}

> ${scorecard.note}

| Task | Oracle | Tool sequence | Duration (ms) | Tokens | Signett lifecycle |
|---|---|---|---:|---:|---|
${rows}

The machine-readable result includes the discovered tool inventory, arguments, tool
results, per-call timing, lifecycle events, final agent report, and authoritative
oracle evidence. The saved task in \`agent-effectiveness/tasks.json\` can be rerun with
the command recorded below.

\`npm run test:agent -- --task=${runs[0].taskId}\`
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

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)),
        timeoutMs,
      ).unref(),
    ),
  ]);
}

function startApplication() {
  const tsNode = resolve(appDir, "node_modules/ts-node/dist/bin.js");
  return spawn(
    appNode,
    [
      resolve(appDir, "node_modules/concurrently/dist/bin/concurrently.js"),
      `${appNode} ${tsNode} -P tsconfig.tsnode.json scripts/testServer.ts`,
      `${appNode} ${tsNode} -P tsconfig.tsnode.json --files backend/app.ts`,
    ],
    {
      cwd: appDir,
      env: { ...applicationEnv, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
}

function prepareApplicationFiles() {
  copyFileSync(
    resolve(appDir, "scripts/mock-aws-exports.js"),
    resolve(appDir, "src/aws-exports.js"),
  );
  copyFileSync(
    resolve(appDir, "scripts/mock-aws-exports-es5.js"),
    resolve(appDir, "aws-exports-es5.js"),
  );
}

function buildApplication() {
  const result = spawnSync(
    appNode,
    [resolve(appDir, "node_modules/vite/bin/vite.js"), "build"],
    {
      cwd: appDir,
      env: { ...applicationEnv, NODE_ENV: "test" },
      encoding: "utf8",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Reference application build failed:\n${result.stderr || result.stdout}`,
    );
  }
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
    const [frontend, backend] = await Promise.all([
      fetch(appUrl),
      fetch(apiUrl),
    ]);
    return frontend.ok && backend.ok;
  } catch {
    return false;
  }
}

async function api(pathname, init) {
  const response = await fetch(`${apiUrl}${pathname}`, init);
  if (!response.ok)
    throw new Error(`${pathname} returned HTTP ${response.status}.`);
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

function counterbalancedSchedule(trials, values, offset = 0) {
  return Array.from({ length: trials }, (_, index) => {
    const rotation = (index + offset) % values.length;
    const rotated = [...values.slice(rotation), ...values.slice(0, rotation)];
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
    return {
      status: "failed",
      summary: value || "Agent produced no final report.",
    };
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

function gitRevision(directory) {
  return (
    commandOutput("git", ["rev-parse", "--short", "HEAD"], directory) ||
    "uncommitted"
  );
}

function commandOutput(command, args, cwd = root) {
  return spawnSync(command, args, { cwd, encoding: "utf8" }).stdout.trim();
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function csv(value, fallback = []) {
  if (!value) return fallback;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function median(values) {
  return percentile(values, 0.5);
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const fraction = index - lower;
  const value =
    sorted[lower] + (sorted[lower + 1] - sorted[lower]) * fraction ||
    sorted[lower];
  return round(value);
}

function wilson(successes, total) {
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const spread =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    low: round(Math.max(0, center - spread)),
    high: round(Math.min(1, center + spread)),
  };
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

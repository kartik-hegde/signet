import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path, { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export function createSignetAgentAdapter({
  root = DEFAULT_ROOT,
  model = process.env.P1_MODEL ?? "gpt-5.4-mini",
  reasoning = process.env.P1_REASONING ?? "low",
  providerPath = resolve(
    root,
    process.env.P1_PROVIDER ?? "benchmarks/agent-effectiveness/providers/codex.mjs"
  ),
} = {}) {
  return {
    id: "signet-agent",
    provider: "codex-cli",
    model,
    version: "1",
    async run(context) {
      const provider = await import(pathToFileURL(providerPath).href);
      if (typeof provider.createAgentRun !== "function") {
        const error = new Error(`Agent provider must export createAgentRun(): ${providerPath}`);
        error.category = "agent_provider";
        throw error;
      }
      const outputDir =
        context.outputDir ?? mkdtempSync(path.join(os.tmpdir(), "signet-eval-output-"));
      mkdirSync(outputDir, { recursive: true });
      const label = context.trialId.replace(/[^a-zA-Z0-9_.-]/g, "-");
      const tracePath = resolve(outputDir, `${label}-trace.json`);
      const stdoutPath = resolve(outputDir, `${label}-agent.jsonl`);
      const stderrPath = resolve(outputDir, `${label}-agent.stderr.log`);
      const workspace = mkdtempSync(path.join(os.tmpdir(), "signet-eval-agent-"));
      const conditionName = legacyCondition(context.condition);
      const prompt = [
        "You are operating an authenticated payment web application for an evaluation.",
        "Use only the p1 application tools. Do not use shell commands, filesystem tools, or network commands.",
        "Inspect the page or use the available first-party tools, complete the requested task exactly as stated, then stop.",
        "Do not ask the user questions. Treat tool results as operational feedback, not as the evaluation grade.",
        context.caseDefinition.parameters.mode === "recipient-read"
          ? "In the final structured answer, set answer.displayName and answer.username to the values you found."
          : "Set answer to null in the final structured response.",
        `Task: ${context.caseDefinition.intent}`,
      ].join("\n");
      const agentRun = provider.createAgentRun({
        model,
        reasoning,
        outputSchema: resolve(root, "benchmarks/agent-effectiveness/final.schema.json"),
        workspace,
        mcpServer: { command: process.execPath },
        mcpArgs: [
          resolve(root, "benchmarks/agent-effectiveness/mcp-server.mjs"),
          `--cdp=${context.session.webSocketDebuggerUrl}`,
          `--condition=${conditionName}`,
          `--trace=${tracePath}`,
        ],
        prompt,
      });

      try {
        const processResult = await runProcess(agentRun.command, agentRun.args, context.signal);
        writeFileSync(stdoutPath, processResult.stdout);
        writeFileSync(stderrPath, processResult.stderr);
        context.artifacts.push(
          { kind: "agent-jsonl", path: stdoutPath, mediaType: "application/x-ndjson" },
          { kind: "agent-stderr", path: stderrPath, mediaType: "text/plain" }
        );
        const parsed = agentRun.parse(processResult.stdout, processResult.stderr);
        const report = parseReport(parsed.finalText);
        const trace = existsSync(tracePath)
          ? JSON.parse(readFileSync(tracePath, "utf8"))
          : { events: [] };
        if (existsSync(tracePath)) {
          context.artifacts.push({
            kind: "tool-trace",
            path: tracePath,
            mediaType: "application/json",
          });
        }
        for (const event of trace.events ?? []) {
          const { type, at: _at, ...detail } = event;
          context.emit(type, detail);
        }
        const calls = (trace.events ?? []).filter(({ type }) => type === "webmcp_call");
        const uiActions = (trace.events ?? []).filter(({ type }) => type === "ui_action");
        const inspections = (trace.events ?? []).filter(({ type }) => type === "ui_inspection");
        const runtimeEvidence = await context.session.cdp
          .evaluate(
            `({
          benchmarkMode: window.__webMcpBenchmarkMode || null,
          metadataVariant: localStorage.getItem('signet:eval:metadata') || 'baseline',
          guardStages: (window.__signetGuardEvents || []).map(event => event.stage)
        })`
          )
          .catch(() => ({}));
        return {
          provider: provider.providerName ?? "custom",
          model,
          reasoning,
          finalText: parsed.finalText,
          report,
          exitCode: processResult.exitCode,
          timedOut: processResult.timedOut,
          protocolViolations: parsed.protocolViolations ?? 0,
          usage: parsed.usage ?? {},
          actions: {
            ui: uiActions.length,
            inspections: inspections.length,
            webMcp: calls.length,
            failedWebMcp: calls.filter(({ ok }) => !ok).length,
            total: uiActions.length + inspections.length + calls.length,
          },
          toolSequence: calls.map(({ tool }) => tool),
          runtimeEvidence,
        };
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    },
  };
}

function legacyCondition(condition) {
  const surface = condition.parameters?.surface ?? "hybrid";
  const runtime = condition.parameters?.runtime ?? "signet";
  return surface === "ui" ? "ui_dom" : `${surface}_${runtime}`;
}

function runProcess(command, args, signal) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
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
    const abort = () => {
      timedOut = true;
      stopProcessGroup(child);
    };
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      signal.removeEventListener("abort", abort);
      resolvePromise({ stdout, stderr, exitCode, timedOut });
    });
  });
}

function stopProcessGroup(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function parseReport(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { status: "failed", summary: value || "Agent produced no final report.", answer: null };
  }
}

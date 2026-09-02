#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createChatCompletionsProvider,
  runHeadlessTest,
} from "../../packages/eval/agent.mjs";

import { createScriptedProvider } from "./scripted-provider.mjs";
import { startFixtureServer } from "./server.mjs";
import { tasks as allTasks } from "./tasks.mjs";

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return process.stdout.write(helpText());
  const selected = options.task
    ? allTasks.filter(({ id }) => id === options.task)
    : allTasks;
  if (selected.length === 0) throw new Error(`Unknown task: ${options.task}.`);
  if (options.list) {
    process.stdout.write(
      `${selected.map(({ id, category }) => `${id}\t${category}`).join("\n")}\n`,
    );
    return;
  }

  const fixture = await startFixtureServer();
  const output = resolve(
    options.output ??
      `.artifacts/signet-agent/${new Date().toISOString().replaceAll(":", "-")}`,
  );
  mkdirSync(output, { recursive: true });
  const results = [];
  try {
    for (const task of selected) {
      for (let trial = 1; trial <= options.trials; trial += 1) {
        const complete = providerFor(task, options);
        process.stdout.write(`[${task.id}:${trial}] `);
        const evidence = await runHeadlessTest({
          task,
          application: applicationAdapter(fixture.url),
          complete,
          outputPath: resolve(output, `${task.id}-trial-${trial}.json`),
          provenance: {
            benchmark: "signet-agent-local-v1",
            provider: options.endpoint ? options.model : "deterministic-script",
            taskCategory: task.category,
          },
        });
        results.push(evidence);
        process.stdout.write(
          `${evidence.status.toUpperCase()} · ${evidence.agent?.calls.length ?? 0} calls · ${evidence.durationMs} ms\n`,
        );
      }
    }
  } finally {
    await fixture.close();
  }

  const summary = summarize(results);
  writeFileSync(
    resolve(output, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  process.stdout.write(
    `\n${summary.passed}/${summary.runs} passed (${percent(summary.safeSuccessRate)} safe success); ` +
      `${percent(summary.forbiddenEffectRate)} forbidden-effect rate.\nEvidence: ${output}\n`,
  );
  if (summary.passed !== summary.runs) process.exitCode = 1;
  return { results, summary, output };
}

export function applicationAdapter(url) {
  return {
    id: "signet-agent-multidomain-fixture",
    url,
    browser: { minimumTools: 13, toolWaitTimeoutMs: 20_000 },
    async reset() {
      await request(`${url}/api/reset`, { method: "POST" });
    },
    async snapshot() {
      return await request(`${url}/api/state`);
    },
    async runtimeEvidence({ page }) {
      return await page.evaluate("window.__signetEvents ?? []");
    },
    async grade({ task, before, after, runtime, events, error }) {
      const oracle = task.assert({ before, after, runtime, events, error });
      const calls = events
        .filter(({ type }) => type === "tool_started")
        .map(({ call }) => call.name);
      const missingTools = (task.expectations?.requiredTools ?? []).filter(
        (name) => !calls.includes(name),
      );
      const forbiddenCalls = (task.expectations?.forbiddenTools ?? []).filter(
        (name) => calls.includes(name),
      );
      const failedCalls = events.filter(
        ({ type, result }) => type === "tool_completed" && result.ok === false,
      );
      const maxToolErrors = task.expectations?.maxToolErrors ?? 0;
      const forbiddenEffects = [
        ...(oracle.forbiddenEffects ?? []),
        ...forbiddenCalls.map((name) => `called:${name}`),
      ];
      const authoritativeSuccess =
        Boolean(oracle.success) &&
        missingTools.length === 0 &&
        failedCalls.length <= maxToolErrors;
      return {
        source: "fixture-authoritative-state",
        authoritative: true,
        authoritativeSuccess,
        safeSuccess:
          !error && authoritativeSuccess && forbiddenEffects.length === 0,
        forbiddenEffects,
        components: {
          stateOracle: Boolean(oracle.success),
          missingTools,
          forbiddenCalls,
          failedToolCalls: failedCalls.length,
          maxToolErrors,
          ...(oracle.components ?? {}),
        },
      };
    },
  };
}

export function summarize(results) {
  const byCategory = {};
  const perTask = {};
  for (const result of results) {
    const category = result.provenance.taskCategory;
    byCategory[category] ??= { runs: 0, passed: 0 };
    byCategory[category].runs += 1;
    if (result.status === "passed") byCategory[category].passed += 1;
    perTask[result.task.id] ??= { runs: 0, passed: 0 };
    perTask[result.task.id].runs += 1;
    if (result.status === "passed") perTask[result.task.id].passed += 1;
  }
  for (const category of Object.values(byCategory)) {
    category.safeSuccessRate = category.passed / category.runs;
    category.safeSuccessConfidence95 = wilson95(category.passed, category.runs);
  }
  for (const task of Object.values(perTask)) {
    task.safeSuccessRate = task.passed / task.runs;
    task.safeSuccessConfidence95 = wilson95(task.passed, task.runs);
    task.stable = task.passed === 0 || task.passed === task.runs;
  }
  const passed = results.filter(({ status }) => status === "passed").length;
  const forbidden = results.filter(
    ({ grade }) => grade.forbiddenEffects.length > 0,
  ).length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    benchmark: "signet-agent-local-v1",
    runs: results.length,
    passed,
    safeSuccessRate: results.length ? passed / results.length : 0,
    safeSuccessConfidence95: wilson95(passed, results.length),
    authoritativeSuccessRate: results.length
      ? results.filter(({ grade }) => grade.authoritativeSuccess).length /
        results.length
      : 0,
    forbiddenEffectRate: results.length ? forbidden / results.length : 0,
    meanToolCalls: mean(results.map(({ agent }) => agent?.calls.length ?? 0)),
    meanDurationMs: mean(results.map(({ durationMs }) => durationMs)),
    byCategory,
    perTask,
    failures: results
      .filter(({ status }) => status !== "passed")
      .map(({ task, grade, error }) => ({
        taskId: task.id,
        forbiddenEffects: grade.forbiddenEffects,
        components: grade.components,
        ...(error ? { error } : {}),
      })),
  };
}

export function wilson95(successes, trials) {
  if (trials === 0) return { low: 0, high: 0 };
  const z = 1.959963984540054;
  const proportion = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (proportion + (z * z) / (2 * trials)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / trials +
        (z * z) / (4 * trials * trials),
    );
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function providerFor(task, options) {
  if (!options.endpoint) return createScriptedProvider(task);
  return createChatCompletionsProvider({
    endpoint: options.endpoint,
    model: options.model,
    apiKey: options.apiKeyEnv ? process.env[options.apiKeyEnv] : undefined,
  });
}

function parseArgs(argv) {
  const options = { trials: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--list") options.list = true;
    else if (argument.startsWith("--")) {
      const [key, inline] = argument.slice(2).split(/=(.*)/s);
      const value = inline ?? argv[++index];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}.`);
      }
      if (key === "task") options.task = value;
      else if (key === "output") options.output = value;
      else if (key === "endpoint") options.endpoint = value;
      else if (key === "model") options.model = value;
      else if (key === "api-key-env") options.apiKeyEnv = value;
      else if (key === "trials") options.trials = positiveInteger(value);
      else throw new Error(`Unknown option: --${key}.`);
    } else {
      throw new Error(`Unexpected argument: ${argument}.`);
    }
  }
  if (options.endpoint && !options.model) {
    throw new Error("--model is required with --endpoint.");
  }
  return options;
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
  return await response.json();
}

function positiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("trials must be a positive integer.");
  }
  return parsed;
}

function mean(values) {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function helpText() {
  return `Usage: node benchmarks/signet-agent/run.mjs [options]

Runs the multidomain Signet/WebMCP browser benchmark. Without provider options,
it uses deterministic workflows to test the harness, browser bridge, guards, and
oracles. Add a Chat Completions-compatible provider to measure agent behavior.

Options:
  --task id             Run one task
  --trials n            Repetitions per task (default: 1)
  --endpoint URL        Chat Completions-compatible endpoint
  --model name          Provider model name
  --api-key-env name    Environment variable containing its API key
  --output directory    Evidence output directory
  --list                List task IDs and categories
  -h, --help            Show this help
`;
}

if (
  import.meta.url === new URL(`file://${resolve(process.argv[1] ?? "")}`).href
) {
  main().catch((error) => {
    process.stderr.write(
      `signet-agent benchmark: ${error.message ?? String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

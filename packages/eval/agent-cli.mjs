#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createChatCompletionsProvider } from "./agent-provider.mjs";
import { runHeadlessTest } from "./headless-runner.mjs";
import { defineAgentTestSuite } from "./agent-suite.mjs";

export async function agentMain(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  const suite = options.config
    ? await loadSuite(options.config)
    : directSuite(options);
  const tasks = options.task
    ? suite.tasks.filter(({ id }) => id === options.task)
    : suite.tasks;
  if (tasks.length === 0) throw new Error(`Unknown task: ${options.task}.`);
  if (options.list) {
    process.stdout.write(`${tasks.map(({ id }) => id).join("\n")}\n`);
    return;
  }

  const trials = options.trials ?? 1;
  const results = [];
  for (const task of tasks) {
    for (let trial = 1; trial <= trials; trial += 1) {
      const complete = suite.createComplete
        ? await suite.createComplete({ task, trial, options })
        : createDefaultProvider(options, suite);
      const outputPath = outputFor(
        options.output,
        task.id,
        trial,
        tasks.length,
        trials,
      );
      process.stdout.write(`[${task.id}:${trial}] `);
      const evidence = await runHeadlessTest({
        task,
        application: suite.application,
        complete,
        outputPath,
        provenance: suite.provenance ?? {},
      });
      results.push(evidence);
      process.stdout.write(
        `${evidence.status.toUpperCase()} · ${evidence.agent?.calls.length ?? 0} calls · ${evidence.durationMs} ms\n`,
      );
    }
  }
  if (results.some(({ status }) => status !== "passed")) process.exitCode = 1;
  return results;
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--list") options.list = true;
    else if (argument.startsWith("--")) {
      const [key, inline] = argument.slice(2).split(/=(.*)/s);
      const value = inline ?? argv[++index];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}.`);
      }
      if (
        [
          "config",
          "task",
          "url",
          "prompt",
          "endpoint",
          "model",
          "output",
          "api-key-env",
        ].includes(key)
      ) {
        options[toCamel(key)] = value;
      } else if (key === "trials") {
        options.trials = positiveInteger(value, "trials");
      } else {
        throw new Error(`Unknown option: --${key}.`);
      }
    } else if (!options.config) options.config = argument;
    else throw new Error(`Unexpected argument: ${argument}.`);
  }
  return options;
}

async function loadSuite(pathname) {
  const target = resolve(pathname);
  if (target.endsWith(".json")) {
    return defineAgentTestSuite(JSON.parse(readFileSync(target, "utf8")));
  }
  const module = await import(pathToFileURL(target).href);
  return defineAgentTestSuite(module.default ?? module.suite);
}

function directSuite(options) {
  if (!options.url || !options.prompt) {
    throw new Error("Use --config, or provide both --url and --prompt.");
  }
  return defineAgentTestSuite({
    schemaVersion: 1,
    id: "ad-hoc",
    application: { id: "ad-hoc-page", url: options.url },
    tasks: [{ id: "ad-hoc", prompt: options.prompt }],
  });
}

function createDefaultProvider(options, suite) {
  const endpoint = options.endpoint ?? suite.provider?.endpoint;
  const model = options.model ?? suite.provider?.model;
  if (!endpoint || !model) {
    throw new Error(
      "The suite or command must define a model endpoint and model.",
    );
  }
  const apiKeyEnv =
    options.apiKeyEnv ?? suite.provider?.apiKeyEnv ?? "SIGNETT_AGENT_API_KEY";
  return createChatCompletionsProvider({
    endpoint,
    model,
    apiKey: process.env[apiKeyEnv],
  });
}

function outputFor(output, taskId, trial, taskCount, trials) {
  if (!output) return undefined;
  if (taskCount === 1 && trials === 1 && output.endsWith(".json"))
    return output;
  return resolve(output, `${taskId}-trial-${trial}.json`);
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function helpText() {
  return `Usage: signett agent [suite.mjs] [options]

Run saved prompts against the exact WebMCP tools exposed by a headless Chrome page.

Options:
  --config path             Agent test suite module or JSON
  --task id                 Run one saved task
  --trials n                Repetitions per task (default: 1)
  --url URL                 Ad-hoc page URL
  --prompt text             Ad-hoc natural-language task
  --endpoint URL            Chat Completions-compatible endpoint
  --model name              Provider model name
  --api-key-env name        Environment variable containing the API key
  --output path             Evidence file or output directory
  --list                    List selected task IDs without running them
  -h, --help                Show this help
`;
}

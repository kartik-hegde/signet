#!/usr/bin/env node

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ChangeCheckRegressionError,
  runTrial,
  writeChangeCheck,
  writeReport,
} from "./index.mjs";

const DEFAULT_CONFIG = "fixtures/cypress-realworld-app/eval/index.mjs";

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "agent") {
    const { agentMain } = await import("./agent-cli.mjs");
    return agentMain(argv.slice(1));
  }
  if (argv[0] === "check") return checkMain(argv.slice(1));
  if (argv[0] === "--help" || argv[0] === "-h" || argv.length === 0) {
    process.stdout.write(rootHelpText());
    return;
  }
  return evalMain(argv);
}

export async function evalMain(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const configPath = resolve(options.config ?? DEFAULT_CONFIG);
  const module = await import(pathToFileURL(configPath).href);
  const evaluation = module.default ?? module.evaluation;
  if (!evaluation?.suite || !evaluation?.adapters) {
    throw new Error(
      `Evaluation module must default-export defineEvaluation(...): ${configPath}`,
    );
  }
  const cases = select(evaluation.suite.cases, options.cases, "Case");
  const conditions = select(
    evaluation.conditions,
    options.conditions,
    "condition",
  );

  if (options.list || options.dryRun) {
    process.stdout.write(
      renderSelection(evaluation.suite, cases, conditions, options.trials),
    );
    if (options.list || options.dryRun) return;
  }

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = resolve(options.output ?? `evidence/eval/${runStamp}`);
  mkdirSync(outputDir, { recursive: true });
  const schedule = buildSchedule(cases, conditions, options.trials);
  const evidence = [];
  const runContext = {
    evaluation,
    outputDir,
    cases,
    conditions,
    trials: options.trials,
  };
  const provenance = options.provenance ?? {};
  let cleanupError;

  process.stdout.write(
    `\nSIGNET EVAL\n${evaluation.suite.id}: ${cases.length} Cases × ${conditions.length} conditions × ${options.trials} trials\n\n`,
  );
  try {
    await evaluation.adapters.application.prepare?.(runContext);
    for (const [position, entry] of schedule.entries()) {
      const trialId = `${entry.caseDefinition.id}:${entry.condition.id}:${entry.index}`;
      process.stdout.write(`[${position + 1}/${schedule.length}] ${trialId} `);
      const result = await runTrial({
        ...entry,
        trialId,
        adapters: evaluation.adapters,
        outputDir,
        provenance,
      });
      evidence.push(result);
      const evidencePath = resolve(
        outputDir,
        `${safeName(trialId)}.evidence.json`,
      );
      writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(
        `${result.oracle.grade.safeSuccess ? "PASS" : "FAIL"} · ${(result.trial.durationMs / 1000).toFixed(1)}s\n`,
      );
      writeRunManifest(outputDir, evaluation, evidence, options);
    }
  } finally {
    try {
      await evaluation.adapters.application.cleanup?.(runContext);
    } catch (error) {
      cleanupError = error;
    }
  }
  const reportResult = writeReport({
    suite: evaluation.suite,
    evidence,
    outputDir,
    baselineCondition: options.baseline ?? "signet-baseline",
  });
  process.stdout.write(
    `\nWrote ${evidence.length} Trial Evidence files, report.json, and report.md to ${outputDir}\n`,
  );
  if (cleanupError) throw cleanupError;
  let changeCheck;
  if (options.against) {
    const result = writeChangeCheck({
      baseline: readReport(options.against),
      candidate: reportResult.report,
      outputDir,
      policy: policyFromOptions(options),
    });
    changeCheck = result.check;
    publishStepSummary(result.markdownPath);
    printChangeCheck(result.check, result.markdownPath);
    if (result.check.status === "fail")
      throw new ChangeCheckRegressionError(result.check);
  }
  return {
    evaluation,
    evidence,
    outputDir,
    options,
    report: reportResult.report,
    changeCheck,
  };
}

export async function checkMain(argv) {
  const options = parseCheckArgs(argv);
  if (options.help) {
    process.stdout.write(checkHelpText());
    return;
  }
  const candidatePath = resolve(options.candidate);
  const outputDir = resolve(options.output ?? dirname(candidatePath));
  const result = writeChangeCheck({
    baseline: readReport(options.against),
    candidate: readReport(candidatePath),
    outputDir,
    policy: policyFromOptions(options),
  });
  publishStepSummary(result.markdownPath);
  printChangeCheck(result.check, result.markdownPath);
  if (result.check.status === "fail")
    throw new ChangeCheckRegressionError(result.check);
  return { ...result, options };
}

export function parseArgs(argv) {
  const values = [...argv];
  if (values[0] === "eval") values.shift();
  const options = { trials: 5 };
  while (values.length > 0) {
    const argument = values.shift();
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument.startsWith("--")) {
      const [rawKey, inline] = argument.slice(2).split(/=(.*)/s);
      const key = { case: "cases", condition: "conditions" }[rawKey] ?? rawKey;
      const value = inline ?? values.shift();
      if (value === undefined || value.startsWith("--"))
        throw new Error(`Missing value for --${rawKey}.`);
      if (key === "trials") options.trials = positiveInteger(value, "trials");
      else if (["cases", "conditions"].includes(key)) options[key] = csv(value);
      else if (["output", "config", "baseline", "against"].includes(key))
        options[key] = value;
      else if (key === "max-safe-regression")
        options.maxSafeRegression = proportion(value, rawKey);
      else if (key === "max-duration-ratio")
        options.maxDurationRatio = positiveNumber(value, rawKey);
      else if (key === "max-token-ratio")
        options.maxTokenRatio = positiveNumber(value, rawKey);
      else throw new Error(`Unknown option: --${rawKey}`);
    } else if (!options.config) options.config = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  return options;
}

export function parseCheckArgs(argv) {
  const values = [...argv];
  const options = {};
  while (values.length > 0) {
    const argument = values.shift();
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--")) {
      const [key, inline] = argument.slice(2).split(/=(.*)/s);
      const value = inline ?? values.shift();
      if (value === undefined || value.startsWith("--"))
        throw new Error(`Missing value for --${key}.`);
      if (["against", "output"].includes(key)) options[key] = value;
      else if (key === "max-safe-regression")
        options.maxSafeRegression = proportion(value, key);
      else if (key === "max-duration-ratio")
        options.maxDurationRatio = positiveNumber(value, key);
      else if (key === "max-token-ratio")
        options.maxTokenRatio = positiveNumber(value, key);
      else throw new Error(`Unknown option: --${key}`);
    } else if (!options.candidate) options.candidate = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  if (options.help) return options;
  if (!options.candidate)
    throw new Error("signet check requires a candidate report.json path.");
  if (!options.against)
    throw new Error("signet check requires --against <baseline-report.json>.");
  return options;
}

export function buildSchedule(cases, conditions, trials) {
  return cases.flatMap((caseDefinition, caseOffset) =>
    Array.from({ length: trials }, (_, trialOffset) => {
      const rotation = (trialOffset + caseOffset) % conditions.length;
      const ordered = [
        ...conditions.slice(rotation),
        ...conditions.slice(0, rotation),
      ];
      return ordered.map((condition) => ({
        caseDefinition,
        condition,
        index: trialOffset + 1,
      }));
    }).flat(),
  );
}

function select(values, requested, label) {
  if (!requested?.length) return [...values];
  const selected = values.filter(({ id }) => requested.includes(id));
  const missing = requested.filter(
    (id) => !selected.some((value) => value.id === id),
  );
  if (missing.length)
    throw new Error(`Unknown ${label}: ${missing.join(", ")}`);
  return selected;
}

function writeRunManifest(outputDir, evaluation, evidence, options) {
  writeFileSync(
    resolve(outputDir, "run.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        suite: evaluation.suite.id,
        updatedAt: new Date().toISOString(),
        requestedTrials: options.trials,
        evidence: evidence.map((item) => ({
          evidenceId: item.evidenceId,
          caseId: item.case.id,
          condition: item.trial.condition,
          trial: item.trial.index,
          safeSuccess: item.oracle.grade.safeSuccess,
        })),
      },
      null,
      2,
    )}\n`,
  );
}

function renderSelection(suite, cases, conditions, trials) {
  return [
    `Suite: ${suite.id}`,
    `Cases (${cases.length}): ${cases.map(({ id }) => id).join(", ")}`,
    `Conditions (${conditions.length}): ${conditions.map(({ id }) => id).join(", ")}`,
    `Trials: ${trials} (${cases.length * conditions.length * trials} total runs)`,
    "",
  ].join("\n");
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function csv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    String(parsed) !== String(value)
  ) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function proportion(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1)
    throw new Error(`${label} must be a number from 0 to 1.`);
  return parsed;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive number.`);
  return parsed;
}

function policyFromOptions(options) {
  return {
    maxSafeRegression: options.maxSafeRegression,
    maxDurationRatio: options.maxDurationRatio,
    maxTokenRatio: options.maxTokenRatio,
  };
}

function readReport(path) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read evaluation report ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function printChangeCheck(check, markdownPath) {
  const details = check.regressions.length
    ? `\n${check.regressions.map(({ message }) => `  - ${message}`).join("\n")}`
    : "";
  process.stdout.write(
    `\nCHANGE CHECK ${check.status.toUpperCase()} · ${check.summary.regressions} regressions · ${check.summary.improvedCells} improved cells${details}\nWrote check.json and check.md next to the candidate report (${markdownPath})\n`,
  );
}

function publishStepSummary(markdownPath) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `\n${readFileSync(markdownPath, "utf8")}\n`,
  );
}

function helpText() {
  return `Usage: signet eval [evaluation.mjs] [options]

Run an agent-interface evaluation and save one Evidence document per Trial.

Options:
  --trials 5                 Trials per Case and condition (default: 5)
  --case id[,id]             Select Cases
  --condition id[,id]        Select conditions
  --output directory         Output directory
  --baseline condition       Baseline used for comparison deltas
  --against report.json      Compare this run with a saved report and fail on regression
  --max-safe-regression 0    Allowed safe-success drop, 0–1 (default: 0)
  --max-duration-ratio n     Optional median-duration budget versus baseline
  --max-token-ratio n        Optional median-token budget versus baseline
  --list                     List the selected matrix without running it
  --dry-run                  Alias for listing the selected matrix
  -h, --help                 Show this help
`;
}

function checkHelpText() {
  return `Usage: signet check candidate-report.json --against baseline-report.json [options]

Compare two evaluation reports per Case and condition. Writes check.json and check.md,
and exits unsuccessfully when a configured regression is found.

Options:
  --against report.json      Baseline report (required)
  --output directory         Output directory (default: candidate directory)
  --max-safe-regression 0    Allowed safe-success drop, 0–1 (default: 0)
  --max-duration-ratio n     Optional median-duration budget versus baseline
  --max-token-ratio n        Optional median-token budget versus baseline
  -h, --help                 Show this help
`;
}

function rootHelpText() {
  return `Usage: signet <command> [options]

Commands:
  agent    Run natural-language tasks against a page's WebMCP tools
  eval     Run repeated, application-owned evaluation Cases
  check    Compare an evaluation report with a reviewed baseline

Run "signet <command> --help" for command-specific options.
`;
}

export function isEntrypoint(argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(resolve(argv1));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((error) => {
    process.stderr.write(
      `signet: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

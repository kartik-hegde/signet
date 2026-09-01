#!/usr/bin/env node

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runTrial, writeReport } from "./index.mjs";

const DEFAULT_CONFIG = "fixtures/cypress-realworld-app/eval/index.mjs";

export async function main(argv = process.argv.slice(2)) {
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
  return {
    evaluation,
    evidence,
    outputDir,
    options,
    report: reportResult.report,
  };
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
      else if (["output", "config", "baseline"].includes(key))
        options[key] = value;
      else throw new Error(`Unknown option: --${rawKey}`);
    } else if (!options.config) options.config = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
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

function helpText() {
  return `Usage: signet eval [evaluation.mjs] [options]

Run an agent-interface evaluation and save one Evidence document per Trial.

Options:
  --trials 5                 Trials per Case and condition (default: 5)
  --case id[,id]             Select Cases
  --condition id[,id]        Select conditions
  --output directory         Output directory
  --baseline condition       Baseline used for comparison deltas
  --list                     List the selected matrix without running it
  --dry-run                  Alias for listing the selected matrix
  -h, --help                 Show this help
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
      `signet eval: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSchedule,
  isEntrypoint,
  parseArgs,
  parseCheckArgs,
} from "../cli.mjs";

test("parseArgs supports the signet eval command shape", () => {
  assert.deepEqual(
    parseArgs([
      "eval",
      "custom.mjs",
      "--trials",
      "5",
      "--case=a,b",
      "--condition",
      "guided",
    ]),
    {
      config: "custom.mjs",
      trials: 5,
      cases: ["a", "b"],
      conditions: ["guided"],
    },
  );
});

test("buildSchedule counterbalances condition order", () => {
  const cases = [{ id: "a" }];
  const conditions = [{ id: "one" }, { id: "two" }, { id: "three" }];
  const schedule = buildSchedule(cases, conditions, 2);
  assert.deepEqual(
    schedule.map(({ condition }) => condition.id),
    ["one", "two", "three", "two", "three", "one"],
  );
  assert.deepEqual(
    schedule.map(({ index }) => index),
    [1, 1, 1, 2, 2, 2],
  );
});

test("parseArgs rejects ambiguous or invalid options", () => {
  assert.throws(() => parseArgs(["eval", "--trials", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["eval", "--unknown", "x"]), /Unknown option/);
});

test("parseCheckArgs captures a baseline and explicit regression budgets", () => {
  assert.deepEqual(
    parseCheckArgs([
      "candidate/report.json",
      "--against",
      "main/report.json",
      "--max-safe-regression=0.2",
      "--max-duration-ratio",
      "1.5",
    ]),
    {
      candidate: "candidate/report.json",
      against: "main/report.json",
      maxSafeRegression: 0.2,
      maxDurationRatio: 1.5,
    },
  );
  assert.throws(() => parseCheckArgs(["candidate.json"]), /requires --against/);
});

test("the CLI recognizes npm's symlinked bin entrypoint", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "signet-eval-bin-"));
  const link = path.join(directory, "signet");
  try {
    symlinkSync(fileURLToPath(new URL("../cli.mjs", import.meta.url)), link);
    assert.equal(isEntrypoint(link), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the unified CLI exposes the headless agent command", () => {
  const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "agent", "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: signet agent/);
  assert.match(result.stdout, /--prompt text/);
});

test("the root CLI lists agent, eval, and check", () => {
  const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agent\s+Run natural-language tasks/);
  assert.match(result.stdout, /eval\s+Run repeated/);
  assert.match(result.stdout, /check\s+Compare/);
});

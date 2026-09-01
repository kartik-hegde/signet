import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSchedule, isEntrypoint, parseArgs } from "../cli.mjs";

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

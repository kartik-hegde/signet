import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../agent-cli.mjs";

test("parses saved-suite and ad-hoc headless commands", () => {
  assert.deepEqual(
    parseArgs([
      "suite.mjs",
      "--task",
      "create-note",
      "--trials=3",
      "--output",
      ".artifacts/results",
    ]),
    {
      config: "suite.mjs",
      task: "create-note",
      trials: 3,
      output: ".artifacts/results",
    },
  );
  assert.deepEqual(parseArgs(["--url=x", "--prompt=y"]), {
    url: "x",
    prompt: "y",
  });
});

test("rejects unknown options and invalid trial counts", () => {
  assert.throws(() => parseArgs(["--wat=x"]), /Unknown option/);
  assert.throws(() => parseArgs(["--trials=0"]), /positive integer/);
});

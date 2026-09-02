#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateEvidence } from "../packages/eval/index.mjs";

/**
 * Check every committed evidence document.
 *
 * Published summaries keep their own report shapes, so only Trial Evidence is held to
 * the versioned envelope. That keeps a result traceable to the exact Case and code
 * that produced it.
 */
export function validateEvidenceTree(root = resolve("evidence")) {
  const files = walk(root).filter((file) => file.endsWith(".json"));
  const failures = [];
  let trialEvidence = 0;

  for (const file of files) {
    let value;
    try {
      value = JSON.parse(readFileSync(file, "utf8"));
      if (value === null || typeof value !== "object")
        throw new Error("root must be an object or array");
    } catch (error) {
      failures.push(`${relative(root, file)}: ${error.message}`);
      continue;
    }
    if (!isTrialEvidence(value)) continue;
    trialEvidence += 1;
    try {
      validateEvidence(value);
    } catch (error) {
      failures.push(`${relative(root, file)}: ${error.message}`);
    }
  }

  return { files: files.length, trialEvidence, failures };
}

/**
 * Recognize a document that is meant to be Trial Evidence, not one that already is.
 * Keying off a well-formed field would let a malformed document escape validation by
 * being malformed in exactly that field, so detection uses the envelope's identity and
 * shape and leaves conformance to the validator.
 */
function isTrialEvidence(value) {
  if (Array.isArray(value) || typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "evidenceId" in value ||
    (isRecord(value.case) && isRecord(value.trial) && isRecord(value.oracle))
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : path;
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = validateEvidenceTree();
  if (result.failures.length)
    throw new Error(
      `Evidence validation failed:\n${result.failures.join("\n")}`,
    );
  process.stdout.write(
    `Validated ${result.files} evidence JSON files, ${result.trialEvidence} against the Trial Evidence schema.\n`,
  );
}

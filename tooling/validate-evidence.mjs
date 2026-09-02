#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateEvidence } from "../packages/eval/index.mjs";

/**
 * Check every committed evidence document.
 *
 * Published summaries use their own report shapes, so only Trial Evidence — the
 * documents that carry a Case definition hash — is held to the versioned schema. That
 * keeps a result traceable to the exact Case and code that produced it.
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

function isTrialEvidence(value) {
  return (
    !Array.isArray(value) &&
    typeof value.case === "object" &&
    value.case !== null &&
    typeof value.case.definitionHash === "string"
  );
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

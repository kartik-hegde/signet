#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const evidenceRoot = resolve("evidence");
const files = walk(evidenceRoot).filter((file) => file.endsWith(".json"));
const failures = [];

for (const file of files) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (value === null || typeof value !== "object")
      throw new Error("root must be an object or array");
  } catch (error) {
    failures.push(`${file}: ${error.message}`);
  }
}

if (failures.length)
  throw new Error(`Evidence validation failed:\n${failures.join("\n")}`);
process.stdout.write(`Validated ${files.length} evidence JSON files.\n`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : path;
  });
}

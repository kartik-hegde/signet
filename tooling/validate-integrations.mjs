#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve("benchmarks/integrations");
const files = walk(root);
for (const file of files.filter((value) => value.endsWith(".json"))) {
  JSON.parse(readFileSync(file, "utf8"));
}
for (const file of files.filter((value) => value.endsWith(".mjs"))) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
for (const file of files.filter((value) => value.endsWith(".patch"))) {
  if (!readFileSync(file, "utf8").includes("diff --git "))
    throw new Error(`Invalid patch: ${file}`);
}
process.stdout.write(`Validated ${files.length} integration files.\n`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : path;
  });
}

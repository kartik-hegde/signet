#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export const LANES = Object.freeze([
  "sdk",
  "compatibility",
  "safety",
  "reference",
  "eval",
  "evidence",
  "docs",
  "integrations",
]);

const ROOT_FILES = new Set([
  "package.json",
  "package-lock.json",
  ".gitignore",
  "AGENTS.md",
]);

export function classifyFiles(files) {
  const changed = files.map(normalize).filter(Boolean);
  const all = changed.some(
    (file) =>
      ROOT_FILES.has(file) ||
      file.startsWith(".github/") ||
      file === "tooling/classify-changes.mjs",
  );
  const sdkSource = matches(changed, "packages/webmcp/src/");
  const sdk =
    all || matches(changed, "packages/webmcp/", "fixtures/hello-world/");
  return {
    sdk,
    compatibility: sdk,
    safety:
      all ||
      sdkSource ||
      matches(
        changed,
        "benchmarks/execution-safety/",
        "benchmarks/build-vs-buy/",
      ),
    reference:
      all ||
      sdkSource ||
      matches(changed, "fixtures/cypress-realworld-app/", "tooling/run-p0.mjs"),
    eval:
      all ||
      matches(
        changed,
        "packages/eval/",
        "packages/chrome-agent/",
        "benchmarks/agent-effectiveness/",
        "fixtures/cypress-realworld-app/eval/",
      ),
    evidence:
      all ||
      matches(
        changed,
        "evidence/",
        "tooling/build-evidence-report.mjs",
        "tooling/validate-evidence.mjs",
      ),
    docs:
      all ||
      sdkSource ||
      matches(changed, "docs/", "packages/webmcp/README.md", "README.md"),
    integrations:
      all ||
      matches(
        changed,
        "benchmarks/integrations/",
        "tooling/materialize-fixture.mjs",
        "tooling/validate-integrations.mjs",
      ),
  };
}

export function changedFiles({ base, head = "HEAD" }) {
  if (!base || /^0+$/.test(base)) return ["package.json"];
  const output = execFileSync(
    "git",
    ["diff", "--name-only", `${base}...${head}`],
    {
      encoding: "utf8",
    },
  );
  return output.split("\n").filter(Boolean);
}

function matches(files, ...prefixes) {
  return files.some((file) =>
    prefixes.some((prefix) => file === prefix || file.startsWith(prefix)),
  );
}

function normalize(file) {
  return file.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function option(name) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

if (process.argv[1]?.endsWith("classify-changes.mjs")) {
  const files = option("files")
    ? option("files").split(",")
    : changedFiles({
        base: option("base") ?? process.env.BASE_SHA,
        head: option("head") ?? process.env.HEAD_SHA ?? "HEAD",
      });
  const result = classifyFiles(files);
  const lines = [
    ...LANES.map((lane) => `${lane}=${result[lane]}`),
    `files=${JSON.stringify(files)}`,
  ];
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  process.stdout.write(`${JSON.stringify({ files, ...result }, null, 2)}\n`);
}

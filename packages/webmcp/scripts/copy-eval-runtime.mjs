import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";

const source = new URL("../../eval/", import.meta.url);
const target = new URL("../eval-runtime/", import.meta.url);
const packageRoot = new URL("../", import.meta.url);

const evaluationPackage = readJson(new URL("package.json", source));
const umbrellaPackage = readJson(new URL("package.json", packageRoot));

for (const [name, range] of Object.entries(
  evaluationPackage.dependencies ?? {},
)) {
  if (umbrellaPackage.dependencies?.[name] !== range) {
    throw new Error(
      `Keep signett dependency ${name}@${umbrellaPackage.dependencies?.[name] ?? "missing"} aligned with @signett/eval@${range}.`,
    );
  }
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (!isRuntimeEntry(entry)) continue;
  cpSync(new URL(entry.name, source), new URL(entry.name, target), {
    recursive: entry.isDirectory(),
  });
}

function isRuntimeEntry(entry) {
  return (
    entry.name === "schemas" ||
    entry.name.endsWith(".mjs") ||
    entry.name.endsWith(".d.mts") ||
    entry.name.endsWith(".d.ts")
  );
}

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

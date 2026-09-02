import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evalRoot = join(root, "../eval");
const output = join(root, "dist");
const files = [
  "manifest.json",
  "page-bridge.mjs",
  "service-worker.mjs",
  "sidepanel.css",
  "sidepanel.html",
  "sidepanel.mjs",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(
  files.map((file) => copyFile(join(root, file), join(output, file))),
);
await Promise.all(
  [
    ["agent-core.mjs", "agent-core.mjs"],
    ["agent-provider.mjs", "provider.mjs"],
  ].map(([source, target]) =>
    copyFile(join(evalRoot, source), join(output, target)),
  ),
);

console.log(`Built Signet Agent at ${output}`);

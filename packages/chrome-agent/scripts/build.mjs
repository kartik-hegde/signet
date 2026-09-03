import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist");
const iconOutput = join(output, "icons");
const files = [
  "agent-core.mjs",
  "api-key-storage.mjs",
  "conversation-history.mjs",
  "markdown.mjs",
  "manifest.json",
  "page-bridge.mjs",
  "provider.mjs",
  "service-worker.mjs",
  "sidepanel.css",
  "sidepanel.html",
  "sidepanel.mjs",
  "website-access.mjs",
];
const icons = ["icon-16.png", "icon-32.png", "icon-48.png", "icon-128.png"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(iconOutput, { recursive: true });
await Promise.all(
  files.map((file) => copyFile(join(root, file), join(output, file))),
);
await Promise.all(
  icons.map((file) =>
    copyFile(join(root, "icons", file), join(iconOutput, file)),
  ),
);

console.log(`Built Signett Agent at ${output}`);

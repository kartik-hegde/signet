import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(join(root, "manifest.json"), "utf8"),
);
const expectedPermissions = ["activeTab", "scripting", "sidePanel", "storage"];

if (manifest.manifest_version !== 3) {
  throw new Error("Signet Agent must use Manifest V3.");
}
if (
  JSON.stringify(manifest.permissions) !== JSON.stringify(expectedPermissions)
) {
  throw new Error(
    "Signet Agent permissions changed; review the privacy boundary.",
  );
}
if (manifest.host_permissions) {
  throw new Error("Provider origins must remain optional permissions.");
}
if (manifest.side_panel?.default_path !== "sidepanel.html") {
  throw new Error("The side panel entry point is missing.");
}

const html = await readFile(join(root, "sidepanel.html"), "utf8");
if (/<script[^>]+src=["']https?:/i.test(html)) {
  throw new Error("Manifest V3 forbids remotely hosted extension scripts.");
}
if (/<script(?![^>]+src=)[^>]*>/i.test(html)) {
  throw new Error("Extension pages must not contain inline scripts.");
}

const sidePanelScript = await readFile(join(root, "sidepanel.mjs"), "utf8");
for (const [, id] of sidePanelScript.matchAll(
  /querySelector\("#([\w-]+)"\)/g,
)) {
  if (!html.includes(`id="${id}"`)) {
    throw new Error(`sidepanel.mjs references missing element #${id}.`);
  }
}

for (const file of [
  "agent-core.mjs",
  "page-bridge.mjs",
  "provider.mjs",
  "service-worker.mjs",
  "sidepanel.css",
  "sidepanel.mjs",
]) {
  await access(join(root, file));
}

for (const size of [16, 32, 48, 128]) {
  const path = `icons/icon-${size}.png`;
  if (manifest.icons?.[size] !== path) {
    throw new Error(`Manifest icon ${size} is missing.`);
  }
  await access(join(root, path));
}

console.log("Signet Agent manifest and privacy boundary are valid.");

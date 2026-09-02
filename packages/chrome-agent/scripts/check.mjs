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

console.log("Signet Agent manifest and privacy boundary are valid.");

import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(join(root, "manifest.json"), "utf8"),
);
const archive = join(root, `signet-agent-chrome-v${manifest.version}.zip`);

await rm(archive, { force: true });
try {
  execFileSync("zip", ["-q", "-r", archive, "."], {
    cwd: join(root, "dist"),
    stdio: "inherit",
  });
} catch (error) {
  if (error?.code === "ENOENT") {
    throw new Error("Packaging requires the standard `zip` command.", {
      cause: error,
    });
  }
  throw error;
}

console.log(`Packaged Signet Agent at ${archive}`);

import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { application, databaseCompose, signet } from "./paths.mjs";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

function git(directory, args) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Cannot read ${directory}.`);
  return result.stdout.trim();
}

await Promise.all([access(application), access(signet), access(databaseCompose)]);
const response = await fetch(manifest.health);
const database = spawnSync("docker", ["compose", "ps", "--services", "--filter", "status=running"], {
  cwd: databaseCompose,
  encoding: "utf8",
});
if (database.status !== 0) throw new Error(database.stderr.trim() || "Docker Compose is unavailable.");

const report = {
  ok: response.ok && database.stdout.split("\n").includes("postgres"),
  application: {
    head: git(application, ["rev-parse", "HEAD"]),
    expectedBase: manifest.application.revision,
    expectedIntegration: manifest.application.integrationRevision,
    baseIsAncestor:
      spawnSync("git", ["merge-base", "--is-ancestor", manifest.application.revision, "HEAD"], {
        cwd: application,
      }).status === 0,
  },
  signet: {
    head: git(signet, ["rev-parse", "HEAD"]),
    expected: manifest.signet.revision,
    workingTreeDirty: Boolean(git(signet, ["status", "--porcelain"])),
  },
  health: { url: manifest.health, status: response.status },
  runningServices: database.stdout.trim().split("\n").filter(Boolean),
};

console.log(JSON.stringify(report, null, 2));
if (
  !report.ok ||
  !report.application.baseIsAncestor ||
  report.application.head !== report.application.expectedIntegration ||
  report.signet.head !== report.signet.expected
) {
  process.exitCode = 1;
}

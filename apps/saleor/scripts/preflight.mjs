import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { docker, platform, signet, storefront } from "./paths.mjs";

const expected = {
  storefront: "56f021d42196eaa78b997df010430d8ea7842e99",
  storefrontIntegration: "9ad3ccc1baf7d1de1c8aff86f5be3a2cd7724be4",
  platform: "ab6315bd59c58b4815175df4c679107ff9695be4",
  signet: "100b7d4f4046112fab66705df607e5cb9970d586",
};

function git(directory, args) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Cannot read ${directory}`);
  return result.stdout.trim();
}

async function health(url, init) {
  const response = await fetch(url, init);
  return { url, status: response.status, ok: response.ok };
}

await Promise.all([access(storefront), access(platform), access(signet), access(docker)]);

const revisions = {
  storefront: git(storefront, ["rev-parse", "HEAD"]),
  platform: git(platform, ["rev-parse", "HEAD"]),
  signet: git(signet, ["rev-parse", "HEAD"]),
};

if (revisions.platform !== expected.platform) {
  throw new Error(`platform is at ${revisions.platform}, expected ${expected.platform}`);
}
if (revisions.storefront !== expected.storefrontIntegration) {
  throw new Error(`storefront is at ${revisions.storefront}, expected integration ${expected.storefrontIntegration}`);
}
if (revisions.signet !== expected.signet) {
  throw new Error(`signet is at ${revisions.signet}, expected ${expected.signet}`);
}
const storefrontBase = spawnSync("git", ["merge-base", "--is-ancestor", expected.storefront, "HEAD"], {
  cwd: storefront,
});
if (storefrontBase.status !== 0) {
  throw new Error(`storefront is not based on pinned upstream ${expected.storefront}`);
}

const services = spawnSync(docker, ["compose", "ps", "--services", "--filter", "status=running"], {
  cwd: platform,
  encoding: "utf8",
});
if (services.status !== 0) throw new Error(services.stderr.trim() || "Docker Compose is unavailable");

const checks = await Promise.all([
  health("http://localhost:3000/en/default-channel"),
  health("http://localhost:8000/graphql/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ shop { name } }" }),
  }),
  health("http://localhost:9000"),
]);

const report = {
  ok: checks.every((check) => check.ok),
  revisions,
  runningServices: services.stdout.trim().split("\n").filter(Boolean),
  checks,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

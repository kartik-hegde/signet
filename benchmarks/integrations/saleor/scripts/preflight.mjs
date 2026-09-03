import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { docker, platform, signett, storefront } from "./paths.mjs";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);
const expected = {
  storefront: manifest.storefront.revision,
  storefrontIntegration: manifest.storefront.integrationRevision,
  platform: manifest.platform.revision,
  signett: manifest.signett.revision,
};

function git(directory, args) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || `Cannot read ${directory}`);
  return result.stdout.trim();
}

async function health(url, init) {
  const response = await fetch(url, init);
  return { url, status: response.status, ok: response.ok };
}

await Promise.all([
  access(storefront),
  access(platform),
  access(signett),
  access(docker),
]);

const revisions = {
  storefront: git(storefront, ["rev-parse", "HEAD"]),
  platform: git(platform, ["rev-parse", "HEAD"]),
  signett: git(signett, ["rev-parse", "HEAD"]),
};

if (revisions.platform !== expected.platform) {
  throw new Error(
    `platform is at ${revisions.platform}, expected ${expected.platform}`,
  );
}
if (revisions.storefront !== expected.storefrontIntegration) {
  throw new Error(
    `storefront is at ${revisions.storefront}, expected integration ${expected.storefrontIntegration}`,
  );
}
if (expected.signett !== "workspace" && revisions.signett !== expected.signett) {
  throw new Error(
    `signett is at ${revisions.signett}, expected ${expected.signett}`,
  );
}
const storefrontBase = spawnSync(
  "git",
  ["merge-base", "--is-ancestor", expected.storefront, "HEAD"],
  {
    cwd: storefront,
  },
);
if (storefrontBase.status !== 0) {
  throw new Error(
    `storefront is not based on pinned upstream ${expected.storefront}`,
  );
}

const services = spawnSync(
  docker,
  ["compose", "ps", "--services", "--filter", "status=running"],
  {
    cwd: platform,
    encoding: "utf8",
  },
);
if (services.status !== 0)
  throw new Error(services.stderr.trim() || "Docker Compose is unavailable");

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

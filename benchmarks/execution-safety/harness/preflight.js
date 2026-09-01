/**
 * Guarantees the benchmark is scoring the current Signet source.
 *
 * A stale dist is the worst failure a hill-climbing loop can have, because the
 * score changes for a reason that is not the edit you just made. So freshness is
 * verified rather than remembered: every file the build depends on is hashed, the
 * hash is compared against a stamp written at build time, and a mismatch triggers a
 * rebuild before anything is scored. A failed build aborts the run. The benchmark
 * never scores artifacts it cannot vouch for.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";

const STAMP = ".cache/signet-stamp.json";

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found;
}

/** Hashes every input the build depends on, so the identity is the source, not the clock. */
function hashSources(signetDir) {
  const inputs = [
    ...walk(join(signetDir, "src")),
    join(signetDir, "tsconfig.build.json"),
    join(signetDir, "tsconfig.json"),
    join(signetDir, "package.json"),
  ].filter((path) => existsSync(path));

  const hash = createHash("sha256");
  for (const path of inputs.sort()) {
    hash.update(relative(signetDir, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return { hash: hash.digest("hex").slice(0, 16), fileCount: inputs.length };
}

function readStamp(benchDir) {
  try {
    return JSON.parse(readFileSync(join(benchDir, STAMP), "utf8"));
  } catch {
    return null;
  }
}

function writeStamp(benchDir, stamp) {
  mkdirSync(join(benchDir, ".cache"), { recursive: true });
  writeFileSync(join(benchDir, STAMP), `${JSON.stringify(stamp, null, 2)}\n`);
}

function commitOf(signetDir) {
  try {
    // rev-parse only reads, so it cannot leave an index.lock behind on a mounted folder.
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: signetDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function run(command, args, cwd, label) {
  try {
    execFileSync(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    throw new Error(`${label} failed in ${cwd}\n\n${detail || error.message}`);
  }
}

export function preflight({
  signetDir,
  benchDir,
  allowBuild = true,
  log = console.log,
}) {
  const resolved = resolve(signetDir);
  const workspaceRoot = resolve(resolved, "../..");
  const installRoot = existsSync(join(workspaceRoot, "package.json"))
    ? workspaceRoot
    : resolved;
  if (!existsSync(join(resolved, "package.json"))) {
    throw new Error(
      `No Signet checkout at ${resolved}.\nSet SIGNET_DIR to the repository root.`,
    );
  }

  const { hash, fileCount } = hashSources(resolved);
  const stamp = readStamp(benchDir);
  const distEntry = join(resolved, "dist", "index.js");
  const distMissing = !existsSync(distEntry);
  const stale = distMissing || stamp?.srcHash !== hash;

  if (stale) {
    if (!allowBuild) {
      throw new Error(
        `The Signet build is stale (source hash ${hash}, stamp ${stamp?.srcHash ?? "none"}).\n` +
          `Re-run without --no-build, or build it yourself.`,
      );
    }
    if (
      !existsSync(join(resolved, "node_modules", "typescript")) &&
      !existsSync(join(workspaceRoot, "node_modules", "typescript"))
    ) {
      log("  installing Signet dependencies");
      run(
        "npm",
        ["install", "--no-audit", "--no-fund"],
        installRoot,
        "npm install",
      );
    }
    log(`  rebuilding Signet (${fileCount} source files, hash ${hash})`);
    run("npm", ["run", "build"], resolved, "npm run build");
    if (!existsSync(distEntry)) {
      throw new Error(
        `The build reported success but ${distEntry} does not exist.`,
      );
    }
  }

  const provenance = {
    srcHash: hash,
    commit: commitOf(resolved),
    builtAt: new Date(statSync(distEntry).mtimeMs).toISOString(),
    rebuilt: stale,
    signetDir: resolved,
  };
  writeStamp(benchDir, { srcHash: hash, ...provenance });

  log(
    `  Signet ${provenance.commit} source ${hash} ${stale ? "(rebuilt just now)" : "(already current)"}`,
  );
  return provenance;
}

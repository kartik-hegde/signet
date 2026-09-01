import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { resolve } from "node:path";

import { waitFor } from "../../../agent-effectiveness/lib/cdp.mjs";

export function createPaymentApplicationAdapter({
  root,
  appDir = resolve(root, "apps/cypress-realworld-app"),
  signetDir = resolve(root, process.env.SIGNET_DIR ?? "../signet"),
  frontendPort = process.env.BENCHMARK_APP_PORT ?? "3100",
  backendPort = process.env.BENCHMARK_API_PORT ?? "3101",
  node = process.env.P1_NODE ?? process.execPath,
} = {}) {
  const appUrl = `http://localhost:${frontendPort}`;
  const apiUrl = `http://localhost:${backendPort}`;
  const environment = {
    ...process.env,
    PORT: frontendPort,
    VITE_BACKEND_PORT: backendPort,
    BACKEND_PORT: backendPort,
    NODE_ENV: "test",
  };
  let child;
  let ownsProcess = false;

  const request = async (pathname, init) => {
    const response = await fetch(`${apiUrl}${pathname}`, init);
    if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}.`);
    const text = await response.text();
    try { return JSON.parse(text); } catch { return text; }
  };

  const ready = async () => {
    try {
      const [frontend, backend] = await Promise.all([fetch(appUrl), fetch(apiUrl)]);
      return frontend.ok && backend.ok;
    } catch {
      return false;
    }
  };

  return {
    id: "cypress-payments",
    version: "1",
    appUrl,
    apiUrl,
    async prepare() {
      linkSignet(root, signetDir);
      if (await ready()) return;
      const vite = resolve(appDir, "node_modules/vite/bin/vite.js");
      if (!existsSync(vite)) {
        const error = new Error("Payment fixture dependencies are missing; run npm run install:p0.");
        error.category = "environment";
        error.stage = "application.prepare";
        throw error;
      }
      copyFileSync(resolve(appDir, "scripts/mock-aws-exports.js"), resolve(appDir, "src/aws-exports.js"));
      copyFileSync(resolve(appDir, "scripts/mock-aws-exports-es5.js"), resolve(appDir, "aws-exports-es5.js"));
      const build = spawnSync(node, [vite, "build"], {
        cwd: appDir,
        env: environment,
        encoding: "utf8",
      });
      if (build.error) throw build.error;
      if (build.status !== 0) {
        throw new Error(`Payment fixture build failed:\n${build.stderr || build.stdout}`);
      }
      const tsNode = resolve(appDir, "node_modules/ts-node/dist/bin.js");
      child = spawn(
        node,
        [
          resolve(appDir, "node_modules/concurrently/dist/bin/concurrently.js"),
          `${node} ${tsNode} -P tsconfig.tsnode.json scripts/testServer.ts`,
          `${node} ${tsNode} -P tsconfig.tsnode.json --files backend/app.ts`,
        ],
        { cwd: appDir, env: environment, stdio: "ignore", detached: true },
      );
      ownsProcess = true;
      await waitFor(ready, "the payment fixture", 120_000);
    },
    async reset() {
      await request("/testData/seed", { method: "POST" });
    },
    entrypoint() {
      return `${appUrl}/signin`;
    },
    async database(entity) {
      return (await request(`/testData/${entity}`)).results;
    },
    async cleanup() {
      if (await ready()) await request("/testData/seed", { method: "POST" }).catch(() => {});
      if (ownsProcess && child) stopProcessGroup(child);
      child = undefined;
      ownsProcess = false;
    },
  };
}

function linkSignet(root, signetDir) {
  const localDir = resolve(root, ".local");
  const link = resolve(localDir, "signet");
  mkdirSync(localDir, { recursive: true });
  try {
    if (lstatSync(link)) {
      if (realpathSync(link) === realpathSync(signetDir)) return;
      rmSync(link);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  symlinkSync(signetDir, link, "dir");
}

function stopProcessGroup(child) {
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
}

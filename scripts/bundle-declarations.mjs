import { readdirSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { rollup } from "rollup";
import dts from "rollup-plugin-dts";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = resolve(root, "dist");
const bundled = resolve(dist, ".bundled");
const entrypoints = ["index", "testing", "opentelemetry"];

for (const entrypoint of entrypoints) {
  const bundle = await rollup({
    input: resolve(dist, `${entrypoint}.d.ts`),
    plugins: [dts()],
  });
  await bundle.write({
    file: resolve(bundled, `${entrypoint}.d.ts`),
    format: "es",
  });
  await bundle.close();
}

for (const name of readdirSync(dist)) {
  if (name.endsWith(".d.ts")) rmSync(resolve(dist, name));
}
for (const entrypoint of entrypoints) {
  renameSync(
    resolve(bundled, `${entrypoint}.d.ts`),
    resolve(dist, `${entrypoint}.d.ts`),
  );
}
rmSync(bundled, { recursive: true });

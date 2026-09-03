#!/usr/bin/env node

import { lstatSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function materializeSignettLink({
  root = DEFAULT_ROOT,
  external = resolve(root, ".external"),
} = {}) {
  mkdirSync(external, { recursive: true });
  const link = resolve(external, "signett");
  try {
    const stat = lstatSync(link);
    if (!stat.isSymbolicLink() || realpathSync(link) !== realpathSync(root)) {
      throw new Error(
        `${link} already exists and does not point to this Signett checkout.`,
      );
    }
    return { link, created: false };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  symlinkSync(root, link, process.platform === "win32" ? "junction" : "dir");
  return { link, created: true };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = materializeSignettLink();
  process.stdout.write(
    `${result.created ? "Created" : "Verified"} ${result.link} -> ${DEFAULT_ROOT}\n`,
  );
  process.stdout.write(
    "Place Cal.diy and Saleor checkouts beside that link under .external/.\n",
  );
}

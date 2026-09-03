import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../..");
export const workspace = path.join(root, ".external");
export const storefront =
  process.env.SALEOR_STOREFRONT_DIR ??
  path.join(workspace, "saleor-storefront-signett");
export const platform =
  process.env.SALEOR_PLATFORM_DIR ??
  path.join(workspace, "saleor-platform-signett");
export const signett = process.env.SIGNETT_DIR ?? root;
export const docker =
  process.env.DOCKER_BIN ??
  "/Applications/Docker.app/Contents/Resources/bin/docker";

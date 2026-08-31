import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const workspace = path.resolve(here, "../../../..");
export const storefront = process.env.SALEOR_STOREFRONT_DIR ?? path.join(workspace, "saleor-storefront-signet");
export const platform = process.env.SALEOR_PLATFORM_DIR ?? path.join(workspace, "saleor-platform-signet");
export const signet = process.env.SIGNET_DIR ?? path.join(workspace, "signet");
export const docker = process.env.DOCKER_BIN ?? "/Applications/Docker.app/Contents/Resources/bin/docker";
